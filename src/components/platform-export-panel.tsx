"use client";

import { useEffect, useRef, useState } from "react";
import { LuDownload, LuLoaderCircle, LuSmartphone } from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n";
import { PLATFORM_SPECS } from "@/lib/platform-specs";
import { DEFAULT_VIDEO_FRAMING, type VideoFraming } from "@/lib/video-framing";

export interface ExportComposition {
  id: string;
  url: string | null;
  label?: string | null;
  createdAt?: string | number | null;
}
type Result = { status: "running" | "done" | "error"; url?: string; error?: string; report?: { message: { zh: string; en: string } } };
const platformKeys = Object.keys(PLATFORM_SPECS);
const nameKeys: Record<string, string> = { douyin: "platformDouyin", kuaishou: "platformKuaishou", xiaohongshu: "platformXiaohongshu", shipinhao: "platformShipinhao", tiktok: "platformTiktok", reels: "platformReels", shorts: "platformShorts" };

export function PlatformExportPanel({ projectId, compositions, initialCompositionId }: { projectId: string; compositions: ExportComposition[]; initialCompositionId?: string }) {
  const t = useT("exportPage");
  const locale = useLocale();
  const [compositionId, setCompositionId] = useState(initialCompositionId ?? compositions[0]?.id ?? "");
  const source = compositions.find((item) => item.id === compositionId);
  const [framing, setFraming] = useState<VideoFraming>({ ...DEFAULT_VIDEO_FRAMING });
  const [selected, setSelected] = useState<string[]>(platformKeys);
  const [previewPlatform, setPreviewPlatform] = useState("douyin");
  const [time, setTime] = useState(0);
  const [preview, setPreview] = useState<{ image: string; time: number } | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  const [message, setMessage] = useState<null | { kind: "progress"; done: number; total: number } | { kind: "cancelled" } | { kind: "error"; text: string }>(null);
  const controller = useRef<AbortController | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const reset = () => { setPreview(null); setResults({}); setMessage(null); };
  const updateFraming = (next: VideoFraming) => { reset(); setFraming(next); };
  const request = async (platform: string, signal: AbortSignal, previewOnly = false) => {
    const response = await fetch(`/api/project/${projectId}/export-platform`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "Accept-Language": locale },
      body: JSON.stringify({ compositionId, platform, framing, ...(previewOnly ? { preview: true, previewTime: time } : {}) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("exportFailed"));
    return data;
  };
  const previewFrame = async () => {
    if (controller.current || !source?.url) return;
    const active = new AbortController();
    controller.current = active;
    setBusy("preview"); setMessage(null); setPreview(null);
    try {
      const data = await request(previewPlatform, active.signal, true);
      setPreview({ image: data.preview, time: data.previewTime });
    } catch (error) {
      setMessage(active.signal.aborted ? { kind: "cancelled" } : { kind: "error", text: error instanceof Error ? error.message : t("exportFailed") });
    } finally { controller.current = null; setBusy(null); }
  };
  const exportPlatforms = async (platforms: string[]) => {
    if (controller.current || !source?.url || !platforms.length) return;
    const active = new AbortController();
    controller.current = active;
    setBusy("export"); setMessage(null);
    let completed = 0;
    try {
      for (const platform of platforms) {
        if (active.signal.aborted) break;
        setResults((previous) => ({ ...previous, [platform]: { status: "running" } }));
        try {
          const data = await request(platform, active.signal);
          setResults((previous) => ({ ...previous, [platform]: { status: "done", url: data.url, report: data.report } }));
          completed++;
        } catch (error) {
          const detail = active.signal.aborted ? t("framingCancelled") : error instanceof Error ? error.message : t("exportFailed");
          setResults((previous) => ({ ...previous, [platform]: { status: "error", error: detail } }));
        }
        if (!active.signal.aborted) setMessage({ kind: "progress", done: completed, total: platforms.length });
      }
      if (active.signal.aborted) setMessage({ kind: "cancelled" });
    } finally { controller.current = null; setBusy(null); }
  };

  const messageText = message?.kind === "progress" ? t("framingProgress", { done: message.done, total: message.total })
    : message?.kind === "cancelled" ? t("framingCancelled") : message?.kind === "error" ? message.text : "";
  return <Card className="glass-card mb-6">
    <CardContent className="p-5 space-y-4">
      <div className="flex items-center gap-2"><LuSmartphone aria-hidden="true" className="size-4 text-primary" /><h3 className="text-sm font-semibold">{t("multiExportTitle")}</h3></div>
      <p className="text-sm text-muted-foreground">{t("framingIntro")}</p>
      <fieldset disabled={busy !== null} className="space-y-4 disabled:opacity-70">
        <label className="block text-sm space-y-1.5">
          <span>{t("framingSource")}</span>
          <select className="w-full min-h-11 rounded-md border border-border bg-background px-3" value={compositionId} onChange={(event) => { reset(); setCompositionId(event.target.value); setTime(0); }}>
            {compositions.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.label || t("historyUnlabeled")} · {item.createdAt ? new Date(item.createdAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN") : item.id}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("framingMode")}>
          {(["blur", "fit", "crop"] as const).map((mode) => <label key={mode} className={`flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm cursor-pointer ${framing.mode === mode ? "border-primary bg-primary/5" : "border-border"}`}>
            <input type="radio" name={`framing-${projectId}`} value={mode} checked={framing.mode === mode} onChange={() => updateFraming({ ...framing, mode })} />
            {t(`framingMode_${mode}`)}
          </label>)}
        </div>
        {framing.mode === "crop" && <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm text-muted-foreground">{t("framingCropHint")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["positionX", "positionY"] as const).map((axis) => <label key={axis} className="block text-sm">
              <span>{t(axis === "positionX" ? "framingHorizontal" : "framingVertical")} · {Math.round(framing[axis] * 100)}%</span>
              <input type="range" min="0" max="100" step="1" value={Math.round(framing[axis] * 100)} onChange={(event) => updateFraming({ ...framing, [axis]: Number(event.target.value) / 100 })} className="block w-full h-11 accent-primary" />
            </label>)}
          </div>
        </div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("framingOriginal")}</p>
            {source?.url && <video key={source.id} ref={video} src={source.url} controls preload="metadata" aria-label={t("framingOriginal")} className="w-full max-h-64 rounded-lg bg-black" />}
            <p className="text-xs text-muted-foreground">{t("framingOriginalHint")}</p>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm space-y-1"><span>{t("framingPreviewPlatform")}</span><select className="w-full min-h-11 rounded-md border border-border bg-background px-2" value={previewPlatform} onChange={(event) => { setPreview(null); setPreviewPlatform(event.target.value); }}>
                {platformKeys.map((key) => <option key={key} value={key}>{t(nameKeys[key])}</option>)}
              </select></label>
              <label className="block text-sm space-y-1"><span>{t("framingTime")}</span><input type="number" min="0" step="0.1" value={time} onChange={(event) => { setPreview(null); setTime(Math.max(0, Number(event.target.value) || 0)); }} className="w-full min-h-11 rounded-md border border-border bg-background px-2" /></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" onClick={() => { setTime(Math.round((video.current?.currentTime ?? 0) * 10) / 10); setPreview(null); }}>{t("framingUseTime")}</Button>
              <Button variant="outline" className="min-h-11" disabled={!source?.url} onClick={() => void previewFrame()}>{busy === "preview" && <LuLoaderCircle aria-hidden="true" className="size-4 animate-spin" />}{t("framingPreview")}</Button>
            </div>
            {preview ? <figure className="space-y-1">
              {/* 单帧由本地导出引擎生成，data URL 无需图片优化。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.image} alt={t("framingPreviewAlt")} className="mx-auto max-h-80 max-w-full rounded-lg" />
              <figcaption className="text-center text-xs text-muted-foreground">{t("framingPreviewAt", { time: preview.time.toFixed(1) })}</figcaption>
            </figure> : <p className="text-sm text-muted-foreground">{t("framingPreviewHint")}</p>}
          </div>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2 items-center">
        <Button variant="outline" disabled={busy !== null || selected.length === 0 || !source?.url} className="min-h-11" onClick={() => void exportPlatforms(selected)}><LuDownload aria-hidden="true" className="size-4" />{t("framingExportSelected", { count: selected.length })}</Button>
        {busy && <Button variant="outline" className="min-h-11" onClick={() => controller.current?.abort()}>{t("framingCancel")}</Button>}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{busy && <LuLoaderCircle aria-hidden="true" className="inline size-4 mr-1 animate-spin" />}{messageText || (busy === "export" ? t("batchExporting") : busy === "preview" ? t("framingPreviewLoading") : "")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {platformKeys.map((key) => {
          const spec = PLATFORM_SPECS[key]; const result = results[key];
          return <div key={key} className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={selected.includes(key)} disabled={busy !== null} onChange={(event) => setSelected((items) => event.target.checked ? platformKeys.filter((item) => items.includes(item) || item === key) : items.filter((item) => item !== key))} />{t(nameKeys[key])}</label>
            <p className="text-xs text-muted-foreground">{spec.ratio} · {spec.w} × {spec.h}</p>
            {result?.url && <a className="flex min-h-11 items-center justify-center gap-1 rounded-md border border-border text-sm text-primary" href={`${result.url}?download=1`} download><LuDownload aria-hidden="true" className="size-3" />{t("downloadPlatform", { platform: t(nameKeys[key]) })}</a>}
            {result?.report && <p className="text-xs text-muted-foreground">{result.report.message[locale === "en" ? "en" : "zh"]}</p>}
            {result?.error && <p role="alert" className="text-xs text-destructive">{result.error}</p>}
            {result?.status !== "done" && <Button variant="outline" className="w-full min-h-11 text-xs" disabled={busy !== null || !source?.url} onClick={() => void exportPlatforms([key])}>{result?.status === "running" ? t("exporting") : result?.status === "error" ? t("retryExport") : t("exportPlatform", { platform: t(nameKeys[key]) })}</Button>}
          </div>;
        })}
      </div>
    </CardContent>
  </Card>;
}
