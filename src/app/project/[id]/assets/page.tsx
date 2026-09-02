"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { LuZap, LuCheck, LuCircleX, LuImage, LuArrowRight, LuLoaderCircle, LuTriangleAlert, LuUpload, LuScissors } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { mergeCustomModels, buildImageOptions, buildVideoOptions, toEditVariant } from "@/lib/gen-params";
import { useCharacterStore } from "@/lib/stores/project-store";
import type { Shot } from "@/lib/db/schema";
import { buildAssetRows, shouldOfferStockFill, needsImageModelWarning, nextChainKeyframe, type AssetItem, chainByDefault } from "@/lib/assets-view";
import { realMixFromRows, shotReality } from "@/lib/real-mix";
import { buildMotionPrompt } from "@/lib/motion-prompt";
import { keyframeInstantLine, keyframeStaticWarnings } from "@/lib/prompt-lint";
import { applyRetakePatch, RETAKE_SYMPTOMS, type RetakeSymptom } from "@/lib/retake-patch";
import {
  CAMERA_PRESETS,
  CAMERA_PRESET_CATEGORIES,
  getCameraPreset,
  cameraPresetPrompt,
  recommendedPresets,
  findPresetByPrompt,
  mixablePresets,
  mixCameraPrompt,
  type CameraPresetCategory,
} from "@/lib/camera-presets";
import { LOOK_PRESETS, getLookPreset, lookImageSuffix } from "@/lib/look-presets";
import { realFaceLine } from "@/lib/presenters";
import { modelSupportsLastFrame } from "@/lib/video-composer/transitions";
import {
  buildVideoControlPlan,
  sanitizeVideoControlSummary,
} from "@/lib/video-control-plan";
import type { GenerationControlSummary } from "@/lib/video-repair-plan";
import { useT, useLocale } from "@/lib/i18n";
import { ProjectHeader } from "@/components/project-header";
import { ModelCapabilityPreflight } from "@/components/model-capability-preflight";
import {
  checkPromptConsistency,
  compileCreativePrompt,
  sanitizeCreativeIntent,
  sanitizeVisualBible,
  type CreativeIntent,
  type VisualBible,
} from "@/lib/production-system";

// shot type labels (label changed to i18n key in the assets namespace, resolved per locale)
const shotTypeLabels: Record<Shot["type"], { key: string; color: string }> = {
  hook: { key: "shotTypeHook", color: "bg-red-500/20 text-red-400" },
  pain_point: { key: "shotTypePainPoint", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { key: "shotTypeProductReveal", color: "bg-blue-500/20 text-blue-400" },
  demo: { key: "shotTypeDemo", color: "bg-green-500/20 text-green-400" },
  social_proof: { key: "shotTypeSocialProof", color: "bg-purple-500/20 text-purple-400" },
  cta: { key: "shotTypeCta", color: "bg-amber-500/20 text-amber-400" },
};

// platform info for the default image model (used when initiating generation requests)
interface ImageModelTarget {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  supportsAudio?: boolean;
}

// persisted cloud AI task row (from /api/ai/tasks, issue #16 recovery flow)
interface PendingAiTask {
  id: string;
  shotId: number | null;
  provider: string;
  model: string;
  taskId: string;
  status: "submitted" | "processing" | "completed" | "failed" | "unknown";
  controlPlan?: GenerationControlSummary | null;
}

// shot types that "feature the product": when product fidelity is enabled, these AI shots use image-to-image (redraw with product photo to lock in the subject)
const PRODUCT_SHOT_TYPES = new Set(["product_reveal", "demo", "cta"]);

export default function AssetsPage() {
  const t = useT("assets");
  const tc = useT("common");
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const { providers, defaultImageModel, defaultVideoModel, customModels, imageParams, videoParams, llm, motionIntensity, setMotionIntensity, motionRealism, setMotionRealism, chainMode, setChainMode, visualLook, setVisualLook } = useSettingsStore();
  // beginner/director split: simple mode hides the director panel, the storyboard-grid button
  // and per-shot camera tooling — beginners see shots + generate, nothing else
  const uiMode = useSettingsStore((st) => st.uiMode);

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [productImages, setProductImages] = useState<string[]>([]);
  // product fidelity: when AI generates shots featuring the product, use the original product photo as a reference for redrawing to prevent AI from altering the product (critical for commerce)
  const [productSafe, setProductSafe] = useState(true);
  // after image generation, automatically run image-to-video to produce real motion shots (i2v quality path, replacing fake Ken-Burns camera moves). Only active when a video model is configured.
  const [autoMotion, setAutoMotion] = useState(true);
  const [projectName, setProjectName] = useState("");
  // project type: topic (one-sentence-to-video without a product) uses the free stock library for automatic visuals
  const [contentType, setContentType] = useState<string>("");
  // project product category — unlocks the category physical-realism layers in the i2v motion prompt
  const [projectCategory, setProjectCategory] = useState<string>("");
  const [projectCreativeIntent, setProjectCreativeIntent] = useState<CreativeIntent>({ subject: "" });
  const [projectVisualBible, setProjectVisualBible] = useState<VisualBible>({ characterAnchors: [], productAnchors: [], wardrobeAnchors: [], environmentAnchors: [], lightingAnchors: [], forbiddenChanges: [] });
  // real tail frames of videos generated THIS session (shotId → extracted last-frame URL);
  // tail-chain mode starts the next shot from here for a pixel-continuous cut
  const lastFrameByShot = useRef(new Map<number, string>());
  const [modelTarget, setModelTarget] = useState<ImageModelTarget | null>(null);
  const [videoModelTarget, setVideoModelTarget] = useState<ImageModelTarget | null>(null);
  // shots currently being converted to motion
  const [motionShots, setMotionShots] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  // state for "auto-fill visuals (free stock)" feature
  const [isFillingStock, setIsFillingStock] = useState(false);
  const [stockMsg, setStockMsg] = useState<string | null>(null);
  // cloud paid tasks with unretrieved results (issue #16): submitted/processing/unknown rows
  // persisted server-side the moment the provider acknowledged the task
  const [pendingTasks, setPendingTasks] = useState<PendingAiTask[]>([]);
  const [resumingTasks, setResumingTasks] = useState<Set<string>>(new Set());
  const [taskMsg, setTaskMsg] = useState<string | null>(null);
  // per-shot camera editing (preset picker + inline free text): edits persist into the
  // selected script's shots via the scripts PATCH, so the next (re)generation uses them
  const [scriptId, setScriptId] = useState<string>("");
  const [editingCameraShot, setEditingCameraShot] = useState<number | null>(null);
  const [cameraDraft, setCameraDraft] = useState("");
  const [savingCameraShot, setSavingCameraShot] = useState<number | null>(null);
  // storyboard grid: one generation renders all shots in a 3x3 grid → cells become keyframes
  const [isGridGenerating, setIsGridGenerating] = useState(false);
  const [gridNotice, setGridNotice] = useState<string | null>(null);
  // grid→film: one reference-to-video call turns all keyframes into a full multi-shot film
  const [isFilmGenerating, setIsFilmGenerating] = useState(false);
  const [filmNotice, setFilmNotice] = useState<{ text: string; url?: string } | null>(null);
  // on-camera presenter from the character library; their multi-view sheet rides the
  // grid and film passes as an identity reference so the person stops morphing
  const { characters: presenterLib } = useCharacterStore();
  const [presenterId, setPresenterId] = useState("");
  const presenterSheet = presenterLib.find((c) => c.id === presenterId)?.referenceImages?.[0];

  const doneCount = assets.filter((a) => a.status === "done").length;
  const allDone = assets.length > 0 && doneCount === assets.length;
  // real/AI mix metering (duration-weighted) — Douyin tilts traffic toward hybrid content at ≥50% real
  const mix = realMixFromRows(assets);
  // when no image model is configured (modelTarget is null), offer key-free users a free stock fill entry point
  const offerStockFill = !loading && shouldOfferStockFill(assets, contentType, modelTarget !== null);
  // only show the "configure a model" warning when there are still AI shots that need generating (no warning once everything is ready, to avoid contradicting the "all done" state)
  const showModelWarning = !loading && needsImageModelWarning(assets, modelTarget !== null);

  // load real data: project info + selected script shots + resolve the provider for the default image model
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [projectRes, scriptsRes, assetsRes] = await Promise.all([
          fetch(`/api/project/${id}`),
          fetch(`/api/project/${id}/scripts`),
          fetch(`/api/project/${id}/assets`),
        ]);

        const project = projectRes.ok ? await projectRes.json() : null;
        const scripts = scriptsRes.ok ? await scriptsRes.json() : [];
        const savedAssets = assetsRes.ok ? await assetsRes.json() : [];
        if (cancelled) return;

        const imgs: string[] = project && Array.isArray(project.productImages) ? project.productImages : [];
        if (project) {
          setProjectName(project.name ?? project.productName ?? "");
          setProductImages(imgs);
          setContentType(typeof project.contentType === "string" ? project.contentType : "");
          setProjectCategory(typeof project.productCategory === "string" ? project.productCategory : "");
          setProjectCreativeIntent(sanitizeCreativeIntent(project.creativeIntent));
          setProjectVisualBible(sanitizeVisualBible(project.visualBible));
          if (Array.isArray(project.productionWorkflow)) {
            const motionStage = project.productionWorkflow.find((stage: { id?: unknown }) => stage.id === "motion");
            if (motionStage) setAutoMotion(motionStage.enabled !== false);
          }
        }

        // use the selected script (fall back to the first one if none is marked selected)
        const selected = Array.isArray(scripts)
          ? scripts.find((s: { selected?: boolean }) => s.selected) ?? scripts[0]
          : null;

        if (!selected || !Array.isArray(selected.shots) || selected.shots.length === 0) {
          setAssets([]);
          setLoadError(t("errorNoScript"));
          return;
        }
        // remember which script row the view came from — camera edits PATCH back into it
        setScriptId(typeof selected.id === "string" ? selected.id : "");

        // selected script shots + persisted assets → view rows (shared pure function used by "refresh after filling visuals")
        const rows = buildAssetRows(selected.shots as Shot[], Array.isArray(savedAssets) ? savedAssets : [], imgs);
        for (const row of rows) if (row.lastFrameUrl) lastFrameByShot.current.set(row.shotId, row.lastFrameUrl);
        setAssets(rows);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : t("errorLoadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // re-fetch project / scripts / assets and rebuild view rows (refresh thumbnails after filling visuals, reuses the same pure function)
  const reloadAssets = useCallback(async () => {
    const [projectRes, scriptsRes, assetsRes] = await Promise.all([
      fetch(`/api/project/${id}`),
      fetch(`/api/project/${id}/scripts`),
      fetch(`/api/project/${id}/assets`),
    ]);
    const project = projectRes.ok ? await projectRes.json() : null;
    const scripts = scriptsRes.ok ? await scriptsRes.json() : [];
    const savedAssets = assetsRes.ok ? await assetsRes.json() : [];
    const imgs: string[] = project && Array.isArray(project.productImages) ? project.productImages : [];
    const selected = Array.isArray(scripts)
      ? scripts.find((s: { selected?: boolean }) => s.selected) ?? scripts[0]
      : null;
    if (selected && Array.isArray(selected.shots)) {
      setScriptId(typeof selected.id === "string" ? selected.id : "");
      const rows = buildAssetRows(selected.shots as Shot[], Array.isArray(savedAssets) ? savedAssets : [], imgs);
      for (const row of rows) if (row.lastFrameUrl) lastFrameByShot.current.set(row.shotId, row.lastFrameUrl);
      setAssets(rows);
    }
  }, [id]);

  // persist a per-shot camera edit into the selected script (scripts PATCH whitelists `camera`),
  // then mirror it into the view rows so the next generateMotion call picks it up immediately
  const saveCamera = useCallback(
    async (shotId: number, text: string) => {
      const trimmed = text.trim();
      setEditingCameraShot(null);
      const current = assets.find((a) => a.shotId === shotId);
      if (!scriptId || trimmed === (current?.camera ?? "")) return;
      setSavingCameraShot(shotId);
      try {
        const res = await fetch(`/api/project/${id}/scripts`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scriptId, shotTexts: [{ shotId, camera: trimmed }] }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || t("cameraSaveFailed"));
        }
        setAssets((prev) => prev.map((a) => (a.shotId === shotId ? { ...a, camera: trimmed || undefined } : a)));
      } catch (e) {
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, error: e instanceof Error ? e.message : t("cameraSaveFailed") } : a))
        );
      } finally {
        setSavingCameraShot(null);
      }
    },
    [assets, scriptId, id, t]
  );

  // Apply a named camera preset; sentence language follows the script.
  const applyCameraPreset = useCallback(
    (shotId: number, presetId: string) => {
      const preset = getCameraPreset(presetId);
      const asset = assets.find((a) => a.shotId === shotId);
      if (!preset || !asset) return;
      void saveCamera(shotId, cameraPresetPrompt(preset, `${asset.camera ?? ""}${asset.description ?? ""}`));
    },
    [assets, saveCamera]
  );

  // Combine the currently applied preset with a second compatible move.
  // Only offered while the camera text exactly equals a preset sentence — after mixing it
  // no longer does, which naturally caps the stack at two moves.
  const applyCameraMix = useCallback(
    (shotId: number, basePresetId: string, overlayPresetId: string) => {
      const base = getCameraPreset(basePresetId);
      const overlay = getCameraPreset(overlayPresetId);
      const asset = assets.find((a) => a.shotId === shotId);
      if (!base || !overlay || !asset) return;
      const mixed = mixCameraPrompt(base, overlay, `${asset.camera ?? ""}${asset.description ?? ""}`);
      if (mixed) void saveCamera(shotId, mixed);
    },
    [assets, saveCamera]
  );

  // one-click "auto-fill visuals (free stock)": pull visuals from the free stock library (keyless Openverse images) shot-by-shot using search terms.
  // no image generation key required — this is the key step in the zero-barrier "one-sentence topic video" closed loop.
  // per-shot local image/video upload: a single hidden input, click sets the target shot; onChange uploads
  // then persists as that shot's asset. This unblocks user_upload shots (which had no action = dead end)
  // and lets users replace an AI/stock visual with their own footage.
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadShot = useRef<number | null>(null);
  const [uploadingShot, setUploadingShot] = useState<number | null>(null);
  const openUploadFor = (shotId: number) => {
    pendingUploadShot.current = shotId;
    uploadInputRef.current?.click();
  };
  const onUploadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const shotId = pendingUploadShot.current;
    e.target.value = ""; // allow re-picking the same file later
    if (!file || shotId == null) return;
    setUploadingShot(shotId);
    try {
      const fd = new FormData();
      fd.append("files", file);
      fd.append("projectId", id);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || !upData.paths?.[0]) throw new Error(upData.error || t("uploadFailed"));
      const res = await fetch(`/api/project/${id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotId, sourceUrl: upData.paths[0], type: "user_upload" }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || t("uploadFailed")); }
      await reloadAssets();
    } catch (err) {
      setStockMsg(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setUploadingShot(null);
      pendingUploadShot.current = null;
    }
  };

  const fillStock = useCallback(async () => {
    if (isFillingStock) return;
    setIsFillingStock(true);
    setStockMsg(null);
    try {
      const res = await fetch(`/api/project/${id}/stock-fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // free sources are primarily Openverse images (video sources require a Pexels/Pixabay key, to be integrated in settings later)
        // llmConfig opt-in: semantic rerank picks the best-matching footage per shot (heuristic fallback inside the route)
        body: JSON.stringify({
          source: "all",
          mediaType: "image",
          ...(llm.baseUrl && llm.model ? { llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model } } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("stockFillFailed"));
      await reloadAssets();
      setStockMsg(
        t("stockFilledMsg", { filled: data.filled ?? 0, total: data.total ?? 0 }) +
          (data.sameSourceHits ? t("stockSameSourceMsg", { n: data.sameSourceHits }) : "") +
          // fallback transparency: name the shots that got generic filler footage so the user knows
          // exactly which ones to swap, instead of discovering off-topic visuals in the final video
          (Array.isArray(data.universalFallbacks) && data.universalFallbacks.length
            ? t("stockUniversalFallbackMsg", { shots: data.universalFallbacks.join("、") })
            : "")
      );
    } catch (e) {
      setStockMsg(e instanceof Error ? e.message : t("stockFillFailed"));
    } finally {
      setIsFillingStock(false);
    }
  }, [id, isFillingStock, reloadAssets, t, llm.baseUrl, llm.apiKey, llm.model]);

  // resolve the provider for the default image model (locate provider by model from /api/ai/models aggregated results)
  useEffect(() => {
    let cancelled = false;
    const enabled = Object.entries(providers)
      .filter(([, p]) => p.enabled && p.apiKey)
      .map(([name, p]) => ({ name, apiKey: p.apiKey, baseUrl: p.baseUrl }));
    if (enabled.length === 0 || !defaultImageModel) {
      setModelTarget(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: enabled, mediaType: "image" }),
        });
        if (!res.ok) return;
        const data = await res.json();
        // merge user-defined custom models so they can also be resolved to their provider
        const merged = mergeCustomModels(data.models ?? [], customModels, "image", new Set(enabled.map((e) => e.name)));
        const model = merged.find((m) => m.id === defaultImageModel);
        if (cancelled || !model) return;
        const prov = enabled.find((e) => e.name === model.provider);
        if (prov) {
          setModelTarget({ provider: prov.name, model: defaultImageModel, apiKey: prov.apiKey, baseUrl: prov.baseUrl });
        }
      } catch {
        // ignore; generateOne will surface the "not configured" error when called
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providers, defaultImageModel, customModels]);

  // resolve the provider for the default video model (used for "convert to motion shot")
  useEffect(() => {
    let cancelled = false;
    const enabled = Object.entries(providers)
      .filter(([, p]) => p.enabled && p.apiKey)
      .map(([name, p]) => ({ name, apiKey: p.apiKey, baseUrl: p.baseUrl }));
    if (enabled.length === 0 || !defaultVideoModel) {
      setVideoModelTarget(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: enabled, mediaType: "video" }),
        });
        if (!res.ok) return;
        const data = await res.json();
        // merge user-defined custom video models
        const merged = mergeCustomModels(data.models ?? [], customModels, "video", new Set(enabled.map((e) => e.name)));
        const model = merged.find((m) => m.id === defaultVideoModel);
        if (cancelled || !model) return;
        const prov = enabled.find((e) => e.name === model.provider);
        if (prov) {
          setVideoModelTarget({ provider: prov.name, model: defaultVideoModel, apiKey: prov.apiKey, baseUrl: prov.baseUrl, supportsAudio: model.supportsAudio });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providers, defaultVideoModel, customModels]);

  // load cloud tasks whose results were never retrieved (issue #16) so the user can
  // recover a paid task instead of resubmitting (and paying again)
  const reloadPendingTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/tasks?projectId=${id}&active=1`);
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows)) setPendingTasks(rows);
    } catch {
      // recovery UI is best-effort; never block the page on it
    }
  }, [id]);

  useEffect(() => {
    reloadPendingTasks();
  }, [reloadPendingTasks]);

  // save a generated video as the shot's asset (shared by the normal flow and task recovery).
  // keyframeUrl = the static first frame the i2v ran from: persisted as thumbnailPath so the
  // keyframe survives the upsert — it powers the per-shot motion re-run and keyframe chaining
  const saveVideoAsset = useCallback(
    async (shotId: number, url: string, prompt: string | undefined, provider: string, model: string, keyframeUrl?: string, generationPlan?: GenerationControlSummary | null) => {
      const saveRes = await fetch(`/api/project/${id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shotId, type: "ai_generate", sourceUrl: url, prompt, provider, model,
          ...(keyframeUrl && { thumbnailPath: keyframeUrl }),
          ...(generationPlan && { generationPlan }),
        }),
      });
      let savedUrl = url;
      let savedLastFrame: string | undefined;
      if (saveRes.ok) {
        const saved = await saveRes.json();
        if (saved.filePath) savedUrl = saved.filePath;
        // the server extracted this clip's REAL last frame — remember it for tail-chaining
        if (typeof saved.lastFrameUrl === "string") {
          savedLastFrame = saved.lastFrameUrl;
          lastFrameByShot.current.set(shotId, saved.lastFrameUrl);
        }
      }
      setAssets((prev) =>
        prev.map((a) =>
          a.shotId === shotId
            ? {
                ...a,
                status: "done",
                thumbnailUrl: keyframeUrl ?? savedUrl,
                isVideo: true,
                keyframeUrl,
                lastFrameUrl: savedLastFrame ?? a.lastFrameUrl,
                generationPlan: generationPlan ?? a.generationPlan,
                error: undefined,
              }
            : a
        )
      );
    },
    [id]
  );

  // resume a persisted cloud task: query (and wait for) its status, then save the result
  const resumeTask = useCallback(
    async (task: PendingAiTask) => {
      const prov = providers[task.provider];
      if (!prov?.apiKey) {
        setTaskMsg(t("errorNoVideoModel"));
        return;
      }
      setResumingTasks((prev) => new Set(prev).add(task.id));
      setTaskMsg(null);
      try {
        const res = await fetch("/api/ai/video/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: task.provider,
            apiKey: prov.apiKey,
            baseUrl: prov.baseUrl,
            taskId: task.taskId,
            wait: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("taskResumeFailed"));
        if (data.status === "completed" && data.videoUrls?.[0]) {
          if (task.controlPlan && "kind" in task.controlPlan && task.controlPlan.kind === "repair") {
            const finalizeRes = await fetch(`/api/project/${id}/repair`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "finalize", plan: task.controlPlan, resultUrl: data.videoUrls[0] }),
            });
            const finalized = await finalizeRes.json();
            if (!finalizeRes.ok) throw new Error(finalized.error || t("taskResumeFailed"));
            await reloadAssets();
          } else if (task.shotId != null) {
            const asset = assets.find((a) => a.shotId === task.shotId);
            // best-effort keyframe provenance: the task was submitted from the shot's static frame
            const keyframe = asset && !asset.isVideo ? asset.thumbnailUrl : asset?.keyframeUrl;
            await saveVideoAsset(task.shotId, data.videoUrls[0], asset?.prompt, task.provider, task.model, keyframe, task.controlPlan);
          }
          setTaskMsg(t("taskResumeDone"));
        } else if (data.status === "failed" || data.status === "cancelled") {
          setTaskMsg(`${t("taskResumeFailed")}${data.error ? `: ${data.error}` : ""}`);
        } else {
          setTaskMsg(t("taskResumeProcessing"));
        }
        await reloadPendingTasks();
      } catch (e) {
        setTaskMsg(e instanceof Error ? e.message : t("taskResumeFailed"));
      } finally {
        setResumingTasks((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    },
    [providers, assets, saveVideoAsset, reloadAssets, reloadPendingTasks, id, t]
  );

  // convert to motion shot: use the already-generated image for this shot as the first frame, call the image-to-video model, and save the result as the shot's asset (video).
  // Keyframe chaining: when the next shot's static keyframe exists and the model
  // supports a pinned last frame, the clip ends by flowing into the next scene — the transition is
  // generated inside the clip, and the composer's hard concat becomes seamless.
  const generateMotion = useCallback(
    async (shotId: number, firstFrameOverride?: string, lastFrameOverride?: string | null, retake?: RetakeSymptom) => {
      const asset = assets.find((a) => a.shotId === shotId);
      // prefer the freshly passed URL for the first frame: during auto-chaining React state hasn't updated yet, so the thumbnailUrl in the closure is stale
      const firstFrame = firstFrameOverride || asset?.thumbnailUrl;
      if (!firstFrame) return;
      if (!videoModelTarget) {
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, error: t("errorNoVideoModel") } : a))
        );
        return;
      }
      // chain target: explicit override wins (null = explicitly no chain); otherwise the next shot's static keyframe
      const chainFrame =
        chainMode !== "pin" || lastFrameOverride === null || !modelSupportsLastFrame(videoModelTarget.model)
          ? undefined
          : lastFrameOverride ??
            // demo-type shots skip auto-chaining (their ending IS the content); explicit override still chains
            (chainByDefault(asset?.type) ? nextChainKeyframe(assets, shotId) : undefined);
      // tail mode: the previous shot's REAL last frame (extracted server-side after its save)
      // becomes this shot's first frame — pixel-continuous seam; falls back to own keyframe
      let tailFirstFrame: string | undefined;
      if (chainMode === "tail" && !firstFrameOverride) {
        const idx = assets.findIndex((a) => a.shotId === shotId);
        const prev = idx > 0 ? assets[idx - 1] : undefined;
        if (prev) tailFirstFrame = prev.lastFrameUrl ?? lastFrameByShot.current.get(prev.shotId);
      }
      const effectiveFirstFrame = tailFirstFrame ?? firstFrame;
      setMotionShots((prev) => new Set(prev).add(shotId));
      // Motion prompt, not the static image prompt: the first frame already fixes the
      // composition — the text's job is camera path + subject action + fidelity constraints
      const motionPrompt = buildMotionPrompt({
        shotType: asset?.type,
        camera: asset?.camera,
        description: asset?.description,
        productShot: asset?.visualSource === "product_image" || PRODUCT_SHOT_TYPES.has(asset?.type ?? ""),
        chainToNext: !!chainFrame,
        intensity: motionIntensity,
        personShot: !!asset?.characterId,
        // a character WITH a line is a talking shot: mid-conversation direction + rotating
        // behavior beats (seeded by shot position so a batch never repeats the same gestures)
        talking: !!asset?.characterId && !!asset?.voiceover?.trim(),
        beatSeed: assets.findIndex((a) => a.shotId === shotId),
        // global look: short lighting anchor keeps the palette from drifting through the i2v pass;
        // "real"-family looks also prepend their camera-identity opener (front tokens weigh most)
        look: getLookPreset(visualLook)?.motion,
        opener: getLookPreset(visualLook)?.opener,
        // category physical-realism layers (tier is a user single-select; "auto" by default)
        category: projectCategory,
        realism: motionRealism,
      });
      // diagnosis retake (user-initiated, billed): patch exactly ONE dimension onto the prompt.
      // Base = the freshly rebuilt prompt — deterministic, so with unchanged settings it equals
      // what the previous submit sent, and the patch is the only difference.
      const projectDirection = compileCreativePrompt({
        ...projectCreativeIntent,
        continuity: [...(projectCreativeIntent.continuity ?? []), ...projectVisualBible.characterAnchors, ...projectVisualBible.wardrobeAnchors, ...projectVisualBible.environmentAnchors, ...projectVisualBible.lightingAnchors],
        productConstraints: [...(projectCreativeIntent.productConstraints ?? []), ...projectVisualBible.productAnchors],
      });
      let finalPrompt = projectDirection.prompt ? `${motionPrompt}. Project direction: ${projectDirection.prompt}` : motionPrompt;
      if (retake) {
        const patched = applyRetakePatch(finalPrompt, retake);
        finalPrompt = patched.prompt;
        setTaskMsg(t("retakeApplied", { change: locale === "zh" ? patched.change.zh : patched.change.en }));
      }
      const assetIndex = assets.findIndex((item) => item.shotId === shotId);
      const previousAsset = assetIndex > 0 ? assets[assetIndex - 1] : undefined;
      const previousTail = previousAsset?.lastFrameUrl ?? (previousAsset ? lastFrameByShot.current.get(previousAsset.shotId) : undefined);
      const characterReference = asset?.characterId
        ? presenterLib.find((character) => character.id === asset.characterId)?.referenceImages?.[0] ?? presenterSheet
        : undefined;
      const productReference = productSafe && (asset?.visualSource === "product_image" || PRODUCT_SHOT_TYPES.has(asset?.type ?? ""))
        ? productImages[0]
        : undefined;
      const controlPlan = buildVideoControlPlan({
        provider: videoModelTarget.provider,
        modelId: videoModelTarget.model,
        supportsAudio: videoModelTarget.supportsAudio,
        firstFrameUrl: effectiveFirstFrame,
        lastFrameUrl: chainFrame,
        characterReferenceUrl: characterReference,
        productReferenceUrl: productReference,
        continuityReferenceUrl: previousTail,
        voiceover: asset?.voiceover,
        speakerVisible: Boolean(asset?.characterId),
        description: asset?.description,
        locale,
      });
      if (controlPlan.promptSuffix) finalPrompt = `${finalPrompt}. ${controlPlan.promptSuffix}`;
      const consistencyFailure = checkPromptConsistency(finalPrompt, projectVisualBible).find((issue) => issue.severity === "fail");
      if (consistencyFailure) {
        setAssets((prev) => prev.map((item) => item.shotId === shotId ? { ...item, error: t("visualBibleBlocked", { anchor: consistencyFailure.anchor }) } : item));
        setMotionShots((prev) => { const next = new Set(prev); next.delete(shotId); return next; });
        return;
      }
      // per-shot duration: the composer's slot follows the script duration (voice-fitted), and the
      // composer trims overshoot from the TAIL — which would cut a chained ending. Round to the
      // model's supported range instead of always sending the global 5s default.
      const videoOptions = buildVideoOptions(videoParams);
      if (projectDirection.negativePrompt) {
        videoOptions.negativePrompt = [videoOptions.negativePrompt, projectDirection.negativePrompt].filter(Boolean).join(", ");
      }
      if (asset?.duration) {
        videoOptions.duration = Math.min(15, Math.max(4, Math.round(asset.duration)));
      }
      if (controlPlan.audioMode === "native") {
        videoOptions.audioEnabled = true;
        if (asset?.voiceover?.trim()) videoOptions.voiceover = asset.voiceover.trim();
        if (controlPlan.audioPrompt) videoOptions.audioPrompt = controlPlan.audioPrompt;
      }
      const referenceImageUrls = controlPlan.referenceInputs.filter((item) => item.mediaType === "image").map((item) => item.url);
      const referenceVideoUrls = controlPlan.referenceInputs.filter((item) => item.mediaType === "video").map((item) => item.url);
      const referenceAudioUrls = controlPlan.referenceInputs.filter((item) => item.mediaType === "audio").map((item) => item.url);
      const controlSummary = sanitizeVideoControlSummary(controlPlan);
      try {
        const res = await fetch("/api/ai/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: videoModelTarget.provider,
            model: videoModelTarget.model,
            apiKey: videoModelTarget.apiKey,
            baseUrl: videoModelTarget.baseUrl,
            mode: controlPlan.mode,
            prompt: finalPrompt,
            ...(controlPlan.firstFrameUrl && { imageUrl: controlPlan.firstFrameUrl }),
            ...(controlPlan.lastFrameUrl && { lastImageUrl: controlPlan.lastFrameUrl }),
            ...(referenceImageUrls.length && { referenceImageUrls }),
            ...(referenceVideoUrls.length && { referenceVideoUrls }),
            ...(referenceAudioUrls.length && { referenceAudioUrls }),
            ...(controlSummary && { controlPlan: controlSummary }),
            // issue #16: identify the task server-side so the paid task ID is persisted
            // against this project/shot and stays recoverable after timeout or restart
            projectId: id,
            shotId,
            // user-defined video parameters (aspect ratio / resolution / duration / frame rate / motion / seed / negative prompt)
            options: videoOptions,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          // the paid task may already exist in the cloud — surface its ID and the recovery
          // path instead of a bare failure that invites a duplicate (billed) resubmit
          if (data.taskId) {
            await reloadPendingTasks();
            throw new Error(
              t("errorWithTaskId", { msg: data.error || t("errorImageToVideoFailed"), taskId: data.taskId })
            );
          }
          throw new Error(data.error || t("errorImageToVideoFailed"));
        }
        const url = data.videoUrls?.[0];
        if (!url) throw new Error(t("errorEmptyResult"));
        // save as this shot's asset (video will be downloaded locally); compose processes it as a video clip (including native audio track detection).
        // Persist the motion prompt actually sent AND the source keyframe (provenance + re-run/chaining)
        await saveVideoAsset(shotId, url, finalPrompt, videoModelTarget.provider, data.modelId || videoModelTarget.model, effectiveFirstFrame, controlSummary);
      } catch (e) {
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, error: e instanceof Error ? e.message : t("errorImageToVideoFailed") } : a))
        );
      } finally {
        setMotionShots((prev) => {
          const next = new Set(prev);
          next.delete(shotId);
          return next;
        });
      }
    },
    [assets, videoModelTarget, id, videoParams, motionIntensity, motionRealism, chainMode, projectCategory, projectCreativeIntent, projectVisualBible, visualLook, productSafe, productImages, presenterLib, presenterSheet, saveVideoAsset, reloadPendingTasks, t, locale]
  );

  // actually generate a single asset. Returns the saved static keyframe URL (undefined on failure) so
  // the batch flow can run a second keyframe-chained motion pass without re-reading stale React state.
  const generateOne = useCallback(
    async (shotId: number, opts?: { skipMotion?: boolean }): Promise<string | undefined> => {
      const asset = assets.find((a) => a.shotId === shotId);
      if (!asset) return undefined;

      // product image shot: use the product photo directly, no AI call needed (persisted for the composer to read)
      if (asset.visualSource === "product_image") {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId ? { ...a, status: "done", thumbnailUrl: productImages[0] } : a
          )
        );
        if (productImages[0]) {
          fetch(`/api/project/${id}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shotId, type: "product_image", sourceUrl: productImages[0] }),
          }).catch(() => {});
          // auto motion: use the product image as the first frame and run image-to-video (bring the real product to life); falls back to a static image on failure
          if (!opts?.skipMotion && autoMotion && videoModelTarget) await generateMotion(shotId, productImages[0]);
        }
        return productImages[0];
      }

      // AI-generated shot: requires a default image model to be configured
      if (!modelTarget) {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId
              ? { ...a, status: "failed", error: t("errorNoImageModel") }
              : a
          )
        );
        return undefined;
      }

      setAssets((prev) => prev.map((a) => (a.shotId === shotId ? { ...a, status: "generating", error: undefined } : a)));

      // product fidelity: AI shot featuring product + product image available + toggle on → redraw with product image (image-to-image, locks in the product subject)
      const useProductSafe =
        productSafe && !!productImages[0] && PRODUCT_SHOT_TYPES.has(asset.type);
      const genModel = useProductSafe ? toEditVariant(modelTarget.model) : modelTarget.model;
      const genMode = useProductSafe ? "image-to-image" : "text-to-image";
      const basePrompt = asset.prompt || asset.description;
      // cast shots: pin the anti-"AI face" realism constraint onto the keyframe too,
      // so the person is ordinary-looking from the very first frame the i2v runs on
      const castSuffix = asset.characterId ? `。${realFaceLine(basePrompt)}` : "";
      // global look: one lighting/palette block across every keyframe keeps shots in one video
      // from drifting between styles (the LLM improvises style words per shot otherwise)
      const lookText = lookImageSuffix(visualLook, basePrompt);
      const lookSuffix = lookText ? `。${lookText}` : "";
      // frame-position directive: a keyframe is the frozen instant JUST BEFORE the action,
      // holding visible potential energy — gives the i2v pass a beat to play out instead of
      // animating an already-completed pose
      const frameSuffix = `。${keyframeInstantLine(basePrompt)}`;
      const shotPrompt = useProductSafe
        ? `${basePrompt}。严格保持商品的外观、包装、颜色、logo 和文字完全不变，只重绘符合描述的场景、背景与光线。${castSuffix}${lookSuffix}${frameSuffix}`
        : `${basePrompt}${castSuffix}${lookSuffix}${frameSuffix}`;
      const projectDirection = compileCreativePrompt({
        ...projectCreativeIntent,
        continuity: [...(projectCreativeIntent.continuity ?? []), ...projectVisualBible.characterAnchors, ...projectVisualBible.wardrobeAnchors, ...projectVisualBible.environmentAnchors, ...projectVisualBible.lightingAnchors],
        productConstraints: [...(projectCreativeIntent.productConstraints ?? []), ...projectVisualBible.productAnchors],
      });
      const genPrompt = projectDirection.prompt ? `${shotPrompt}. Project direction: ${projectDirection.prompt}` : shotPrompt;
      const consistencyFailure = checkPromptConsistency(genPrompt, projectVisualBible).find((issue) => issue.severity === "fail");
      if (consistencyFailure) {
        setAssets((prev) => prev.map((item) => item.shotId === shotId ? { ...item, status: "failed", error: t("visualBibleBlocked", { anchor: consistencyFailure.anchor }) } : item));
        return undefined;
      }

      try {
        const res = await fetch("/api/ai/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: id,
            provider: modelTarget.provider,
            model: genModel,
            apiKey: modelTarget.apiKey,
            baseUrl: modelTarget.baseUrl,
            mode: genMode,
            prompt: genPrompt,
            ...(useProductSafe && { imageUrl: productImages[0] }),
            // user-defined image parameters (aspect ratio → dimensions / count / steps / guidance / seed / negative prompt)
            options: (() => {
              const options = buildImageOptions(imageParams);
              if (projectDirection.negativePrompt) options.negativePrompt = [options.negativePrompt, projectDirection.negativePrompt].filter(Boolean).join(", ");
              return options;
            })(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("errorGenerateFailed"));
        const url = data.imageUrls?.[0];
        if (!url) throw new Error(t("errorEmptyResult"));
        // persist to database (remote images will be downloaded locally) so the composer can read the real AI asset
        let savedUrl = url;
        try {
          const saveRes = await fetch(`/api/project/${id}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shotId, type: "ai_generate", sourceUrl: url,
              prompt: genPrompt, provider: modelTarget.provider, model: genModel,
            }),
          });
          if (saveRes.ok) {
            const saved = await saveRes.json();
            if (saved.filePath) savedUrl = saved.filePath;
          }
        } catch {
          // persist failure doesn't affect the preview (the composer will fall back to the product image as a safety net)
        }
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, status: "done", thumbnailUrl: savedUrl } : a))
        );
        // auto motion: use the freshly generated image as the first frame and run image-to-video (real camera moves replace fake Ken-Burns); falls back to static image on failure
        if (!opts?.skipMotion && autoMotion && videoModelTarget) await generateMotion(shotId, savedUrl);
        return savedUrl;
      } catch (e) {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId ? { ...a, status: "failed", error: e instanceof Error ? e.message : t("errorGenerateFailed") } : a
          )
        );
        return undefined;
      }
    },
    [assets, id, modelTarget, productImages, productSafe, imageParams, autoMotion, videoModelTarget, projectCreativeIntent, projectVisualBible, visualLook, generateMotion, t]
  );

  // storyboard grid: ONE image generation renders every shot as a 3x3 grid cell (person /
  // outfit / room / light physically identical), the server crops cells into per-shot
  // keyframes — then the normal per-shot "animate" i2v pass takes over
  const runStoryboardGrid = useCallback(async () => {
    if (!modelTarget || !scriptId || isGridGenerating) return;
    setIsGridGenerating(true);
    setGridNotice(null);
    try {
      // identity/product anchoring: with a presenter sheet or product photo attached the
      // grid runs in edit mode (multi-reference) — field-proven to lock person AND product
      const productRef = productSafe ? productImages[0] : undefined;
      const hasRefs = !!presenterSheet || !!productRef;
      const res = await fetch(`/api/project/${id}/storyboard-grid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId,
          provider: modelTarget.provider,
          model: hasRefs ? toEditVariant(modelTarget.model) : modelTarget.model,
          apiKey: modelTarget.apiKey,
          baseUrl: modelTarget.baseUrl,
          ...(presenterSheet && { characterSheetUrl: presenterSheet }),
          ...(productRef && { productImageUrl: productRef }),
          // the grid itself is 9:16 so each of the 3x3 cells is exactly 9:16 too
          options: buildImageOptions(imageParams ? { ...imageParams, aspectRatio: "9:16", count: 1 } : undefined),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("gridFailed"));
      await reloadAssets();
      setGridNotice(t("gridDone").replace("{n}", String(data.count ?? "")));
    } catch (e) {
      setGridNotice(e instanceof Error ? e.message : t("gridFailed"));
    } finally {
      setIsGridGenerating(false);
    }
  }, [id, scriptId, modelTarget, imageParams, isGridGenerating, presenterSheet, productSafe, productImages, reloadAssets, t]);

  // grid→film (field-proven 2026-08): every shot keyframe rides ONE Seedance 2.5
  // reference-to-video call with a timecoded multi-shot prompt — native cuts, dialogue
  // spoken verbatim, continuous audio. Lands in compositions (export page shows it).
  const runStoryboardFilm = useCallback(async () => {
    if (!videoModelTarget || !scriptId || isFilmGenerating) return;
    setIsFilmGenerating(true);
    setFilmNotice(null);
    try {
      const res = await fetch(`/api/project/${id}/storyboard-film`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId,
          provider: videoModelTarget.provider,
          // an explicitly configured reference-to-video model wins; anything else upgrades to the 2.5 film default
          model: videoModelTarget.model.includes("/reference-to-video")
            ? videoModelTarget.model
            : "bytedance/seedance-2.5/reference-to-video",
          apiKey: videoModelTarget.apiKey,
          baseUrl: videoModelTarget.baseUrl,
          // presenter sheet leads reference_images as the identity anchor (@Image1)
          ...(presenterSheet && { characterSheetUrl: presenterSheet }),
          options: buildVideoOptions(videoParams ? { ...videoParams, aspectRatio: "9:16" } : undefined),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("filmFailed"));
      setFilmNotice({ text: t("filmDone"), url: data.url });
    } catch (e) {
      setFilmNotice({ text: e instanceof Error ? e.message : t("filmFailed") });
    } finally {
      setIsFilmGenerating(false);
    }
  }, [id, scriptId, videoModelTarget, videoParams, isFilmGenerating, presenterSheet, t]);

  // generate all in one click (sequential, to avoid hitting platform rate limits with concurrent requests).
  // With auto-motion on, this runs TWO passes: (1) every static keyframe, (2) keyframe-chained i2v per shot —
  // chaining needs the NEXT shot's keyframe to exist, which a single interleaved pass can't provide.
  const generateAll = useCallback(async () => {
    const pending = assets.filter((a) => a.status === "pending" || a.status === "failed");
    if (pending.length === 0) return;
    setIsBatchGenerating(true);
    const chained = autoMotion && !!videoModelTarget;
    // freshly saved keyframes by shot — React state in this closure is stale during the loop
    const savedByShot = new Map<number, string>();
    for (const asset of pending) {
      const url = await generateOne(asset.shotId, { skipMotion: chained });
      if (url) savedByShot.set(asset.shotId, url);
    }
    if (chained) {
      // pass 2: i2v in script order; each shot chains into the next shot's keyframe when available.
      // Existing static keyframes (generated in earlier sessions) participate too.
      const staticFrameOf = (a: AssetItem): string | undefined =>
        savedByShot.get(a.shotId) ?? (a.status === "done" && !a.isVideo ? a.thumbnailUrl : undefined);
      for (let i = 0; i < assets.length; i++) {
        const row = assets[i];
        if (row.isVideo) continue; // already a motion/stock video — don't re-bill
        // tail mode: sequential continuation — the previous shot's real tail frame (captured at
        // save time in this very loop) beats the shot's own keyframe as the first frame
        const tailFrame = chainMode === "tail" && i > 0 ? assets[i - 1].lastFrameUrl ?? lastFrameByShot.current.get(assets[i - 1].shotId) : undefined;
        const firstFrame = tailFrame ?? staticFrameOf(row);
        if (!firstFrame) continue;
        const next = assets[i + 1];
        // pin mode pins the next keyframe as the last frame; tail/off modes never pin
        const lastFrame = chainMode === "pin" && next && chainByDefault(row.type) ? staticFrameOf(next) : undefined;
        // null = explicitly no chain (last shot / next frame unavailable)
        await generateMotion(row.shotId, firstFrame, lastFrame ?? null);
      }
    }
    setIsBatchGenerating(false);
  }, [assets, generateOne, generateMotion, autoMotion, videoModelTarget, chainMode]);

  return (
    <div className="min-h-screen grid-bg">
      {/* project context strip: name + step navigation (global chrome lives in AppShell) */}
      <ProjectHeader projectName={projectName || t("untitledProject")} />

      {/* single hidden input reused for every per-shot upload; target shot tracked in pendingUploadShot */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onUploadFileChange}
      />

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Action bar: title + generation ACTIONS only. Creative settings live in the
            director panel below so this row stays a stable, scannable set of verbs. */}
        <div className="flex flex-wrap items-center justify-between gap-y-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {loading ? tc("loading") : t("assetsReady", { done: doneCount, total: assets.length })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/project/${id}/transcript`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/8 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <LuScissors className="h-3.5 w-3.5" />{t("textEditor")}
            </Link>
            {offerStockFill && (
              <Button
                onClick={fillStock}
                disabled={isFillingStock}
                variant="outline"
                size="sm"
                className="text-xs border-primary/50 text-primary hover:bg-primary/10"
                title={t("stockFillHint")}
              >
                {isFillingStock ? (
                  <>
                    <LuLoaderCircle className="animate-spin w-3.5 h-3.5 mr-1" />
                    {t("stockFilling")}
                  </>
                ) : (
                  <>
                    <LuImage className="w-3.5 h-3.5 mr-1" />
                    {t("stockFill")}
                  </>
                )}
              </Button>
            )}
            {/* Grid & film stay VISIBLE when their prerequisites are unmet (disabled with the
                reason in the tooltip) — hiding them made the features undiscoverable. */}
            {(() => {
              const shotsOk = assets.length >= 2 && assets.length <= 9;
              const gridReady = Boolean(modelTarget) && shotsOk;
              const gridReason = !modelTarget ? t("gridNeedModel") : !shotsOk ? t("gridNeedShots") : t("gridTip");
              const allShotsDone = shotsOk && assets.every((a) => a.status === "done");
              const filmReady = Boolean(videoModelTarget) && allShotsDone;
              const filmReason = !videoModelTarget ? t("filmNeedModel") : !allShotsDone ? t("filmNeedReady") : t("filmTip");
              return (
                <>
                  {uiMode === "pro" && (
                  <Button
                    onClick={runStoryboardGrid}
                    disabled={!gridReady || isGridGenerating || isBatchGenerating}
                    variant="outline"
                    className="text-xs"
                    title={gridReason}
                  >
                    {isGridGenerating ? (
                      <>
                        <LuLoaderCircle className="animate-spin mr-1.5 h-3.5 w-3.5" />
                        {t("gridRunning")}
                      </>
                    ) : (
                      <>{t("gridButton")}</>
                    )}
                  </Button>
                  )}
                  <Button
                    onClick={runStoryboardFilm}
                    disabled={!filmReady || isFilmGenerating || isGridGenerating || isBatchGenerating}
                    variant="outline"
                    className="text-xs border-primary/50 text-primary hover:bg-primary/10 disabled:border-border/60 disabled:text-muted-foreground"
                    title={filmReason}
                  >
                    {isFilmGenerating ? (
                      <>
                        <LuLoaderCircle className="animate-spin mr-1.5 h-3.5 w-3.5" />
                        {t("filmRunning")}
                      </>
                    ) : (
                      <>{t("filmButton")}</>
                    )}
                  </Button>
                </>
              );
            })()}
            <Button
              onClick={generateAll}
              disabled={isBatchGenerating || allDone || assets.length === 0}
              className="brand-gradient text-white text-xs"
            >
              {isBatchGenerating ? (
                <>
                  <LuLoaderCircle className="animate-spin mr-1.5 h-3.5 w-3.5" />
                  {t("generatingAll")}
                </>
              ) : allDone ? (
                t("allDone")
              ) : (
                <>
                  <LuZap className="w-3.5 h-3.5 mr-1" />
                  {t("generateAll")}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Director panel: global creative settings applied to every generation pass.
            One labeled container instead of loose pills scattered through the action bar.
            Pro mode only — beginners get working defaults without the vocabulary. */}
        {uiMode === "pro" && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-muted/10 px-3 py-2.5">
          <span className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground">{t("directorPanel")}</span>
          <Link href={`/project/${id}/production`} className="inline-flex h-8 items-center rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t("productionConsole")}
          </Link>
          {/* Presenter picker: characters from the library; ones with a multi-view sheet
              anchor the person's identity through the grid and film passes */}
          {presenterLib.length > 0 && (
            <div
              className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 pl-2.5 pr-1.5 h-8"
              title={t("presenterTip")}
            >
              <span className="text-xs font-medium text-muted-foreground">{t("presenterLabel")}</span>
              <select
                value={presenterId}
                onChange={(e) => setPresenterId(e.target.value)}
                className="bg-transparent text-xs outline-none h-6 max-w-28 text-foreground"
              >
                <option value="">{t("presenterNone")}</option>
                {presenterLib.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.referenceImages?.[0] ? ` ${t("presenterSheetBadge")}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Visual-look picker with enumerated lighting/palette
              panel): applies to keyframe image prompts AND pins lighting through the i2v pass */}
          <div
            className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 pl-2.5 pr-1.5 h-8"
            title={t("lookTip")}
          >
            <span className="text-xs font-medium text-muted-foreground">{t("lookLabel")}</span>
            <select
              value={visualLook}
              onChange={(e) => setVisualLook(e.target.value)}
              className="bg-transparent text-xs outline-none h-6 max-w-28 text-foreground"
            >
              <option value="none">{t("lookNone")}</option>
              {/* "real" family = raw phone-shot looks (UGC anti-AI-slop path); styled = art-directed */}
              <optgroup label={locale === "zh" ? "实拍感" : "Real-shot"}>
                {LOOK_PRESETS.filter((p) => p.group === "real").map((p) => (
                  <option key={p.id} value={p.id}>
                    {locale === "zh" ? p.name.zh : p.name.en}
                  </option>
                ))}
              </optgroup>
              <optgroup label={locale === "zh" ? "风格化" : "Styled"}>
                {LOOK_PRESETS.filter((p) => p.group !== "real").map((p) => (
                  <option key={p.id} value={p.id}>
                    {locale === "zh" ? p.name.zh : p.name.en}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          {videoModelTarget && (
            <div
              className="flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/20 pl-2.5 pr-1 h-8"
              title={t("motionIntensityTip")}
            >
              <span className="text-xs font-medium text-muted-foreground mr-1">{t("motionIntensity")}</span>
              {(["subtle", "normal", "strong"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMotionIntensity(v)}
                  className={`rounded-full px-2 h-6 text-xs font-medium transition-all ${
                    motionIntensity === v
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`motionIntensity_${v}`)}
                </button>
              ))}
            </div>
          )}
          {videoModelTarget && (
            <div
              className="flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/20 pl-2.5 pr-1 h-8"
              title={t("motionRealismTip")}
            >
              <span className="text-xs font-medium text-muted-foreground mr-1">{t("motionRealism")}</span>
              {(["auto", "constraints", "off"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMotionRealism(v)}
                  className={`rounded-full px-2 h-6 text-xs font-medium transition-all ${
                    motionRealism === v
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`motionRealism_${v}`)}
                </button>
              ))}
            </div>
          )}
          {videoModelTarget && modelSupportsLastFrame(videoModelTarget.model) && (
            <div
              className="flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/20 pl-2.5 pr-1 h-8"
              title={t("chainModeTip")}
            >
              <span className="text-xs font-medium text-muted-foreground mr-1">{t("chainMode")}</span>
              {(["pin", "tail", "off"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setChainMode(v)}
                  className={`rounded-full px-2 h-6 text-xs font-medium transition-all ${
                    chainMode === v
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`chainMode_${v}`)}
                </button>
              ))}
            </div>
          )}
          {videoModelTarget && (
            <button
              type="button"
              onClick={() => setAutoMotion((v) => !v)}
              title={t("autoMotionTip")}
              className={`flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-medium transition-all ${
                autoMotion
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${autoMotion ? "bg-primary" : "bg-muted-foreground/40"}`} />
              {t("autoMotion")}{autoMotion ? t("on") : t("off")}
            </button>
          )}
          {productImages.length > 0 && (
            <button
              type="button"
              onClick={() => setProductSafe((v) => !v)}
              title={t("productSafeTip")}
              className={`flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-medium transition-all ${
                productSafe
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${productSafe ? "bg-primary" : "bg-muted-foreground/40"}`} />
              {t("productSafe")}{productSafe ? t("on") : t("off")}
            </button>
          )}
        </div>
        )}

        {uiMode === "pro" && videoModelTarget && (
          <ModelCapabilityPreflight
            modelId={videoModelTarget.model}
            provider={videoModelTarget.provider}
            supportsAudio={videoModelTarget.supportsAudio}
            duration={videoParams.duration}
            resolution={videoParams.resolution}
            aspectRatio={videoParams.aspectRatio}
            chainMode={chainMode}
            audioEnabled={videoModelTarget.supportsAudio === true}
            referenceImageCount={Number(Boolean(presenterSheet)) + Number(Boolean(productSafe && productImages[0]))}
          />
        )}

        {/* storyboard-grid outcome line (success count or error) */}
        {gridNotice && (
          <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            {gridNotice}
          </div>
        )}

        {/* grid→film outcome: inline preview + export-page pointer, or the error verbatim */}
        {filmNotice && (
          <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            <div>{filmNotice.text}</div>
            {filmNotice.url && (
              <video src={filmNotice.url} controls className="mt-2 max-h-64 rounded-md" />
            )}
          </div>
        )}

        {/* auto-fill visuals hint/result (free stock, no key required, preferred path for topic
            videos). Also renders when stockMsg is set alone — per-shot upload errors land there
            and must stay visible even when the stock-fill offer itself is hidden. */}
        {(offerStockFill || stockMsg) && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 text-xs text-muted-foreground">
            <LuImage className="w-3.5 h-3.5 text-primary/70 shrink-0" />
            <span>{stockMsg ?? t("stockFillTip")}</span>
          </div>
        )}

        {/* cloud paid-task recovery (issue #16): submitted tasks whose results were never
            retrieved — offer resume instead of a duplicate (billed) resubmit */}
        {pendingTasks.length > 0 && (
          <div className="mb-6 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-start gap-3">
              <LuLoaderCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-200">
                  {t("pendingTasksTitle", { n: pendingTasks.length })}
                </p>
                <p className="text-xs text-blue-300/80 mt-0.5">{t("pendingTasksDesc")}</p>
                <div className="mt-2 space-y-1.5">
                  {pendingTasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 text-xs text-blue-200/90">
                      <span className="truncate">
                        {t("taskLabel", { shot: task.shotId ?? "-", model: task.model, taskId: task.taskId })}
                      </span>
                      <Button
                        onClick={() => resumeTask(task)}
                        disabled={resumingTasks.has(task.id)}
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px] border-blue-500/40 text-blue-300 hover:bg-blue-500/15 shrink-0"
                      >
                        {resumingTasks.has(task.id) ? (
                          <>
                            <LuLoaderCircle className="animate-spin w-3 h-3 mr-1" />
                            {t("btnResumingTask")}
                          </>
                        ) : (
                          t("btnResumeTask")
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
                {taskMsg && <p className="text-xs text-blue-300/80 mt-2">{taskMsg}</p>}
              </div>
            </div>
          </div>
        )}

        {/* no image model configured warning (only shown when there are still AI shots pending generation) */}
        {showModelWarning && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
            <LuTriangleAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-200">{t("noModelTitle")}</p>
              <p className="text-xs text-amber-300/80 mt-0.5">
                {t("noModelDesc")}
                <Link href="/settings?tab=image" className="underline ml-1">{t("goToSettings")}</Link>
              </p>
            </div>
          </div>
        )}

        {/* loading state / empty state */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <LuLoaderCircle className="w-6 h-6 animate-spin mb-3" />
            <p className="text-sm">{t("loadingShots")}</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <LuImage className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
            <Link href={`/project/${id}/script`}>
              <Button variant="outline" size="sm">{t("backToScriptStep")}</Button>
            </Link>
          </div>
        ) : (
          <>
            {/* progress bar */}
            <div className="mb-6">
              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="h-full brand-gradient transition-all duration-700 rounded-full"
                  style={{ width: `${assets.length ? (doneCount / assets.length) * 100 : 0}%` }}
                />
              </div>
              {/* real/AI mix meter — Douyin tilts traffic toward hybrid content at ≥50% real (duration-weighted) */}
              {mix.realRatio != null && (
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground" title={t("mixTiltTip")}>
                  <span className="shrink-0">{t("mixLabel")}</span>
                  <div className="h-1.5 w-32 rounded-full overflow-hidden bg-muted/30 flex shrink-0">
                    <div className="h-full bg-emerald-500/80" style={{ width: `${Math.round(mix.realRatio * 100)}%` }} />
                    <div className="h-full bg-violet-500/60" style={{ width: `${100 - Math.round(mix.realRatio * 100)}%` }} />
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {t("mixReal")} {Math.round(mix.realRatio * 100)}% · {t("mixAi")} {100 - Math.round(mix.realRatio * 100)}%
                  </span>
                  {mix.tiltEligible && <span className="text-emerald-500 truncate">✓ {t("mixTiltOk")}</span>}
                </div>
              )}
            </div>

            {/* asset list */}
            <div className="space-y-4">
              {assets.map((asset) => {
                const typeInfo = shotTypeLabels[asset.type];
                // per-shot real/AI chip (same classification as the mix meter above)
                const reality = shotReality({
                  visualSource: asset.visualSource,
                  assetType: asset.assetType,
                  done: asset.status === "done",
                });
                return (
                  <Card key={asset.shotId} className="glass-card overflow-hidden">
                    <CardContent className="p-0">
                      <div className="flex">
                        {/* left-side index */}
                        <div className="flex flex-col items-center justify-center w-16 py-4 border-r border-border/50 shrink-0">
                          <span className="text-lg font-bold text-muted-foreground/50">
                            {String(asset.shotId).padStart(2, "0")}
                          </span>
                          <Badge className={`${typeInfo.color} border-0 text-[10px] mt-1`}>
                            {t(typeInfo.key)}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground mt-1">{asset.duration}s</span>
                          {reality && (
                            <span
                              className={`text-[9px] mt-1 px-1 rounded ${
                                reality === "real"
                                  ? "bg-emerald-500/15 text-emerald-600"
                                  : "bg-violet-500/15 text-violet-600"
                              }`}
                            >
                              {reality === "real" ? t("badgeReal") : t("badgeAi")}
                            </span>
                          )}
                        </div>

                        {/* center content */}
                        <div className="flex-1 p-4">
                          <p className="text-sm leading-relaxed mb-2">{asset.description}</p>
                          {/* per-shot camera move: named-preset picker + inline free-text edit
                              (curated moves instead of prompt guessing).
                              Edits persist into the script and apply on the next motion generation */}
                          {uiMode === "pro" && (
                          <div className="flex items-center gap-1.5 mb-2 text-xs min-w-0">
                            <span className="shrink-0 text-muted-foreground/70">🎥</span>
                            {editingCameraShot === asset.shotId ? (
                              <input
                                autoFocus
                                value={cameraDraft}
                                onChange={(e) => setCameraDraft(e.target.value)}
                                onBlur={() => saveCamera(asset.shotId, cameraDraft)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveCamera(asset.shotId, cameraDraft);
                                  if (e.key === "Escape") setEditingCameraShot(null);
                                }}
                                maxLength={200}
                                className="flex-1 min-w-0 bg-muted/20 border border-border/60 rounded px-2 py-0.5 text-xs outline-none focus:border-primary"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCameraShot(asset.shotId);
                                  setCameraDraft(asset.camera ?? "");
                                }}
                                title={t("cameraEditTip")}
                                className="min-w-0 truncate text-left text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2"
                              >
                                {asset.camera || t("cameraUnset")}
                              </button>
                            )}
                            {savingCameraShot === asset.shotId ? (
                              <LuLoaderCircle className="w-3 h-3 animate-spin shrink-0 text-muted-foreground" />
                            ) : (
                              <select
                                value=""
                                onChange={(e) => e.target.value && applyCameraPreset(asset.shotId, e.target.value)}
                                title={t("cameraPresetTip")}
                                className="shrink-0 bg-muted/20 border border-border/60 rounded px-1 h-5 text-[11px] text-muted-foreground outline-none max-w-24"
                              >
                                <option value="">{t("cameraPresetPick")}</option>
                                <optgroup label={t("cameraRecommendGroup")}>
                                  {recommendedPresets(asset.type).map((p) => (
                                    <option key={`rec-${p.id}`} value={p.id}>
                                      {locale === "zh" ? p.name.zh : p.name.en}
                                    </option>
                                  ))}
                                </optgroup>
                                {(Object.keys(CAMERA_PRESET_CATEGORIES) as CameraPresetCategory[]).map((cat) => (
                                  <optgroup key={cat} label={locale === "zh" ? CAMERA_PRESET_CATEGORIES[cat].zh : CAMERA_PRESET_CATEGORIES[cat].en}>
                                    {CAMERA_PRESETS.filter((p) => p.category === cat).map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {locale === "zh" ? p.name.zh : p.name.en}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            )}
                            {/* Mix overlay: only while the text is a preset sentence. */}
                            {savingCameraShot !== asset.shotId && editingCameraShot !== asset.shotId && (() => {
                              const base = findPresetByPrompt(asset.camera);
                              if (!base) return null;
                              const sample = `${asset.camera ?? ""}${asset.description ?? ""}`;
                              const candidates = mixablePresets(base, sample);
                              if (candidates.length === 0) return null;
                              return (
                                <select
                                  value=""
                                  onChange={(e) => e.target.value && applyCameraMix(asset.shotId, base.id, e.target.value)}
                                  title={t("cameraMixTip")}
                                  className="shrink-0 bg-muted/20 border border-border/60 rounded px-1 h-5 text-[11px] text-muted-foreground outline-none max-w-20"
                                >
                                  <option value="">{t("cameraMixPick")}</option>
                                  {candidates.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {locale === "zh" ? p.name.zh : p.name.en}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
                          </div>
                          )}
                          {asset.prompt && (
                            <p className="text-xs text-muted-foreground bg-muted/20 rounded px-2 py-1.5 mb-2 line-clamp-2">
                              {t("promptLabel", { prompt: asset.prompt })}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {asset.assetType === "stock_footage"
                                ? t("sourceStock")
                                : asset.visualSource === "product_image"
                                ? t("sourceProductImage")
                                : asset.visualSource === "ai_generate"
                                ? t("sourceAiGenerate")
                                : t("sourceUserUpload")}
                            </span>
                          </div>
                          {/* single error slot for the whole card: generation failures AND
                              non-fatal errors (camera save / i2v) that keep status "done" */}
                          {!asset.isVideo && keyframeStaticWarnings(asset.prompt || asset.description).length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                              {t("keyframeStaticWarn", { words: keyframeStaticWarnings(asset.prompt || asset.description).join("、") })}
                            </p>
                          )}
                          {asset.error && (
                            <p className="text-xs text-destructive mt-2">⚠ {asset.error}</p>
                          )}
                        </div>

                        {/* right-side preview + actions */}
                        <div className="flex flex-col items-center justify-center gap-2 p-4 shrink-0">
                          {/* thumbnail area */}
                          <div className="w-24 h-16 bg-muted/30 rounded-md flex items-center justify-center border border-border/30 overflow-hidden">
                            {asset.status === "done" && asset.thumbnailUrl ? (
                              // i2v shots may carry an mp4 as their preview — render it muted instead of a broken <img>
                              asset.isVideo && /\.(mp4|webm|mov)(\?|$)/i.test(asset.thumbnailUrl) ? (
                                <video src={asset.thumbnailUrl} muted playsInline className="w-full h-full object-cover" />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={asset.thumbnailUrl} alt={t("assetPreviewAlt")} className="w-full h-full object-cover" />
                              )
                            ) : asset.status === "done" ? (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                <LuCheck className="w-5 h-5 text-primary" />
                              </div>
                            ) : asset.status === "generating" ? (
                              <LuLoaderCircle className="animate-spin h-5 w-5 text-primary" />
                            ) : asset.status === "failed" ? (
                              <LuCircleX className="w-5 h-5 text-destructive" />
                            ) : (
                              <LuImage className="w-4 h-4 text-muted-foreground/40" />
                            )}
                          </div>

                          {/* action buttons (AI-generated shots can be manually generated or retried) */}
                          {asset.visualSource === "ai_generate" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs w-24"
                              disabled={asset.status === "generating" || motionShots.has(asset.shotId)}
                              onClick={() => generateOne(asset.shotId)}
                            >
                              {asset.status === "generating"
                                ? t("btnGenerating")
                                : asset.status === "done"
                                ? t("btnRegenerate")
                                : asset.status === "failed"
                                ? tc("retry")
                                : t("btnGenerate")}
                            </Button>
                          )}
                          {/* upload own image: unblocks user_upload shots (no other action) and lets any non-product shot use the creator's own photo instead of AI/stock */}
                          {asset.visualSource !== "product_image" && (
                            <Button
                              variant={asset.visualSource === "user_upload" && asset.status !== "done" ? "outline" : "ghost"}
                              size="sm"
                              className="text-xs w-24 text-muted-foreground hover:text-primary"
                              disabled={uploadingShot === asset.shotId}
                              onClick={() => openUploadFor(asset.shotId)}
                            >
                              {uploadingShot === asset.shotId ? (
                                <LuLoaderCircle className="animate-spin h-3.5 w-3.5" />
                              ) : (
                                <><LuUpload className="w-3 h-3 mr-1" />{asset.status === "done" ? t("btnReplaceUpload") : t("btnUpload")}</>
                              )}
                            </Button>
                          )}
                          {/* convert to motion shot: existing image asset → image-to-video (real camera moves). Product close-up shots are best kept static to avoid distortion */}
                          {asset.status === "done" && asset.thumbnailUrl && !asset.isVideo && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs w-24 text-muted-foreground hover:text-primary"
                              disabled={motionShots.has(asset.shotId)}
                              onClick={() => generateMotion(asset.shotId)}
                              // pre-call transparency (issue #16): show which provider/model this
                              // paid call actually uses, so a t2v/i2v mix-up is visible up front
                              title={
                                videoModelTarget
                                  ? `${t("motionTip")}\n${videoModelTarget.provider} · ${videoModelTarget.model}`
                                  : t("motionTip")
                              }
                            >
                              {motionShots.has(asset.shotId) ? t("btnConvertingMotion") : t("btnConvertMotion")}
                            </Button>
                          )}
                          {asset.isVideo && (
                            <span className="text-[10px] text-primary">{t("motionDone")}</span>
                          )}
                          {/* per-shot fallback (commercial "regenerate one shot" mechanism): re-run ONLY
                              the i2v from the preserved keyframe — never throws away the whole batch.
                              Full keyframe+motion redo stays available via the regenerate button above */}
                          {asset.isVideo && asset.keyframeUrl && videoModelTarget && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs w-24 text-muted-foreground hover:text-primary"
                              disabled={motionShots.has(asset.shotId)}
                              onClick={() => generateMotion(asset.shotId, asset.keyframeUrl)}
                              title={`${t("redoMotionTip")}\n${videoModelTarget.provider} · ${videoModelTarget.model}`}
                            >
                              {motionShots.has(asset.shotId) ? t("btnConvertingMotion") : t("btnRedoMotion")}
                            </Button>
                          )}
                          {/* diagnosis retake: pick ONE symptom → resubmit with exactly ONE prompt patch
                              (user-initiated paid call; the notice states what the retake changed) */}
                          {asset.isVideo && asset.keyframeUrl && videoModelTarget && (
                            <select
                              className="h-7 w-24 rounded-md border border-border/60 bg-background px-1 text-[11px] text-muted-foreground"
                              disabled={motionShots.has(asset.shotId)}
                              value=""
                              title={t("retakeDiagTip")}
                              onChange={(e) => {
                                const v = e.target.value as RetakeSymptom | "";
                                if (v) void generateMotion(asset.shotId, asset.keyframeUrl, undefined, v);
                              }}
                            >
                              <option value="">{t("retakeDiag")}</option>
                              {RETAKE_SYMPTOMS.map((sym) => (
                                <option key={sym.id} value={sym.id}>
                                  {locale === "zh" ? sym.label.zh : sym.label.en}
                                </option>
                              ))}
                            </select>
                          )}
                          {/* error text lives in the middle column next to the shot content; not repeated here */}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* bottom action */}
            <div className="mt-8 flex justify-end">
              <Link href={allDone ? `/project/${id}/video` : "#"}>
                <Button className="brand-gradient text-white text-sm" disabled={!allDone}>
                  {t("nextCompose")}
                  <LuArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
