"use client";
import { randomUUID } from "@/lib/uuid";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n";
import type { TranscriptEditPlan } from "@/lib/transcript-editor";
import type { TranscriptEditProposal } from "@/lib/transcript-edit-protocol";
export interface BatchClip { id: string; label: string; sourceRange: { start: number; end: number } }
export function ClipBatch({ projectId, mediaId, clips, plan, revision, disabled, onChange, onQueued }: {
  projectId: string; mediaId: string; clips: BatchClip[]; plan: TranscriptEditPlan; revision: number;
  disabled: boolean; onChange: (clips: BatchClip[]) => void; onQueued: () => void;
}) {
  const t = useT("transcript"); const locale = useLocale();
  const [preview, setPreview] = useState<{ signature: string; body: object; items: { label: string; proposal: TranscriptEditProposal }[] } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const signature = JSON.stringify({ clips, plan, revision });
  const current = preview?.signature === signature ? preview : null;
  async function submit(apply: boolean) {
    if (apply && !current) return;
    setBusy(true); setError("");
    try {
      const body = apply ? current!.body : { batchId: randomUUID(), baseRevision: revision, items: clips.map((clip) => ({ label: clip.label, plan: { ...plan, sourceRange: clip.sourceRange } })) };
      const response = await fetch(`/api/project/${projectId}/media/${mediaId}/batch`, { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": locale }, body: JSON.stringify({ ...body, action: apply ? "apply" : "preview" }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || t("renderFailed"));
      if (apply) { setPreview(null); onChange([]); onQueued(); }
      else setPreview({ signature, body, items: data.items });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("renderFailed")); }
    finally { setBusy(false); }
  }
  if (!clips.length) return null;
  return <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
    <h3 className="text-sm font-semibold">{t("batchTitle", { n: clips.length })}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("batchHint")}</p>
    <div className="mt-3 space-y-2">{clips.map((clip, index) => <div key={clip.id} className="flex flex-wrap items-center gap-2">
      <label className="min-w-0 flex-1 text-xs">{t("batchName", { n: index + 1 })}<input value={clip.label} maxLength={80} disabled={busy} onChange={(event) => onChange(clips.map((item) => item.id === clip.id ? { ...item, label: event.target.value } : item))} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm" /></label>
      <Button variant="ghost" className="mt-4 min-h-11" disabled={busy} onClick={() => onChange(clips.filter((item) => item.id !== clip.id))}>{t("correctionsRemove")}</Button>
    </div>)}</div>
    {current && <ul className="mt-3 space-y-1 text-xs" aria-label={t("batchReview")}>{current.items.map(({ label, proposal }, index) => <li key={index}>{label} · R{revision + index + 1} · {proposal.summary.outputDuration.toFixed(1)}s{proposal.summary.outputDuration < 0.5 || proposal.conflict ? ` · ${t("batchInvalid")}` : ""}</li>)}</ul>}
    <Button variant={current ? "default" : "outline"} className="mt-3 min-h-11" disabled={disabled || busy || clips.some((clip) => !clip.label.trim()) || !!current?.items.some(({ proposal }) => proposal.conflict || proposal.summary.outputDuration < 0.5)} onClick={() => void submit(!!current)}>{busy ? t("reviewing") : current ? t("batchConfirm", { n: clips.length }) : t("batchReview")}</Button>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </div>;
}
