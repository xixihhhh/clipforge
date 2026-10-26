"use client";

import { randomUUID } from "@/lib/uuid";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuCircleStop,
  LuCaptions,
  LuCircleCheckBig,
  LuCpu,
  LuDownload,
  LuFileJson2,
  LuFileVideo,
  LuLoaderCircle,
  LuPlay,
  LuRedo2,
  LuRotateCcw,
  LuScissors,
  LuShieldCheck,
  LuUndo2,
  LuUpload,
  LuVolume2,
  LuWandSparkles,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n";
import { buildSrt, buildVtt } from "@/lib/subtitle-export";
import { TRANSCRIPT_EDIT_FORMAT, type TranscriptEditActor, type TranscriptEditProposal, type TranscriptEditSummary } from "@/lib/transcript-edit-protocol";
import {
  LOCAL_ASR_MODELS,
  type AsrWorkerMessage,
  type LocalAsrDevice,
  type LocalAsrModel,
} from "@/lib/local-asr";
import {
  ASR_CHUNK_SECONDS,
  appendTranscriptChunk,
  decodeFloat32Pcm,
  transcriptFromCheckpoint,
  type TranscriptCheckpoint,
  type TranscriptCheckpointSummary,
} from "@/lib/transcript-checkpoint";
import {
  DEFAULT_TRANSCRIPT_EDIT_PLAN,
  detectFillerWordIds,
  findTranscriptWordAtTime,
  keepRangesForPlan,
  nextPlayableSourceTime,
  outputDuration,
  removedRangesForPlan,
  sanitizeTranscriptEditPlan,
  sanitizeTranscriptDocument,
  transcriptWordsToCues,
  type TimeRange,
  type TranscriptDocument,
  type TranscriptEditPlan,
} from "@/lib/transcript-editor";
import { EditTimeline } from "./_components/edit-timeline";
import { TranscriptWordEditor } from "./_components/transcript-word-editor";
import { CaptionCorrections } from "./_components/caption-corrections";
import { ClipWorkbench } from "./_components/clip-workbench";

interface CompositionResult {
  id: string;
  status: "pending" | "composing" | "done" | "failed";
  label?: string | null;
  outputUrl?: string | null;
  downloadUrl?: string | null;
}

interface MediaEditRow {
  id: string;
  revision: number;
  operationId?: string | null;
  baseRevision?: number;
  actor?: TranscriptEditActor;
  plan: TranscriptEditPlan;
  keepRanges?: TimeRange[];
  summary?: TranscriptEditSummary | null;
  status: "queued" | "rendering" | "done" | "failed" | "cancelled";
  progress?: number;
  error?: string | null;
  composition?: CompositionResult | null;
}

interface EditHistory {
  past: TranscriptEditPlan[];
  present: TranscriptEditPlan;
  future: TranscriptEditPlan[];
}

function clonePlan(plan: TranscriptEditPlan): TranscriptEditPlan {
  return { ...plan, ...(plan.captionReplacements ? { captionReplacements: plan.captionReplacements.map((entry) => ({ ...entry, wordIds: [...entry.wordIds] })) } : {}), removedWordIds: [...plan.removedWordIds], ...(plan.removedSilenceRanges ? { removedSilenceRanges: plan.removedSilenceRanges.map((range) => ({ ...range })) } : {}), ...(plan.sourceRange ? { sourceRange: { ...plan.sourceRange } } : {}) };
}

function createHistory(plan = DEFAULT_TRANSCRIPT_EDIT_PLAN): EditHistory {
  return { past: [], present: clonePlan(plan), future: [] };
}

function samePlan(a: TranscriptEditPlan, b: TranscriptEditPlan): boolean {
  return JSON.stringify(a.captionReplacements ?? []) === JSON.stringify(b.captionReplacements ?? [])
    && a.removeSilence === b.removeSilence
    && JSON.stringify(a.removedSilenceRanges ?? []) === JSON.stringify(b.removedSilenceRanges ?? [])
    && a.burnSubtitles === b.burnSubtitles
    && a.silencePaddingMs === b.silencePaddingMs
    && a.wordPaddingMs === b.wordPaddingMs
    && a.sourceRange?.start === b.sourceRange?.start
    && a.sourceRange?.end === b.sourceRange?.end
    && a.removedWordIds.length === b.removedWordIds.length
    && a.removedWordIds.every((id, index) => id === b.removedWordIds[index]);
}

interface MediaSourceRow {
  id: string;
  originalName: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  status: "uploaded" | "transcribing" | "ready" | "failed";
  progress: number;
  model?: string | null;
  device?: LocalAsrDevice | null;
  transcript?: TranscriptDocument | null;
  checkpoint?: TranscriptCheckpointSummary | null;
  error?: string | null;
  edits: MediaEditRow[];
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT("transcript");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const planInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const clipPreviewRef = useRef<TimeRange | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const deviceRef = useRef<LocalAsrDevice | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef(0);
  const [projectName, setProjectName] = useState("");
  const [sources, setSources] = useState<MediaSourceRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"upload" | "decode" | "transcribe" | "preview" | "render" | "export" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [model, setModel] = useState<LocalAsrModel>(LOCAL_ASR_MODELS[0].id);
  const [language, setLanguage] = useState("auto");
  const [device, setDevice] = useState<LocalAsrDevice | null>(null);
  const [fallback, setFallback] = useState(false);
  const [phase, setPhase] = useState<"loading" | "transcribing" | null>(null);
  const [chunkState, setChunkState] = useState({ index: 0, total: 0 });
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<EditHistory>(() => createHistory());
  const [proposal, setProposal] = useState<TranscriptEditProposal | null>(null);
  const [previewCuts, setPreviewCuts] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);

  const loadSources = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/project/${id}/media`, { headers: { "Accept-Language": locale } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("loadFailed"));
      const next = data.sources as MediaSourceRow[];
      setSources(next);
      setSelectedId((current) => current && next.some((source) => source.id === current) ? current : next.find((source) => source.id === new URLSearchParams(window.location.search).get("source"))?.id || next[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadFailed"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [id, locale, t]);

  useEffect(() => {
    void loadSources();
    void fetch(`/api/project/${id}`).then((response) => response.ok ? response.json() : null).then((project) => setProjectName(project?.name || "")).catch(() => {});
  }, [id, loadSources]);

  useEffect(() => () => {
    abortRef.current?.abort();
    workerRef.current?.terminate();
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
  }, []);

  const hasRendering = sources.some((source) => source.edits.some((edit) => edit.status === "rendering" || edit.status === "queued"));
  useEffect(() => {
    if (!hasRendering) return;
    const timer = setInterval(() => void loadSources(true), 2500);
    return () => clearInterval(timer);
  }, [hasRendering, loadSources]);

  const selected = sources.find((source) => source.id === selectedId) ?? null;
  const transcript = useMemo(
    () => selected ? sanitizeTranscriptDocument(selected.transcript, selected.duration / 1000) : null,
    [selected],
  );
  const plan = history.present;
  const removedIds = plan.removedWordIds;
  const removeSilence = plan.removeSilence;
  const burnSubtitles = plan.burnSubtitles;
  const removedIdSet = useMemo(() => new Set(removedIds), [removedIds]);
  const keepRanges = useMemo(() => transcript ? keepRangesForPlan(transcript, plan) : [], [plan, transcript]);
  const removedRanges = useMemo(() => transcript ? removedRangesForPlan(transcript, plan) : [], [plan, transcript]);
  const editedSeconds = outputDuration(keepRanges);
  const removedSeconds = removedRanges.reduce((sum, range) => sum + range.end - range.start, 0);
  const silenceSelections = useMemo(() => plan.removedSilenceRanges ?? [], [plan.removedSilenceRanges]);
  const allSilenceSelected = removeSilence && Boolean(transcript?.silenceRanges.length) && (silenceSelections.length === 0 || silenceSelections.length === transcript!.silenceRanges.length);
  const silenceSelected = useCallback((range: TimeRange) => allSilenceSelected || silenceSelections.some((selected) => Math.abs(selected.start - range.start) < 0.02 && Math.abs(selected.end - range.end) < 0.02), [allSilenceSelected, silenceSelections]);
  const fillerIds = useMemo(() => transcript ? detectFillerWordIds(transcript) : [], [transcript]);
  const remainingFillerIds = useMemo(() => fillerIds.filter((wordId) => !removedIdSet.has(wordId)), [fillerIds, removedIdSet]);
  const activeWordId = transcript ? findTranscriptWordAtTime(transcript.words, currentTime)?.id ?? null : null;

  useEffect(() => {
    clipPreviewRef.current = null;
    setHistory(createHistory());
    setProposal(null);
    setNotice("");
    setCurrentTime(0);
    setPreviewCuts(true);
    setError("");
  }, [selectedId]);

  const patchSource = useCallback((sourceId: string, patch: Partial<MediaSourceRow>) => {
    setSources((current) => current.map((source) => source.id === sourceId ? { ...source, ...patch } : source));
  }, []);

  const commitPlan = useCallback((nextPlan: TranscriptEditPlan) => {
    clipPreviewRef.current = null;
    setHistory((current) => {
      const next = clonePlan(nextPlan);
      if (samePlan(current.present, next)) return current;
      return { past: [...current.past, clonePlan(current.present)].slice(-100), present: next, future: [] };
    });
    setProposal(null);
    setNotice("");
  }, []);

  const toggleSilenceRange = useCallback((range: TimeRange, checked: boolean) => {
    if (!transcript) return;
    const current = transcript.silenceRanges.filter((candidate) => silenceSelected(candidate));
    const next = checked
      ? [...current, range]
      : current.filter((candidate) => Math.abs(candidate.start - range.start) >= 0.02 || Math.abs(candidate.end - range.end) >= 0.02);
    commitPlan({ ...plan, removeSilence: next.length > 0, removedSilenceRanges: next.length ? next : undefined });
  }, [commitPlan, plan, silenceSelected, transcript]);

  const undo = useCallback(() => {
    clipPreviewRef.current = null;
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: clonePlan(previous),
        future: [clonePlan(current.present), ...current.future].slice(0, 100),
      };
    });
    setProposal(null);
    setNotice("");
  }, []);

  const redo = useCallback(() => {
    clipPreviewRef.current = null;
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, clonePlan(current.present)].slice(-100),
        present: clonePlan(next),
        future: current.future.slice(1),
      };
    });
    setProposal(null);
    setNotice("");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    try {
      const response = await fetch(`/api/project/${id}/media`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "Accept-Language": locale,
        },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("uploadFailed"));
      await loadSources(true);
      setSelectedId(data.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("uploadFailed"));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function updateTranscriptState(sourceId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/project/${id}/media/${sourceId}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": locale },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("transcriptionFailed"));
    return data;
  }

  async function startTranscription() {
    if (!selected) return;
    let taskStarted = false;
    cancelRequestedRef.current = false;
    deviceRef.current = null;
    setError("");
    setFallback(false);
    setDevice(null);
    setProgress(0);
    progressRef.current = 0;
    setBusy("decode");
    try {
      const started = await updateTranscriptState(selected.id, { action: "start", model, language, resume: true }) as { resumeCheckpoint?: TranscriptCheckpoint | null };
      taskStarted = true;
      let checkpoint = started.resumeCheckpoint ?? null;
      const sourceDuration = selected.duration / 1000;
      let processedSeconds = checkpoint?.processedSeconds ?? 0;
      const totalChunks = Math.max(1, Math.ceil(sourceDuration / ASR_CHUNK_SECONDS));
      progressRef.current = Math.min(99, Math.round(processedSeconds / sourceDuration * 100));
      setProgress(progressRef.current);
      patchSource(selected.id, { status: "transcribing", progress: progressRef.current, error: null });
      if (checkpoint) {
        deviceRef.current = checkpoint.device;
        setDevice(checkpoint.device);
        setNotice(t("resuming", { time: formatDuration(processedSeconds) }));
      }

      const worker = new Worker(new URL("../../../../workers/asr.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      heartbeatRef.current = setInterval(() => {
        void updateTranscriptState(selected.id, { action: "heartbeat", progress: progressRef.current }).catch(() => {});
      }, 15_000);

      while (processedSeconds < sourceDuration - 0.05) {
        if (cancelRequestedRef.current) break;
        const startSeconds = processedSeconds;
        const durationSeconds = Math.min(ASR_CHUNK_SECONDS, sourceDuration - startSeconds);
        const chunkIndex = Math.floor(startSeconds / ASR_CHUNK_SECONDS);
        setChunkState({ index: chunkIndex + 1, total: totalChunks });
        setBusy("decode");
        setPhase(null);
        const controller = new AbortController();
        abortRef.current = controller;
        const audioResponse = await fetch(`/api/project/${id}/media/${selected.id}/audio?start=${startSeconds.toFixed(3)}&duration=${durationSeconds.toFixed(3)}`, { signal: controller.signal, headers: { "Accept-Language": locale } });
        if (!audioResponse.ok) {
          const data = await audioResponse.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || t("audioChunkFailed"));
        }
        const pcm = decodeFloat32Pcm(await audioResponse.arrayBuffer());
        setBusy("transcribe");
        const chunk = await transcribeAudioChunk(worker, pcm, {
          model,
          language,
          offsetSeconds: startSeconds,
          sourceDuration,
          chunkIndex,
          totalChunks,
        });
        const nextProcessed = Math.min(sourceDuration, startSeconds + durationSeconds);
        checkpoint = appendTranscriptChunk({ checkpoint, chunk, sourceDuration, processedSeconds: nextProcessed, model, language });
        const saved = await updateTranscriptState(selected.id, { action: "checkpoint", chunk, processedSeconds: nextProcessed }) as { progress?: number };
        processedSeconds = nextProcessed;
        progressRef.current = Math.max(progressRef.current, saved.progress ?? Math.min(99, Math.round(processedSeconds / sourceDuration * 100)));
        setProgress(progressRef.current);
      }

      if (cancelRequestedRef.current) return;
      if (!checkpoint) throw new Error(t("emptyTranscript"));
      await updateTranscriptState(selected.id, { action: "complete", transcript: transcriptFromCheckpoint(checkpoint) });
      await loadSources(true);
      setProgress(100);
      setNotice(t("transcriptionComplete"));
      finishWorker();
    } catch (cause) {
      if (cancelRequestedRef.current || (cause instanceof DOMException && cause.name === "AbortError")) return;
      const message = cause instanceof Error ? cause.message : t("transcriptionFailed");
      setError(message);
      if (taskStarted) await updateTranscriptState(selected.id, { action: "fail", error: message }).catch(() => {});
      finishWorker();
    }
  }

  function transcribeAudioChunk(
    worker: Worker,
    pcm: Float32Array,
    input: { model: LocalAsrModel; language: string; offsetSeconds: number; sourceDuration: number; chunkIndex: number; totalChunks: number },
  ): Promise<TranscriptDocument> {
    return new Promise((resolve, reject) => {
      const base = input.chunkIndex / input.totalChunks * 99;
      const weight = 99 / input.totalChunks;
      worker.onmessage = (event: MessageEvent<AsrWorkerMessage>) => {
        const message = event.data;
        if (message.type === "device") {
          deviceRef.current = message.device;
          setDevice(message.device);
          if (message.fallback) setFallback(true);
          return;
        }
        if (message.type === "progress") {
          setPhase(message.phase);
          const fraction = message.phase === "loading" ? message.progress / 100 * 0.2 : 0.2 + message.progress / 100 * 0.8;
          progressRef.current = Math.max(progressRef.current, Math.min(99, Math.round(base + weight * fraction)));
          setProgress(progressRef.current);
          return;
        }
        if (message.type === "complete") resolve(message.transcript);
        if (message.type === "error") reject(new Error(message.error || t("transcriptionFailed")));
      };
      worker.onerror = (event) => reject(new Error(event.message || t("transcriptionFailed")));
      worker.postMessage({
        type: "transcribe",
        audio: pcm,
        model: input.model,
        language: input.language,
        preferWebGpu: deviceRef.current !== "wasm",
        offsetSeconds: input.offsetSeconds,
        sourceDuration: input.sourceDuration,
        chunkIndex: input.chunkIndex,
      }, [pcm.buffer]);
    });
  }

  async function cancelTranscription() {
    if (!selected || (busy !== "decode" && busy !== "transcribe")) return;
    cancelRequestedRef.current = true;
    abortRef.current?.abort();
    workerRef.current?.terminate();
    await updateTranscriptState(selected.id, { action: "cancel" }).catch(() => {});
    finishWorker();
    await loadSources(true);
    setNotice(t("cancelledResume"));
  }

  function finishWorker() {
    abortRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    setBusy(null);
    setPhase(null);
    setChunkState({ index: 0, total: 0 });
  }

  const latestRevision = selected?.edits.reduce((max, edit) => Math.max(max, edit.revision), 0) ?? 0;

  function toggleWord(wordId: string) {
    commitPlan({
      ...plan,
      removedWordIds: removedIdSet.has(wordId)
        ? removedIds.filter((id) => id !== wordId)
        : [...removedIds, wordId],
    });
  }

  function markFillers() {
    if (!remainingFillerIds.length) return;
    commitPlan({ ...plan, removedWordIds: [...removedIds, ...remainingFillerIds] });
  }

  function resetPlan() {
    commitPlan(DEFAULT_TRANSCRIPT_EDIT_PLAN);
  }

  function seekTo(time: number) {
    clipPreviewRef.current = null;
    const video = videoRef.current;
    if (!video) return;
    const maxTime = transcript?.duration ?? (Number.isFinite(video.duration) ? video.duration : time);
    const target = previewCuts && transcript
      ? nextPlayableSourceTime(time, keepRanges) ?? Math.max(0, (keepRanges.at(-1)?.end ?? 0) - 0.02)
      : Math.min(time, maxTime);
    video.currentTime = Math.max(0, target);
    setCurrentTime(Math.max(0, target));
  }

  function handleVideoTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const previewRange = clipPreviewRef.current;
    if (previewRange) {
      if (video.currentTime >= previewRange.end) {
        video.pause();
        if (video.currentTime > previewRange.end + 0.03) video.currentTime = previewRange.end;
      } else if (video.currentTime < previewRange.start) {
        video.currentTime = previewRange.start;
      }
      setCurrentTime(video.currentTime);
      return;
    }
    if (previewCuts && transcript) {
      const playable = nextPlayableSourceTime(video.currentTime, keepRanges);
      if (playable === null) {
        const lastPlayable = Math.max(0, (keepRanges.at(-1)?.end ?? 0) - 0.02);
        video.pause();
        if (Math.abs(video.currentTime - lastPlayable) > 0.03) video.currentTime = lastPlayable;
        setCurrentTime(lastPlayable);
        return;
      }
      if (playable - video.currentTime > 0.02) {
        video.currentTime = playable;
        setCurrentTime(playable);
        return;
      }
    }
    setCurrentTime(video.currentTime);
  }

  function previewClip(range: TimeRange) {
    const video = videoRef.current;
    if (!video) return;
    clipPreviewRef.current = range;
    video.currentTime = range.start;
    setCurrentTime(range.start);
    video.scrollIntoView({ block: "center" });
    void video.play().catch(() => setNotice(t("clipsPlayManually")));
  }

  function downloadText(fileName: string, mimeType: string, content: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    // Let the browser start the download before releasing the blob, especially when
    // the user requests all three timeline formats in sequence.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function exportDraft(format: "srt" | "vtt" | "json") {
    if (!selected || !transcript) return;
    const stem = `clipforge-${selected.id.slice(0, 8)}-draft`;
    if (format === "json") {
      downloadText(`${stem}.json`, "application/json", JSON.stringify({
        format: TRANSCRIPT_EDIT_FORMAT,
        operationId: randomUUID(),
        actor: "human",
        projectId: id,
        mediaId: selected.id,
        baseRevision: latestRevision,
        plan,
      }, null, 2));
      return;
    }
    const cues = transcriptWordsToCues(transcript, keepRanges, plan);
    downloadText(`${stem}.${format}`, format === "srt" ? "application/x-subrip" : "text/vtt", format === "srt" ? buildSrt(cues) : buildVtt(cues));
  }

  async function importDraft(file: File | undefined) {
    if (!file || !transcript) return;
    try {
      const parsed = JSON.parse(await file.text()) as { plan?: unknown };
      const rawPlan = parsed && typeof parsed === "object" && "plan" in parsed ? parsed.plan : parsed;
      if (!rawPlan || typeof rawPlan !== "object" || (rawPlan as { version?: unknown }).version !== 1) {
        throw new Error(t("draftImportFailed"));
      }
      const imported = sanitizeTranscriptEditPlan(rawPlan, new Set(transcript.words.map((word) => word.id)), transcript.duration);
      commitPlan(imported);
      setNotice(t("draftImported"));
    } catch (cause) {
      console.warn("剪辑计划导入失败:", cause);
      setError(t("draftImportFailed"));
    } finally {
      if (planInputRef.current) planInputRef.current.value = "";
    }
  }

  async function downloadTimelineFormat(format: "otio" | "edl" | "csv") {
    if (!selected || !transcript) return;
    const response = await fetch(`/api/project/${id}/media/${selected.id}/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": locale },
      body: JSON.stringify({ format, plan }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error || t("timelineExportFailed"));
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const fileName = encodedName ? decodeURIComponent(encodedName) : `clipforge-draft.${format}`;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportTimelineDraft(format: "otio" | "edl" | "csv") {
    if (!selected || !transcript) return;
    setBusy("export");
    setError("");
    try {
      await downloadTimelineFormat(format);
      setNotice(t("timelineExported", { format: format.toUpperCase() }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("timelineExportFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function exportAllTimelineFormats() {
    if (!selected || !transcript) return;
    setBusy("export");
    setError("");
    try {
      for (const format of ["otio", "edl", "csv"] as const) await downloadTimelineFormat(format);
      setNotice(t("timelineExportAllDone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("timelineExportFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function previewEdit() {
    if (!selected || !transcript) return;
    setBusy("preview");
    setError("");
    try {
      const response = await fetch(`/api/project/${id}/media/${selected.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({ action: "preview", operationId: randomUUID(), actor: "human", baseRevision: latestRevision, plan }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("renderFailed"));
      setProposal(data.proposal as TranscriptEditProposal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("renderFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function applyEdit() {
    if (!selected || !transcript || !proposal) return;
    setBusy("render");
    setError("");
    try {
      const response = await fetch(`/api/project/${id}/media/${selected.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({
          action: "apply",
          operationId: proposal.operationId,
          actor: "human",
          baseRevision: proposal.baseRevision,
          plan: proposal.plan,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (response.status === 409 ? t("revisionConflict") : t("renderFailed")));
      setProposal(null);
      await loadSources(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("renderFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function controlRender(editId: string, action: "cancel" | "retry") {
    if (!selected) return;
    setBusy("render"); setError("");
    try {
      const response = await fetch(`/api/project/${id}/media/${selected.id}/edit`, { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": locale }, body: JSON.stringify({ action, editId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("renderFailed"));
      await loadSources(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("renderFailed")); }
    finally { setBusy(null); }
  }

  function loadEditAsDraft(edit: MediaEditRow) {
    commitPlan(edit.plan);
    setNotice(t("draftLoaded", { n: edit.revision }));
  }

  const activeRender = selected?.edits.some((edit) => edit.status === "rendering" || edit.status === "queued") ?? false;
  const originalSeconds = transcript?.duration ?? (selected?.duration ?? 0) / 1000;
  const progressLabel = busy === "decode" && chunkState.total
    ? t("extractingChunk", { n: chunkState.index, total: chunkState.total })
    : phase === "loading"
      ? t("loadingModel", { n: progress })
      : chunkState.total
        ? t("transcribingChunk", { n: chunkState.index, total: chunkState.total })
        : t("transcribing");

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href={`/project/${id}/assets`} className="mb-3 inline-flex min-h-8 items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <LuArrowLeft className="h-4 w-4" />{t("back")}
          </Link>
          {projectName && <p className="mb-1 truncate text-xs font-medium uppercase tracking-[0.18em] text-primary">{projectName}</p>}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex max-w-md items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5 text-xs leading-5 text-emerald-700 dark:text-emerald-300">
          <LuShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{t("localPrivacy")}
        </div>
      </header>

      {error && <div role="alert" className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {notice && <div role="status" aria-live="polite" className="mb-5 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}

      <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div className="rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h2 className="font-semibold">{t("uploadTitle")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("uploadHint")}</p></div>
            <span className="rounded-lg bg-primary/10 p-2 text-primary"><LuUpload /></span>
          </div>
          <input ref={inputRef} className="hidden" type="file" accept=".mp4,.mov,.webm,.mkv,.m4v,video/mp4,video/quicktime,video/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <Button className="h-10 w-full" disabled={busy === "upload"} onClick={() => inputRef.current?.click()}>
            {busy === "upload" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuFileVideo />}
            {busy === "upload" ? t("uploading") : t("chooseVideo")}
          </Button>

          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("sources")}</h3>
          {loading ? <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><LuLoaderCircle className="animate-spin motion-reduce:animate-none" />{t("loading")}</div> : sources.length ? (
            <div className="space-y-2">
              {sources.map((source) => <button key={source.id} type="button" onClick={() => setSelectedId(source.id)} className={`w-full rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${source.id === selectedId ? "border-primary/40 bg-primary/8" : "border-border/50 bg-background/30 hover:border-border"}`}>
                <span className="block truncate text-sm font-medium">{source.originalName}</span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{t("sourceMeta", { duration: formatDuration(source.duration / 1000), size: formatBytes(source.sizeBytes) })}</span>
                  <span className={source.status === "ready" ? "text-emerald-500" : source.status === "failed" ? "text-destructive" : ""}>{t(`status_${source.status}`)}</span>
                </span>
              </button>)}
            </div>
          ) : <div className="rounded-xl border border-dashed border-border p-5 text-center"><p className="text-sm font-medium">{t("noSource")}</p><p className="mt-1 text-xs text-muted-foreground">{t("noSourceHint")}</p></div>}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5">
          {selected ? <>
            <div className="overflow-hidden rounded-xl bg-black"><video ref={videoRef} key={selected.id} src={selected.url} controls preload="metadata" onTimeUpdate={handleVideoTimeUpdate} onSeeked={handleVideoTimeUpdate} onPlay={handleVideoTimeUpdate} className="aspect-video max-h-[460px] w-full object-contain" /></div>
            {transcript && <div className="mt-4 rounded-xl border border-border/60 bg-background/30 p-3">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="flex items-center gap-2 text-sm font-semibold"><LuPlay className="text-primary" />{t("livePreview")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("livePreviewHint")}</p></div>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 text-xs font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={previewCuts} onChange={(event) => setPreviewCuts(event.target.checked)} />
                  {t("previewCuts")}
                </label>
              </div>
              <EditTimeline
                duration={originalSeconds}
                currentTime={currentTime}
                removedRanges={removedRanges}
                silenceRanges={transcript.silenceRanges}
                onSeek={seekTo}
                ariaLabel={t("timelineLabel")}
                removedLabel={t("removedRegion")}
                silenceLabel={t("silenceRegion")}
                currentLabel={t("currentTime")}
              />
            </div>}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-xs font-medium text-muted-foreground">{t("model")}
                <select value={model} disabled={busy === "decode" || busy === "transcribe"} onChange={(event) => setModel(event.target.value as LocalAsrModel)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <option value={LOCAL_ASR_MODELS[0].id}>{t("modelTiny")}</option>
                  <option value={LOCAL_ASR_MODELS[1].id}>{t("modelBase")}</option>
                  <option value={LOCAL_ASR_MODELS[2].id}>{t("modelSmall")}</option>
                </select>
              </label>
              <label className="flex-1 text-xs font-medium text-muted-foreground">{t("language")}
                <select value={language} disabled={busy === "decode" || busy === "transcribe"} onChange={(event) => setLanguage(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <option value="auto">{t("languageAuto")}</option><option value="zh">{t("languageZh")}</option><option value="en">{t("languageEn")}</option>
                </select>
              </label>
              {busy === "decode" || busy === "transcribe" ? <Button variant="outline" className="h-11 sm:min-w-36" onClick={() => void cancelTranscription()}><LuCircleStop />{t("cancelTranscribe")}</Button> : <Button className="h-11 sm:min-w-36" disabled={!selected.hasAudio} onClick={() => void startTranscription()}><LuCpu />{selected.checkpoint?.resumable ? t("resumeTranscribe") : transcript ? t("retryTranscribe") : t("startTranscribe")}</Button>}
            </div>
            {model === LOCAL_ASR_MODELS[2].id && <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("modelSmallHint")}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{!selected.hasAudio ? t("noAudio") : selected.checkpoint?.resumable ? t("resumeAvailable", { time: formatDuration(selected.checkpoint.processedSeconds) }) : t("transcribeHint")}</span>
              {(device || selected.device) && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground">{(device || selected.device) === "webgpu" ? t("deviceWebgpu") : t("deviceWasm")}</span>}
            </div>
            {(busy === "decode" || busy === "transcribe") && <div className="mt-4" role="status" aria-live="polite"><div className="mb-1.5 flex items-center justify-between text-xs"><span>{progressLabel}</span><span className="tabular-nums text-muted-foreground">{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(3, progress)}%` }} /></div>{fallback && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{t("fallbackWasm")}</p>}</div>}
            {selected.error && selected.status === "failed" && <p className="mt-3 text-xs text-destructive">{selected.error}</p>}
          </> : <div className="flex min-h-80 flex-col items-center justify-center text-center"><LuFileVideo className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-sm font-medium">{t("noSource")}</p><p className="mt-1 text-xs text-muted-foreground">{t("noSourceHint")}</p></div>}
        </div>
      </section>

      {transcript && <ClipWorkbench
        key={selectedId}
        document={transcript}
        batch={{ projectId: id, mediaId: selectedId, plan, revision: Math.max(0, ...(selected?.edits.map((edit) => edit.revision) ?? [])), disabled: activeRender || busy !== null, onQueued: () => { void loadSources(true); setNotice(t("batchQueued")); } }}
        sourceRange={plan.sourceRange}
        onPreview={previewClip}
        onSelect={(sourceRange) => { commitPlan({ ...plan, sourceRange }); setNotice(t("clipsApplied")); }}
        onClear={() => { const next = { ...plan }; delete next.sourceRange; commitPlan(next); }}
      />}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="flex items-center gap-2 font-semibold"><LuScissors className="text-primary" />{t("editorTitle")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{transcript ? t("editorHint") : t("needTranscript")}</p></div>
            {transcript && <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-1 text-xs text-muted-foreground">{t("selectedWords", { n: removedIds.length })}</span>
              <Button variant="outline" size="sm" className="h-11 px-3" disabled={!history.past.length} onClick={undo} title={t("undo")} aria-label={t("undo")}><LuUndo2 />{t("undo")}</Button>
              <Button variant="outline" size="sm" className="h-11 px-3" disabled={!history.future.length} onClick={redo} title={t("redo")} aria-label={t("redo")}><LuRedo2 />{t("redo")}</Button>
              <Button variant="outline" size="sm" className="h-11 px-3" disabled={!remainingFillerIds.length} onClick={markFillers} title={remainingFillerIds.length ? t("fillerHint", { n: remainingFillerIds.length }) : t("fillerNone")}><LuWandSparkles />{t("fillers")}{remainingFillerIds.length ? ` · ${remainingFillerIds.length}` : ""}</Button>
              <Button variant="outline" size="sm" className="h-11 px-3" disabled={!removedIds.length && !removeSilence && burnSubtitles && !plan.sourceRange && !plan.captionReplacements?.length} onClick={resetPlan}><LuRotateCcw />{t("reset")}</Button>
            </div>}
          </div>
          {transcript && <p className="mb-3 text-[11px] text-muted-foreground">{t("keyboardHint")}</p>}
          {transcript ? <><TranscriptWordEditor key={selectedId} document={transcript} plan={plan} activeWordId={activeWordId} onToggle={toggleWord} onSeek={seekTo} /><CaptionCorrections key={`corrections-${selectedId}`} document={transcript} plan={plan} onChange={commitPlan} /></> : <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">{selected ? t("needTranscript") : t("noSourceHint")}</div>}
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5">
            <div className="rounded-xl border border-border/50 bg-background/30 p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={removeSilence} disabled={!transcript || !transcript.silenceRanges.length} onChange={(event) => commitPlan({ ...plan, removeSilence: event.target.checked, removedSilenceRanges: event.target.checked ? undefined : [] })} />
                <span><span className="flex items-center gap-2 text-sm font-medium"><LuVolume2 className="text-primary" />{t("silence")}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("silenceHint", { n: transcript?.silenceRanges.length ?? 0 })}</span></span>
              </label>
              {transcript && transcript.silenceRanges.length > 0 && <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("silenceChoose")}</p>
                {transcript.silenceRanges.map((range, index) => <label key={`${range.start}-${range.end}-${index}`} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/40">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={removeSilence && silenceSelected(range)} onChange={(event) => toggleSilenceRange(range, event.target.checked)} />
                  <span className="tabular-nums">{range.start.toFixed(1)}s – {range.end.toFixed(1)}s</span>
                  <span className="ml-auto text-muted-foreground">{formatDuration(range.end - range.start)}</span>
                  <button type="button" className="rounded px-1.5 py-1 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={(event) => { event.preventDefault(); seekTo(range.start); }} title={t("silencePreview")} aria-label={t("silencePreview")}>{t("silencePreview")}</button>
                </label>)}
                <label className="mt-2 block px-2 pt-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center justify-between gap-2"><span>{t("silencePadding")}</span><span className="tabular-nums text-foreground">{plan.silencePaddingMs}ms</span></span>
                  <input type="range" min="0" max="500" step="10" value={plan.silencePaddingMs} onChange={(event) => commitPlan({ ...plan, silencePaddingMs: Number(event.target.value) })} className="mt-2 w-full accent-primary" disabled={!removeSilence} />
                </label>
              </div>}
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-background/30 p-3">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={burnSubtitles} disabled={!transcript} onChange={(event) => commitPlan({ ...plan, burnSubtitles: event.target.checked })} />
              <span><span className="flex items-center gap-2 text-sm font-medium"><LuCaptions className="text-primary" />{t("subtitles")}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("subtitlesHint")}</span></span>
            </label>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/30 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("original")}</p><p className="mt-1 text-sm font-semibold tabular-nums">{formatDuration(originalSeconds)}</p></div>
              <div className="rounded-lg bg-primary/8 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("output")}</p><p className="mt-1 text-sm font-semibold tabular-nums text-primary">{formatDuration(editedSeconds)}</p></div>
              <div className="rounded-lg bg-destructive/8 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("removed")}</p><p className="mt-1 text-sm font-semibold tabular-nums text-destructive">-{formatDuration(removedSeconds)}</p></div>
            </div>
            <Button className="mt-4 h-11 w-full" disabled={!transcript || editedSeconds < 0.5 || busy === "preview" || busy === "render" || activeRender} onClick={() => void previewEdit()}>
              {busy === "preview" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuScissors />}
              {busy === "preview" ? t("reviewing") : proposal ? t("previewAgain") : t("render")}
            </Button>

            {proposal && <div className={`mt-3 rounded-xl border p-3 ${proposal.conflict ? "border-destructive/30 bg-destructive/8" : "border-primary/30 bg-primary/8"}`}>
              <h3 className="text-sm font-semibold">{t("reviewTitle")}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{proposal.conflict ? t("revisionConflict") : t("reviewHint", { n: proposal.nextRevision })}</p>
              <div className="mt-3 space-y-1.5 text-xs">
                <p>{t("reviewSummary", { words: proposal.summary.removedWordCount, ranges: proposal.summary.removedRangeCount, duration: formatDuration(proposal.summary.removedDuration) })}</p>
                {proposal.plan.burnSubtitles && <p>{t("reviewCaptions", { n: proposal.summary.subtitleCueCount })}</p>}
                {proposal.summary.removedTextPreview && <p className="line-clamp-3 text-muted-foreground">{t("reviewText", { text: proposal.summary.removedTextPreview })}</p>}
              </div>
              <Button className="mt-3 h-11 w-full" disabled={proposal.conflict || busy === "render" || activeRender} onClick={() => void applyEdit()}>
                {busy === "render" || activeRender ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuCircleCheckBig />}
                {busy === "render" || activeRender ? t("rendering") : t("confirmRender", { n: proposal.nextRevision })}
              </Button>
            </div>}

            {transcript && <div className="mt-5 border-t border-border/60 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("exportDraft")}</h3>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" className="h-11 px-2 text-xs" onClick={() => exportDraft("srt")}><LuDownload />SRT</Button>
                <Button variant="outline" size="sm" className="h-11 px-2 text-xs" onClick={() => exportDraft("vtt")}><LuDownload />VTT</Button>
                <Button variant="outline" size="sm" className="h-11 px-2 text-xs" onClick={() => exportDraft("json")}><LuFileJson2 />JSON</Button>
              </div>
              <input ref={planInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importDraft(event.target.files?.[0])} />
              <Button variant="ghost" size="sm" className="mt-2 h-10 w-full text-xs" onClick={() => planInputRef.current?.click()}><LuUpload />{t("importPlan")}</Button>
              <div className="mt-4 rounded-xl border border-border/50 bg-background/30 p-3">
                <h4 className="text-xs font-semibold">{t("timelineExportTitle")}</h4>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("timelineExportHint")}</p>
                <Button variant="secondary" size="sm" className="mt-3 h-10 w-full text-xs" disabled={busy === "export"} onClick={() => void exportAllTimelineFormats()}>{busy === "export" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuDownload />}{t("timelineExportAll")}</Button>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["otio", "edl", "csv"] as const).map((format) => <Button key={format} variant="outline" size="sm" className="h-11 px-2 text-xs" disabled={busy === "export"} onClick={() => void exportTimelineDraft(format)}>{busy === "export" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuDownload />}{format.toUpperCase()}</Button>)}
                </div>
              </div>
            </div>}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5">
            <h2 className="mb-3 font-semibold">{t("versions")}</h2>
            {selected?.edits.length ? <div className="space-y-2">{selected.edits.map((edit) => <div key={edit.id} className="rounded-xl border border-border/50 bg-background/30 p-3">
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium">{edit.status === "done" ? <LuCircleCheckBig className="text-emerald-500" /> : (edit.status === "failed" || edit.status === "cancelled") ? <span className="h-2 w-2 rounded-full bg-destructive" /> : <LuLoaderCircle className="animate-spin text-primary motion-reduce:animate-none" />}{t("revision", { n: edit.revision })}</span><span className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground"><span className="rounded-full border border-border px-1.5 py-0.5 normal-case">{t(`actor_${edit.actor ?? "human"}`)}</span>{edit.status === "done" ? t("done") : edit.status === "failed" ? t("failed") : edit.status === "cancelled" ? t("renderCancelled") : edit.status === "queued" ? t("renderQueued") : t("rendering")}</span></div>
              {edit.composition?.label && <p className="mt-2 break-words text-sm font-medium">{edit.composition.label}</p>}
              {(edit.status === "queued" || edit.status === "rendering") && <div className="mt-3"><div className="mb-1 flex items-center justify-between text-xs"><span>{edit.status === "queued" ? t("renderQueued") : t("rendering")}</span><span>{edit.progress ?? 0}%</span></div><progress aria-label={t("renderProgress")} value={edit.progress ?? 0} max={100} className="h-2 w-full accent-primary" /><Button variant="outline" className="mt-2 min-h-11 w-full" disabled={busy === "render"} onClick={() => void controlRender(edit.id, "cancel")}>{t("renderCancel")}</Button></div>}
              {(edit.status === "failed" || edit.status === "cancelled") && <Button variant="outline" className="mt-2 min-h-11 w-full" disabled={busy === "render"} onClick={() => void controlRender(edit.id, "retry")}>{t("renderRetry")}</Button>}
              {edit.summary && <p className="mt-2 text-xs text-muted-foreground">{t("reviewSummary", { words: edit.summary.removedWordCount, ranges: edit.summary.removedRangeCount, duration: formatDuration(edit.summary.removedDuration) })}</p>}
              {edit.error && <p className="mt-2 text-xs text-destructive">{edit.error === "RENDER_INTERRUPTED" ? t("renderInterrupted") : edit.error}</p>}
              {edit.composition?.status === "done" && edit.composition.outputUrl && <><video controls preload="metadata" src={edit.composition.outputUrl} className="mt-3 aspect-video w-full rounded-lg bg-black object-contain" /><div className="mt-2 flex flex-wrap gap-2"><a href={edit.composition.downloadUrl || edit.composition.outputUrl} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"><LuDownload />{t("download")}</a><Link href={`/project/${id}/export`} className="inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-medium text-primary hover:bg-primary/10">{t("openExport")}</Link></div></>}
              <Button variant="ghost" size="sm" className="mt-2 h-10 w-full text-xs" onClick={() => loadEditAsDraft(edit)}><LuRotateCcw />{t("loadDraft")}</Button>
            </div>)}</div> : <p className="text-sm text-muted-foreground">{t("noVersions")}</p>}
          </div>
        </aside>
      </section>
    </main>
  );
}
