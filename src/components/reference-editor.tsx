"use client";

import { useRef, useState, type ReactNode } from "react";
import type { AssetItem } from "@/lib/assets-view";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

interface EditorProps {
  projectId: string;
  scriptId: string;
  versions: { id: string; version: number }[];
  source: string;
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
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{en ? "Reference cut editor" : "逐镜复刻"}</h3>
      <select className={selectClass} aria-label={en ? "Reference shot" : "参考镜头"} value={shot.shotId} onChange={(e) => setSelected(Number(e.target.value))}>
        {props.assets.map((s) => <option key={s.shotId} value={s.shotId}>#{s.shotId} · {seconds(s.referenceCut!.start)}–{seconds(s.referenceCut!.end)} s{s.referenceCut?.locked ? " · 🔒" : ""}</option>)}
      </select>
    </div>
    <ShotEditor key={JSON.stringify([props.scriptId, shot.shotId, shot.referenceCut, shot.description, shot.assetId])} {...props} shot={shot} en={en} />
  </section>;
}

function ShotEditor({ projectId, scriptId, versions, source, assets, products, busy, reload, generate, shot, en }: EditorProps & { shot: AssetItem; en: boolean }) {
  const cut = shot.referenceCut!;
  const frame = useRef<HTMLVideoElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [description, setDescription] = useState(shot.description);
  const [product, setProduct] = useState(cut.productImage ?? products[0]);
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
  return <fieldset disabled={working || busy} className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">{en ? "Version " : "版本 "}
        <select className={selectClass} value={scriptId} onChange={(e) => void run(() => request("/scripts", { selectedScriptId: e.target.value }))}>
          {versions.map((v) => <option key={v.id} value={v.id}>{v.version <= 26 ? String.fromCharCode(64 + v.version) : v.version}</option>)}
        </select>
      </label>
      <Button size="sm" variant="outline" disabled={changed} onClick={() => void run(() => update({ action: "duplicate" }))}>{en ? "Duplicate version" : "复制为新版本"}</Button>
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
        <input className="mt-1 block w-full rounded border bg-background p-2" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">{en ? "Product photo " : "商品图 "}
          <select className={selectClass} value={product} onChange={(e) => setProduct(e.target.value)}>
            {products.map((p, i) => <option key={p} value={p}>#{i + 1}</option>)}
          </select>
        </label>
        <Button size="sm" disabled={!changed || !description.trim()} onClick={() => void run(() => update({ action: "edit", productImage: product, description }))}>{en ? "Save shot" : "保存此镜"}</Button>
        <Button size="sm" variant="outline" disabled={changed || !frameReady} onClick={() => void run(async () => {
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
        })}>{en ? "Generate from reference frame" : "按参考帧生成此镜"}</Button>
      </div>
      {shot.isVideo && shot.assetId && <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">{en ? "Use this video through shot " : "将这段视频按原切点铺到镜头 "}
          <select className={selectClass} value={until} onChange={(e) => setUntil(Number(e.target.value))}>{assets.filter((s) => s.shotId >= shot.shotId).map((s) => <option key={s.shotId} value={s.shotId}>#{s.shotId}</option>)}</select>
        </label>
        <Button size="sm" variant="outline" onClick={() => void run(() => update({ action: "span", assetId: shot.assetId, lastShotId: until }))}>{en ? "Apply video range" : "应用视频区间"}</Button>
      </div>}
    </fieldset>
    {(shot.error || error) && <p role="alert" className="text-sm text-destructive">{shot.error || error}</p>}
  </fieldset>;
}
