"use client";

import { useRef, useState, type ReactNode } from "react";
import type { AssetItem } from "@/lib/assets-view";
import { useLocale } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface EditorProps {
  projectId: string;
  scriptId: string;
  versions: { id: string; version: number }[];
  source: string;
  modelName?: string;
  assets: AssetItem[];
  products: string[];
  busy: boolean;
  reload: () => Promise<void>;
  generate: (shotId: number, referenceFrame: string) => Promise<boolean>;
}

const selectClass = "rounded border bg-background px-2 py-1 text-sm";
const seconds = (v: number) => Number(v.toFixed(3)).toString();

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return <figure className="min-w-0"><figcaption className="mb-1 text-xs text-muted-foreground">{label}</figcaption>
    <div className="grid aspect-video place-items-center overflow-hidden rounded bg-black">{children}</div></figure>;
}

export function ReferenceEditor(props: EditorProps) {
  const en = useLocale() === "en";
  const [selected, setSelected] = useState(0);
  const shot = props.assets.find((s) => s.shotId === selected) ?? props.assets[0];
  if (!shot?.referenceCut) return null;
  return <section className="my-5 space-y-3 rounded-lg border bg-card p-4">
    <h3 className="font-semibold">{en ? "Reference cut editor" : "逐镜复刻"}</h3>
    <ShotEditor key={JSON.stringify([props.scriptId, shot.shotId, shot.referenceCut, shot.description, shot.assetId])} {...props} shot={shot} en={en} selectShot={setSelected} />
  </section>;
}

function ShotEditor({ projectId, scriptId, versions, source, modelName, assets, products, busy, reload, generate, shot, en, selectShot }: EditorProps & { shot: AssetItem; en: boolean; selectShot: (id: number) => void }) {
  const cut = shot.referenceCut!;
  const frame = useRef<HTMLVideoElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const router = useRouter();
  const initialProduct = cut.productImage ?? products[0];
  const draftKey = `clipforge.referenceDraft.${projectId}.${scriptId}.${shot.shotId}`;
  const [draft, setDraft] = useState(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(draftKey) || "null");
      if (!cut.locked && stored?.base === shot.description && stored.baseProduct === initialProduct &&
          typeof stored.description === "string" && products.includes(stored.product)) return { description: String(stored.description), product: String(stored.product) };
    } catch { /* Storage can be unavailable in a private window. */ }
    return {description: shot.description, product: initialProduct};
  });
  const {description, product} = draft;
  function editDraft(next: typeof draft) {
    setDraft(next);
    try { sessionStorage.setItem(draftKey, JSON.stringify({ ...next, base: shot.description, baseProduct: initialProduct })); } catch { /* Saving through the API still works. */ }
  }
  const version = versions.find((v) => v.id === scriptId)?.version;
  const versionName = version && version <= 26 ? String.fromCharCode(64 + version) : String(version ?? "");
  const [until, setUntil] = useState(shot.shotId);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const changed = description.trim() !== shot.description || product !== cut.productImage;
  const base = `/api/project/${projectId}`;
  const media = shot.mediaUrl || cut.productImage;
  async function request(path: string, body: object) {
    const res = await fetch(base + path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
  }
  async function run(action: () => Promise<unknown>) {
    if (working || busy) return;
    setWorking(true); setError("");
    try { await action(); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setWorking(false); }
  }
  const update = (changes: object) => request("/reference-cuts", { scriptId, shotId: shot.shotId, ...changes });
  async function saveChanges() {
    if (!changed) return;
    await update({ action: "edit", productImage: product, description });
    try { sessionStorage.removeItem(draftKey); } catch { /* The persisted revision also invalidates the old draft. */ }
  }
  return <fieldset disabled={working || busy} className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">{en ? "Shot " : "镜头 "}
        <select className={selectClass} aria-label={en ? "Reference shot" : "参考镜头"} value={shot.shotId} onChange={(e) => {
          const next = Number(e.target.value);
          if (!changed) selectShot(next);
          else void run(async () => { await saveChanges(); selectShot(next); });
        }}>
          {assets.map((s) => <option key={s.shotId} value={s.shotId}>#{s.shotId} · {seconds(s.referenceCut!.start)}–{seconds(s.referenceCut!.end)} s{s.referenceCut?.locked ? (en ? " · Locked" : " · 已锁定") : ""}</option>)}
        </select>
      </label>
      <label className="text-sm">{en ? "Version " : "版本 "}
        <select className={selectClass} value={scriptId} onChange={(e) => {
            const selectedScriptId = e.target.value;
            void run(async () => { await saveChanges(); await request("/scripts", { selectedScriptId }); });
          }}>
          {versions.map((v) => <option key={v.id} value={v.id}>{v.version <= 26 ? String.fromCharCode(64 + v.version) : v.version}</option>)}
        </select>
      </label>
      <Button size="sm" variant="outline" onClick={() => void run(async () => { await saveChanges(); await update({ action: "duplicate" }); })}>{en ? "Duplicate version" : "复制为新版本"}</Button>
      <Button size="sm" variant="outline" disabled={changed} onClick={() => void run(() => update({ action: "lock", locked: !cut.locked }))}>
        {cut.locked ? (en ? "Unlock shot" : "解锁此镜") : (en ? "Lock shot" : "锁定此镜")}
      </Button>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Frame label={en ? "Reference frame" : "原片参考帧"}><video ref={frame} onSeeked={() => setFrameReady(true)} aria-label={en ? "Reference frame" : "原片参考帧"} className="h-full w-full object-contain" src={source} preload="auto" muted playsInline onLoadedMetadata={(e) => { e.currentTarget.currentTime = (cut.start + cut.end) / 2; }} /></Frame>
      <Frame label={en ? "Current take" : "本版素材"}>{media && (shot.isVideo
        ? <video className="h-full w-full object-contain" src={media} muted controls playsInline onLoadedMetadata={(e) => { if (cut.segment?.path === media) e.currentTarget.currentTime = cut.segment.offset; }} />
        // Project uploads may be local-only URLs served by the desktop app.
        // eslint-disable-next-line @next/next/no-img-element
        : <img className="h-full w-full object-contain" src={media} alt={en ? "Current product" : "当前商品画面"} />)}</Frame>
    </div>
    <fieldset disabled={cut.locked} className="space-y-2 disabled:opacity-60">
      <label className="block text-sm">{en ? "Shot direction" : "镜头描述"}
        <input className="mt-1 block w-full rounded border bg-background p-2" maxLength={2000} value={description} onChange={(e) => editDraft({ ...draft, description: e.target.value })} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">{en ? "Product photo " : "商品图 "}
          <select className={selectClass} value={product} onChange={(e) => editDraft({ ...draft, product: e.target.value })}>
            {products.map((p, i) => <option key={p} value={p}>#{i + 1}</option>)}
          </select>
        </label>
        <Button size="sm" disabled={!changed || !description.trim()} onClick={() => void run(saveChanges)}>{en ? "Save shot" : "保存此镜"}</Button>
        {modelName ? <Button size="sm" variant="outline" disabled={changed || !frameReady} onClick={() => void run(async () => {
          const video = frame.current;
          if (!video || video.readyState < 2 || !video.videoWidth) throw new Error(en ? "Reference frame unavailable" : "参考帧还未就绪");
          const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error(en ? "Cannot read reference frame" : "无法读取参考帧");
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          if (!await generate(shot.shotId, canvas.toDataURL("image/jpeg", 0.86))) throw new Error(en ? "Generation failed. Check the shot and model settings." : "生成失败，请查看该镜头提示和模型设置。");
        })}>{en ? `Generate shot #${shot.shotId} · ${modelName}` : `生成第 ${shot.shotId} 镜 · ${modelName}`}</Button>
          : <Link className="text-sm underline" href="/settings">{en ? "Configure AI for this shot" : "配置单镜 AI 生成"}</Link>}
      </div>
      {shot.isVideo && shot.assetId && <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">{en ? "Use this video through shot " : "将这段视频按原切点铺到镜头 "}
          <select className={selectClass} value={until} onChange={(e) => setUntil(Number(e.target.value))}>{assets.filter((s) => s.shotId >= shot.shotId).map((s) => <option key={s.shotId} value={s.shotId}>#{s.shotId}</option>)}</select>
        </label>
        <Button size="sm" variant="outline" onClick={() => void run(() => update({ action: "span", assetId: shot.assetId, lastShotId: until }))}>{en ? "Apply video range" : "应用视频区间"}</Button>
      </div>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" className="brand-gradient text-white" onClick={() => void run(async () => {
        await saveChanges(); router.push(`/project/${projectId}/video?scriptId=${encodeURIComponent(scriptId)}`);
      })}>{changed ? (en ? `Save and compose version ${versionName}` : `保存并合成 ${versionName} 版`) : (en ? `Use version ${versionName} in video` : `用 ${versionName} 版去合成`)}</Button>
      <span className="text-xs text-muted-foreground" aria-live="polite">{working ? (en ? "Working…" : "处理中…") : changed ? (en ? "Editing · switching shots saves changes" : "正在编辑 · 切镜时自动保存") : (en ? "Use product photos without an AI key" : "用当前商品图合成，无需 AI Key")}</span>
    </div>
    {(shot.error || error) && <p role="alert" className="text-sm text-destructive">{shot.error || error}</p>}
  </fieldset>;
}
