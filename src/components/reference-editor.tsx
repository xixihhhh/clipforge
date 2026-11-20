"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LuArrowRight, LuChevronLeft, LuChevronRight, LuClapperboard, LuCopy, LuFilm, LuLockKeyhole, LuPanelsTopLeft, LuPause, LuPlay, LuSlidersHorizontal, LuLockKeyholeOpen } from "react-icons/lu";
import styles from "./reference-editor.module.css";
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

const seconds = (v: number) => Number(v.toFixed(3)).toString();
function timecode(seconds: number) {
  const frame = Math.round(seconds * 30);
  return [Math.floor(frame / 108000), Math.floor(frame / 1800) % 60, Math.floor(frame / 30) % 60, frame % 30]
    .map((v) => String(v).padStart(2, "0")).join(":");
}
function Frame({ label, clock, children }: { label: string; clock: string; children: ReactNode }) {
  return <figure className={styles.monitor}><figcaption><span>{label}</span><time>{clock}</time></figcaption>
    <div className={styles.screen}>{children}</div></figure>;
}

export function ReferenceEditor(props: EditorProps) {
  const en = useLocale() === "en";
  const positionKey = `clipforge.referencePosition.${props.projectId}`;
  const [selected, setSelected] = useState(() => {
    try { return Number(sessionStorage.getItem(positionKey)) || 0; } catch { return 0; }
  });
  const focusTimeline = useRef(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusTimeline.current) return;
    const button = panel.current?.querySelector<HTMLButtonElement>('[data-cut][aria-pressed="true"]');
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    focusTimeline.current = false;
  }, [selected]);
  function selectShot(id: number, timeline = false) {
    focusTimeline.current = timeline;
    setSelected(id);
    try { sessionStorage.setItem(positionKey, String(id)); } catch { /* Shot selection also works without browser storage. */ }
  }
  const shot = props.assets.find((s) => s.shotId === selected) ?? props.assets[0];
  if (!shot?.referenceCut) return null;
  return <section ref={panel} className={styles.workstation} aria-label={en ? "Reference cut editor" : "逐镜复刻"}>
    <ShotEditor key={JSON.stringify([props.scriptId, shot.shotId, shot.referenceCut, shot.description, shot.assetId])} {...props} shot={shot} en={en} selectShot={selectShot} />
  </section>;
}

function ShotEditor({ projectId, scriptId, versions, source, modelName, assets, products, busy, reload, generate, shot, en, selectShot }: EditorProps & { shot: AssetItem; en: boolean; selectShot: (id: number, timeline?: boolean) => void }) {
  const cut = shot.referenceCut!;
  const frame = useRef<HTMLVideoElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sourceTime, setSourceTime] = useState((cut.start + cut.end) / 2);
  const [programTime, setProgramTime] = useState(cut.start);
  useEffect(() => {
    const player = frame.current;
    if (!playing || !player) return;
    let tick: number;
    function checkEnd() {
      if (!player || player.paused) return;
      if (player.currentTime >= cut.end) {
        player.pause();
        player.currentTime = Math.max(cut.start, cut.end - 1 / 30);
      } else tick = requestAnimationFrame(checkEnd);
    }
    tick = requestAnimationFrame(checkEnd);
    return () => cancelAnimationFrame(tick);
  }, [playing, cut.start, cut.end]);
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
  const programOffset = cut.segment && cut.segment.path === media ? cut.segment.offset : 0;
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
  const index = assets.findIndex((item) => item.shotId === shot.shotId);
  function move(index: number, timeline = false) {
    const next = assets[index];
    if (!next || next.shotId === shot.shotId) return;
    if (!changed) selectShot(next.shotId, timeline);
    else void run(async () => { await saveChanges(); selectShot(next.shotId, timeline); });
  }
  const duration = assets[assets.length - 1].referenceCut!.end;
  return <fieldset disabled={working || busy} className={styles.body}>
    <header className={styles.toolbar}>
      <h2><LuPanelsTopLeft aria-hidden />{en ? "Reference edit" : "逐镜复刻"}</h2>
      <label className={styles.version}>{en ? "Version" : "版本"}
        <select className={styles.select} aria-label={en ? "Version" : "版本"} value={scriptId} onChange={(e) => {
          const selectedScriptId = e.target.value;
          void run(async () => { await saveChanges(); await request("/scripts", { selectedScriptId }); });
        }}>{versions.map((v) => <option key={v.id} value={v.id}>{v.version <= 26 ? String.fromCharCode(64 + v.version) : v.version}</option>)}</select>
      </label>
      <button type="button" className={styles.duplicate} onClick={() => void run(async () => { await saveChanges(); await update({ action: "duplicate" }); })}><LuCopy aria-hidden />{en ? "Duplicate version" : "复制为新版本"}</button>
      <Button size="sm" className={styles.compose} onClick={() => void run(async () => {
        await saveChanges(); router.push(`/project/${projectId}/video?scriptId=${encodeURIComponent(scriptId)}`);
      })}>{changed ? (en ? `Save and compose version ${versionName}` : `保存并合成 ${versionName} 版`) : (en ? `Use version ${versionName} in video` : `用 ${versionName} 版去合成`)}<LuArrowRight aria-hidden /></Button>
    </header>
    <div className={styles.workspace}>
      <div className={styles.edit}>
        <div className={styles.monitors}>
          <Frame label={en ? "Source · reference" : "源监看 · 参考片"} clock={timecode(sourceTime)}><video ref={frame} onSeeking={() => setFrameReady(false)} onSeeked={(e) => { setFrameReady(true); setSourceTime(e.currentTarget.currentTime); }} onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setSourceTime(e.currentTarget.currentTime)} aria-label={en ? "Reference frame" : "原片参考帧"} src={source} preload="auto" muted playsInline onLoadedMetadata={(e) => { e.currentTarget.currentTime = (cut.start + cut.end) / 2; }} /></Frame>
          <Frame label={en ? `Program · version ${versionName}` : `节目监看 · ${versionName} 版`} clock={timecode(programTime)}>{media && (shot.isVideo
            ? <video src={media} muted controls playsInline onLoadedMetadata={(e) => { e.currentTarget.currentTime = programOffset; }} onTimeUpdate={(e) => {
              const player = e.currentTarget;
              const relative = player.currentTime - programOffset;
              setProgramTime(cut.start + Math.max(0, Math.min(shot.duration, relative)));
              if (!player.paused && relative >= shot.duration) { player.pause(); player.currentTime = programOffset; }
            }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={media} alt={en ? "Current product" : "当前商品画面"} />)}</Frame>
        </div>
        <div className={styles.transport}>
          <button type="button" aria-label={en ? "Previous shot" : "上一镜"} disabled={index===0} onClick={() => move(index-1)}><LuChevronLeft /></button>
          <button type="button" aria-label={playing ? (en ? "Pause reference" : "暂停参考片") : (en ? "Play this reference shot" : "播放当前参考镜头")} onClick={() => {
            const player = frame.current;
            if (!player) return;
            if (playing) player.pause();
            else { player.currentTime = cut.start; void player.play().catch(() => setError(en ? "Cannot play the reference video" : "参考片播放失败")); }
          }}>{playing ? <LuPause /> : <LuPlay />}</button>
          <label><select className={styles.select} aria-label={en ? "Reference shot" : "参考镜头"} value={shot.shotId} onChange={(e) => move(assets.findIndex((s) => s.shotId === Number(e.target.value)))}>
            {assets.map((s) => <option key={s.shotId} value={s.shotId}>#{s.shotId} · {seconds(s.referenceCut!.start)}–{seconds(s.referenceCut!.end)} s{s.referenceCut!.locked ? (en ? " · Locked" : " · 已锁定") : ""}</option>)}
          </select></label>
          <button type="button" aria-label={en ? "Next shot" : "下一镜"} disabled={index===assets.length-1} onClick={() => move(index+1)}><LuChevronRight /></button>
        </div>
        <div className={styles.track}>
          <div className={styles.trackHead}><span><LuFilm aria-hidden />{en ? "Shot timeline" : "镜头时间线"}</span><span>{assets.length} {en ? "shots" : "镜"} · 30 fps · {timecode(duration)}</span></div>
          <div className={styles.strip} role="group" aria-label={en ? "Shot timeline" : "镜头时间线"} onKeyDown={(e) => {
            if (!["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) return;
            e.preventDefault(); move(e.key==="Home" ? 0 : e.key==="End" ? assets.length-1 : index+(e.key==="ArrowRight" ? 1 : -1),true);
          }}>
            {assets.map((s,i) => {
              const img = s.isVideo ? s.keyframeUrl ?? s.referenceCut?.productImage : s.thumbnailUrl ?? s.referenceCut?.productImage;
              return <button type="button" key={s.shotId} data-cut aria-pressed={i===index} tabIndex={i===index ? 0 : -1} onClick={() => move(i,true)} style={{ flexGrow: s.duration }} aria-label={en ? `Shot ${s.shotId}, ${seconds(s.duration)} seconds` : `第 ${s.shotId} 镜，${seconds(s.duration)} 秒`}>
                <span className={styles.stamp}>{seconds(s.referenceCut!.start)}s</span>
                <span className={styles.filmCell}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img && <img src={img} alt="" loading="lazy" />}<span>{String(s.shotId).padStart(2,"0")}</span>{s.referenceCut!.locked && <LuLockKeyhole aria-hidden />}
                </span></button>;
            })}
          </div>
        </div>
      </div>
      <aside className={styles.inspector}>
        <h3><LuSlidersHorizontal aria-hidden />{en ? "Shot inspector" : "镜头检查器"}</h3>
        <div className={styles.shotTitle}><strong>{en ? `Shot ${shot.shotId}` : `第 ${shot.shotId} 镜`}</strong>
          <button type="button" aria-pressed={cut.locked} disabled={changed} onClick={() => void run(() => update({ action: "lock", locked: !cut.locked }))}>
            {cut.locked ? <LuLockKeyhole aria-hidden /> : <LuLockKeyholeOpen aria-hidden />}{cut.locked ? (en ? "Unlock shot" : "解锁此镜") : (en ? "Lock shot" : "锁定此镜")}
          </button></div>
        <dl className={styles.timing}><div><dt>{en ? "In" : "入点"}</dt><dd>{timecode(cut.start)}</dd></div><div><dt>{en ? "Out" : "出点"}</dt><dd>{timecode(cut.end)}</dd></div></dl>
        <fieldset disabled={cut.locked} className={styles.properties}>
          <label>{en ? "Shot direction" : "镜头描述"}<textarea maxLength={2000} value={description} onChange={(e) => editDraft({ ...draft, description: e.target.value })} /></label>
          <label>{en ? "Product photo" : "商品图"}<select className={styles.select} value={product} onChange={(e) => editDraft({ ...draft, product: e.target.value })}>{products.map((p,i)=><option key={p} value={p}>#{i+1} · {en ? "Product photo" : "商品图"}</option>)}</select></label>
          <Button size="sm" variant="outline" disabled={!changed || !description.trim()} onClick={() => void run(saveChanges)}>{en ? "Save shot" : "保存此镜"}</Button>
        <div className={styles.aiAction}>{modelName ? <Button size="sm" variant="outline" disabled={changed || !frameReady || playing} onClick={() => void run(async () => {
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
          : <Link className={styles.modelSettings} href="/settings">{en ? "Configure AI for this shot" : "配置单镜 AI 生成"}</Link>}
      </div>
      {shot.isVideo && shot.assetId && <div className={styles.spanControls}>
        <label className="text-sm">{en ? "Use this video through shot " : "将这段视频按原切点铺到镜头 "}
          <select className={styles.select} value={until} onChange={(e) => setUntil(Number(e.target.value))}>{assets.filter((s) => s.shotId >= shot.shotId).map((s) => <option key={s.shotId} value={s.shotId}>#{s.shotId}</option>)}</select>
        </label>
        <Button size="sm" variant="outline" onClick={() => void run(() => update({ action: "span", assetId: shot.assetId, lastShotId: until }))}>{en ? "Apply video range" : "应用视频区间"}</Button>
      </div>}
        </fieldset>
      </aside>
    </div>
    <footer className={styles.status} aria-live="polite">
      <LuClapperboard aria-hidden />{working ? (en ? "Working…" : "处理中…") : changed ? (en ? "Editing · switching shots saves changes" : "正在编辑 · 切镜时自动保存") : (en ? "Ready to compose with your product photos" : "可用当前商品图直接合成")}
    </footer>
    {(shot.error || error) && <p role="alert" className="px-4 py-2 text-sm text-destructive">{shot.error || error}</p>}
  </fieldset>;
}
