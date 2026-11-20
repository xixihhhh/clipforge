"use client";

import { DUB_LANGUAGES } from "@/lib/tts-voices";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { LuCheck, LuCircleCheck, LuFilm, LuDownload, LuLink2, LuFileText, LuPlus, LuHouse, LuShuffle, LuLoaderCircle, LuSparkles, LuImage, LuLayoutGrid, LuQrCode, LuScanLine, LuLanguages, LuShieldCheck, LuTriangleAlert, LuCircleX, LuClipboardCheck } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { buildPublishPack, buildAiDeclaration, type CommentKit } from "@/lib/publish-pack";
import { buildShopLink } from "@/lib/shop-link";
import { useT, useLocale } from "@/lib/i18n";
import { ProjectHeader } from "@/components/project-header";
import { PerformanceFeedback } from "@/components/performance-feedback";

import { PlatformExportPanel } from "@/components/platform-export-panel";

// A/B variant presets: re-render one video per preset using existing params (subtitle style + BGM mood) to compare which converts better in ads (no key required throughout)
const AB_PRESETS: { key: string; labelKey: string; compose: Record<string, unknown> }[] = [
  { key: "karaoke", labelKey: "abVariantKaraoke", compose: { karaoke: true, bgmMood: "upbeat" } },
  { key: "rapid", labelKey: "abVariantRapid", compose: { bgmMood: "energetic" } },
];

// script style → i18n key (resolved to translated text at render time)
const styleLabelKeys: Record<string, string> = {
  pain_point: "stylePainPoint",
  scene: "styleScene",
  comparison: "styleComparison",
  story: "styleStory",
  drama: "styleDrama",
  reversal: "styleReversal",
  interview: "styleInterview",
  unboxing: "styleUnboxing",
  product_pov: "styleProductPov",
  talking_head: "styleTalkingHead",
  auto: "styleAuto",
};

interface Composition {
  url: string | null;
  fileName: string;
  resolution: string | null;
  aspectRatio: string | null;
  status: string;
  createdAt: string | null;
}

interface ScriptInfo {
  styleType: string;
  totalDuration: number;
  shotCount: number;
}

export default function ExportPage() {
  const t = useT("exportPage");
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [composition, setComposition] = useState<Composition | null>(null);
  // full output history (variant-matrix renders carry a label) — the latest-only view hid variants
  const [history, setHistory] = useState<Array<{ id: string; url: string | null; label?: string | null; createdAt?: string | number | null }>>([]);
  const [scriptInfo, setScriptInfo] = useState<ScriptInfo | null>(null);
  const [fileSize, setFileSize] = useState<string>("");
  // publish copy
  const { llm } = useSettingsStore();
  const [productMeta, setProductMeta] = useState<{ productName: string; category: string; description: string; shopUrl?: string; affiliateCode?: string } | null>(null);
  const [publish, setPublish] = useState<{ loading: boolean; titles: string[]; hashtags: string[]; caption: string; commentKit?: CommentKit; shopLink?: string; error?: string; template?: boolean }>({ loading: false, titles: [], hashtags: [], caption: "" });
  // A/B variant generation (re-render with different subtitle styles and BGM, one each, for ad comparison)
  const [abVariants, setAbVariants] = useState<{ key: string; labelKey: string; status: "running" | "done" | "error"; url?: string }[]>([]);
  const [abRunning, setAbRunning] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showToast(t("copied")); } catch { showToast(t("copyFailed")); }
  };

  // sequentially re-render each A/B variant (different subtitle style + BGM); produce a download link as each one completes; no key required throughout
  const generateAbVariants = async () => {
    if (abRunning) return;
    setAbRunning(true);
    setAbVariants(AB_PRESETS.map((p) => ({ key: p.key, labelKey: p.labelKey, status: "running" as const })));
    for (const p of AB_PRESETS) {
      try {
        const res = await fetch(`/api/project/${id}/compose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resolution: composition?.resolution === "720p" ? "720p" : "1080p",
            aspectRatio: composition?.aspectRatio || "9:16",
            freeTts: { enabled: true },
            freeBgm: true,
            ...p.compose,
          }),
        });
        if (!res.ok) throw new Error("compose failed");
        // poll by the compositionId from this render (avoids GET latest aliasing multiple same-second variants to the same file)
        const { compositionId } = await res.json();
        const url = await new Promise<string>((resolve, reject) => {
          const poll = setInterval(async () => {
            try {
              const r = await fetch(`/api/project/${id}/compose?compositionId=${compositionId}`);
              const d = await r.json();
              const c = d.composition;
              if (c?.status === "done" && c.url) { clearInterval(poll); resolve(c.url); }
              else if (c?.status === "failed") { clearInterval(poll); reject(new Error("failed")); }
            } catch { /* ignore single poll failure */ }
          }, 3000);
          setTimeout(() => { clearInterval(poll); reject(new Error("timeout")); }, 300000);
        });
        setAbVariants((prev) => prev.map((x) => (x.key === p.key ? { ...x, status: "done", url } : x)));
      } catch {
        setAbVariants((prev) => prev.map((x) => (x.key === p.key ? { ...x, status: "error" } : x)));
      }
    }
    setAbRunning(false);
  };

  // ---- "More outputs": surface the monetization/localization tools that were previously CLI/MCP-only
  // (cover / Xiaohongshu carousel / shop QR / scan-to-buy end-card / multi-language dub). Each calls an
  // existing route and shows its artifact; no new backend. ----
  type ToolState = { loading?: boolean; error?: string; images?: string[]; video?: string; note?: string; shopLink?: string; warning?: string };
  const [more, setMore] = useState<Record<string, ToolState>>({});
  const setTool = (k: string, v: ToolState) => setMore((m) => ({ ...m, [k]: { ...m[k], ...v } }));
  const [coverTitle, setCoverTitle] = useState("");
  const [dubLang, setDubLang] = useState("en");
  const hasShopUrl = !!productMeta?.shopUrl;

  const genCover = async () => {
    const title = (coverTitle || productMeta?.productName || projectName).trim();
    if (!title) { setTool("cover", { error: t("moreCoverNeedTitle") }); return; }
    setTool("cover", { loading: true, error: undefined, images: undefined });
    try {
      const r = await fetch(`/api/project/${id}/cover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setTool("cover", { loading: false, images: [d.cover] });
    } catch (e) { setTool("cover", { loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };
  const genCarousel = async () => {
    setTool("carousel", { loading: true, error: undefined, images: undefined });
    try {
      const r = await fetch(`/api/project/${id}/carousel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "night" }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setTool("carousel", { loading: false, images: Array.isArray(d.cards) ? d.cards : [] });
    } catch (e) { setTool("carousel", { loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };
  const genQr = async () => {
    setTool("qr", { loading: true, error: undefined, images: undefined });
    try {
      const r = await fetch(`/api/project/${id}/shop-qr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setTool("qr", { loading: false, images: [d.qr], shopLink: d.shopLink, warning: d.warning ? (locale === "en" ? d.warning.en : d.warning.zh) : undefined });
    } catch (e) { setTool("qr", { loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };
  const genEndCard = async () => {
    setTool("endcard", { loading: true, error: undefined, video: undefined });
    try {
      const r = await fetch(`/api/project/${id}/end-card`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setTool("endcard", { loading: false, video: d.video, shopLink: d.shopLink, warning: d.warning ? (locale === "en" ? d.warning.en : d.warning.zh) : undefined });
    } catch (e) { setTool("endcard", { loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };
  // composed-video quality check: black frames / silence / loudness / streams (bilingual report from the route)
  type QcUiCheck = { id: string; level: "ok" | "warn" | "fail"; message: { zh: string; en: string } };
  const [qc, setQc] = useState<{ loading?: boolean; error?: string; status?: "ok" | "warn" | "fail"; checks?: QcUiCheck[] }>({});
  const runQualityCheck = async () => {
    setQc({ loading: true });
    try {
      const r = await fetch(`/api/project/${id}/qc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setQc({ loading: false, status: d.status, checks: Array.isArray(d.checks) ? d.checks : [] });
    } catch (e) { setQc({ loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };

  // release gate: one aggregated pre-publish verdict (script readiness + video QC + asset licenses)
  type GateUiItem = { id: string; status: "pass" | "warn" | "fail"; message: { zh: string; en: string }; problems: { zh: string; en: string }[] };
  type GateUi = { loading?: boolean; error?: string; status?: "pass" | "warn" | "fail"; verdict?: { zh: string; en: string }; items?: GateUiItem[] };
  const [gate, setGate] = useState<GateUi>({});
  const runGate = async () => {
    setGate({ loading: true });
    try {
      const r = await fetch(`/api/project/${id}/gate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setGate({ loading: false, status: d.report?.status, verdict: d.report?.verdict, items: Array.isArray(d.report?.items) ? d.report.items : [] });
    } catch (e) { setGate({ loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };

  // contact sheet: one-image eyeball overview of the composed video. Smart mode samples real
  // scene cuts (red-outlined thumbs + waveform ticks); optional review proxy burns a timecode.
  const [sheet, setSheet] = useState<{ loading?: boolean; error?: string; url?: string; cuts?: number; proxy?: string }>({});
  const [wantProxy, setWantProxy] = useState(false);
  const runContactSheet = async () => {
    setSheet({ loading: true });
    try {
      const r = await fetch(`/api/project/${id}/contact-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wantProxy ? { proxy: true } : {}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setSheet({ loading: false, url: d.sheet, cuts: Array.isArray(d.cuts) ? d.cuts.length : 0, proxy: d.proxy });
    } catch (e) { setSheet({ loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };

  // asset license manifest: per-shot provenance + commercial-risk flags + attribution lines
  type CreditsUi = {
    loading?: boolean;
    error?: string;
    summary?: { total: number; needsAttribution: number; needsReview: number; commercialSafe: boolean };
    attributions?: string[];
    copiedIdx?: number;
  };
  const [credits, setCredits] = useState<CreditsUi>({});
  const runCredits = async () => {
    setCredits({ loading: true });
    try {
      const r = await fetch(`/api/project/${id}/credits`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      const all = [...(Array.isArray(d.items) ? d.items : []), ...(d.bgm ? [d.bgm] : [])];
      setCredits({
        loading: false,
        summary: d.summary,
        attributions: all.filter((i) => i.attributionLine).map((i) => i.attributionLine as string),
      });
    } catch (e) { setCredits({ loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };
  const copyAttribution = async (line: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(line);
      setCredits((c) => ({ ...c, copiedIdx: idx }));
      setTimeout(() => setCredits((c) => ({ ...c, copiedIdx: undefined })), 1500);
    } catch { /* clipboard unavailable (non-secure context) — the text stays selectable */ }
  };

  // native feel: hand-shot look post-process (handheld jitter + grain + de-polish),
  // plus opt-in halation (lens glow) and phone-compress (platform-transcode look) layers
  const [feelStrength, setFeelStrength] = useState<"subtle" | "medium" | "strong">("subtle");
  const [feelHalation, setFeelHalation] = useState(false);
  const [feelPhoneCompress, setFeelPhoneCompress] = useState(false);
  const genNativeFeel = async () => {
    setTool("feel", { loading: true, error: undefined, video: undefined });
    try {
      const r = await fetch(`/api/project/${id}/native-feel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strength: feelStrength, halation: feelHalation, phoneCompress: feelPhoneCompress }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setTool("feel", { loading: false, video: d.video, note: t("feelDone") });
    } catch (e) { setTool("feel", { loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };

  const genDub = async () => {
    if (!llm.apiKey) { setTool("dub", { error: t("moreDubNeedLlm") }); return; }
    setTool("dub", { loading: true, error: undefined, note: undefined });
    try {
      const r = await fetch(`/api/project/${id}/dub`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: dubLang, llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model } }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t("moreFailed"));
      setTool("dub", { loading: false, note: t("moreDubDone", { voice: d.recommendedVoice || "" }) });
    } catch (e) { setTool("dub", { loading: false, error: e instanceof Error ? e.message : t("moreFailed") }); }
  };

  // platform AI-disclosure kit (static, path-independent: shown with both the template pack and LLM copy)
  const aiDecl = buildAiDeclaration(locale === "en" ? "en" : "zh");

  const generatePublish = async () => {
    // UTM-tagged shop link (only when the project has a shopUrl) — surfaced alongside the copy so the
    // creator can paste a trackable link wherever the platform allows (bio / cart / description)
    const shopLink = buildShopLink(productMeta?.shopUrl, { affiliateCode: productMeta?.affiliateCode });
    // LLM not configured: fall back to the key-free template copy pack so users can still "copy and publish" (with LLM configured, the AI path below produces better copy)
    if (!llm.apiKey) {
      const pack = buildPublishPack({
        productName: productMeta?.productName || projectName,
        category: productMeta?.category,
        sellingPoints: productMeta?.description,
        locale: locale === "en" ? "en" : "zh", // follow the UI language: English users receive English copy
      });
      setPublish({ loading: false, titles: pack.titles, hashtags: pack.hashtags, caption: pack.caption, commentKit: pack.commentKit, template: true, ...(shopLink && { shopLink }) });
      return;
    }
    setPublish((p) => ({ ...p, loading: true, error: undefined, template: false }));
    try {
      const res = await fetch("/api/llm/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: productMeta?.productName || projectName,
          category: productMeta?.category,
          productDescription: productMeta?.description,
          locale: locale === "en" ? "en" : "zh", // follow the UI language: English users' LLM also outputs English copy
          llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("publishFailed"));
      setPublish({ loading: false, titles: data.titles ?? [], hashtags: data.hashtags ?? [], caption: data.caption ?? "", commentKit: data.commentKit, ...(shopLink && { shopLink }) });
    } catch (e) {
      setPublish((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : t("publishFailed") }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // list *successful* compositions (a failed retry on top must not blank this page)
        const [compRes, projRes, scriptsRes] = await Promise.all([
          fetch(`/api/project/${id}/compositions`),
          fetch(`/api/project/${id}`),
          fetch(`/api/project/${id}/scripts`),
        ]);
        if (projRes.ok) {
          const proj = await projRes.json();
          if (!cancelled) {
            setProjectName(proj.name ?? proj.productName ?? "");
            setProductMeta({
              productName: proj.productName ?? proj.name ?? "",
              category: proj.productCategory ?? "",
              description: proj.productDescription ?? "",
              shopUrl: proj.shopUrl ?? undefined,
              affiliateCode: proj.affiliateCode ?? undefined,
            });
          }
        }
        if (compRes.ok) {
          const data = await compRes.json();
          const latestDone = Array.isArray(data.compositions) ? data.compositions[0] : null;
          if (!cancelled && latestDone) setComposition(latestDone);
          if (!cancelled && Array.isArray(data.compositions)) setHistory(data.compositions);
        }
        if (scriptsRes.ok) {
          const arr = await scriptsRes.json();
          const sel = Array.isArray(arr) ? (arr.find((s: { selected?: boolean }) => s.selected) ?? arr[0]) : null;
          if (!cancelled && sel) {
            setScriptInfo({
              styleType: sel.styleType,
              totalDuration: sel.totalDuration ?? 0,
              shotCount: Array.isArray(sel.shots) ? sel.shots.length : 0,
            });
          }
        }
      } catch {
        // ignore, fall through to empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // once the real composed video is available, HEAD-probe for the file size
  useEffect(() => {
    if (!composition?.url) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(composition.url!, { method: "HEAD" });
        const len = res.headers.get("content-length");
        if (len && !cancelled) {
          const mb = Number(len) / 1024 / 1024;
          setFileSize(mb >= 1 ? `${mb.toFixed(1)} MB` : `${(Number(len) / 1024).toFixed(0)} KB`);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [composition?.url]);

  const handleCopyLink = async () => {
    if (!composition?.url) return;
    const full = `${window.location.origin}${composition.url}`;
    try {
      await navigator.clipboard.writeText(full);
      showToast(t("linkCopied"));
    } catch {
      showToast(t("copyLinkFailed"));
    }
  };

  const dateStr = composition?.createdAt
    ? new Date(composition.createdAt).toLocaleDateString("zh-CN")
    : "";

  // slim context strip (shared by loading, empty and normal states); global chrome lives in AppShell
  const headerBar = <ProjectHeader projectName={projectName || t("projectFallback")} />;

  if (loading) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
          <LuLoaderCircle className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">{t("loadingComposition")}</p>
        </div>
      </div>
    );
  }

  // empty state: no composed video yet
  if (!composition || !composition.url) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="mx-auto max-w-md flex flex-col items-center justify-center py-28 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 mb-5">
            <LuFilm className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-2">{t("emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t("emptyDesc", { name: projectName || t("emptyProjectFallback") })}
          </p>
          <div className="flex items-center gap-3">
            <Link href={`/project/${id}/video`}>
              <Button className="brand-gradient text-white">{t("goCompose")}</Button>
            </Link>
            <Link href="/projects">
              <Button variant="outline">{t("backToProjects")}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid-bg">
      {/* toast notification */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm shadow-xl">
            <LuCheck className="w-4 h-4" />
            {toast}
          </div>
        </div>
      )}

      {headerBar}

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* completion banner */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
            <LuCircleCheck className="w-8 h-8 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">
            {t("doneTitleRest")}<span className="brand-gradient-text">{t("doneTitleAccent")}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("doneSubtitle")}
          </p>
        </div>

        {/* video preview (real composed output) */}
        <Card className="glass-card neon-glow mb-6 overflow-hidden">
          <CardContent className="p-0">
            <div className="mx-auto max-w-xs">
              <div className="relative aspect-[9/16] bg-black flex items-center justify-center">
                <video
                  src={composition.url}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* video info bar */}
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{composition.resolution ?? "1080p"}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{composition.aspectRatio ?? "9:16"}</span>
                {fileSize && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                    <span>{fileSize}</span>
                  </>
                )}
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>MP4</span>
              </div>
              {dateStr && <span className="text-xs text-muted-foreground">{dateStr}</span>}
            </div>
          </CardContent>
        </Card>

        {/* action buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-8">
          <a href={`${composition.url}?download=1`} download={composition.fileName}>
            <Button className="brand-gradient text-white h-12 px-8 text-base font-semibold w-full">
              <LuDownload className="w-[18px] h-[18px] mr-2" />
              {t("downloadVideo")}
            </Button>
          </a>
          <Button
            variant="outline"
            onClick={handleCopyLink}
            className="h-11 px-6 text-sm"
          >
            <LuLink2 className="w-4 h-4 mr-2" />
            {t("copyShareLink")}
          </Button>
        </div>

        {/* output history: every successful render, newest first — variant-matrix outputs
            show their combo label so A/B takes stay reachable after leaving the video page */}
        {history.length > 1 && (
          <Card className="glass-card mb-6">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold mb-3">🎞 {t("historyTitle", { n: history.length })}</h3>
              <div className="space-y-1.5">
                {history.map((h, i) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground/60 shrink-0 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    <span className="truncate flex-1 text-muted-foreground">
                      {h.label || t("historyUnlabeled")}
                    </span>
                    {h.createdAt && (
                      <span className="text-muted-foreground/60 shrink-0">
                        {new Date(h.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    {h.url && (
                      <a href={h.url} target="_blank" rel="noreferrer" className="text-primary underline shrink-0">
                        {t("historyView")}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* publish copy (AI-generated title / hashtags / promotional caption) */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <LuFileText className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">{t("publishTitle")}</h3>
              </div>
              <Button size="sm" variant="outline" className="text-xs" disabled={publish.loading} onClick={generatePublish}>
                {publish.loading ? t("publishGenerating") : publish.titles.length ? t("publishRegenerate") : t("publishGenerate")}
              </Button>
            </div>
            {publish.error && <p className="text-xs text-destructive mb-2">{publish.error}</p>}
            {publish.titles.length === 0 && !publish.loading && !publish.error && (
              <p className="text-xs text-muted-foreground">{t("publishHint")}</p>
            )}
            {publish.titles.length > 0 && (
              <div className="space-y-3">
                {publish.template && (
                  <p className="text-[11px] text-muted-foreground">{t("publishTemplateNote")}</p>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">{t("publishTitlesLabel")}</p>
                  <div className="space-y-1.5">
                    {publish.titles.map((t, i) => (
                      <button key={i} onClick={() => copyText(t)} className="w-full text-left text-sm px-3 py-2 rounded-lg border border-border/50 bg-muted/10 hover:border-primary/50 transition-colors">
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {publish.hashtags.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs text-muted-foreground">{t("publishHashtagsLabel")}</p>
                      <button onClick={() => copyText(publish.hashtags.join(" "))} className="text-xs text-primary">{t("publishCopyAll")}</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {publish.hashtags.map((h, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {publish.caption && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">{t("publishCaptionLabel")}</p>
                    <button onClick={() => copyText(publish.caption)} className="w-full text-left text-sm px-3 py-2 rounded-lg border border-border/50 bg-muted/10 hover:border-primary/50 transition-colors">
                      {publish.caption}
                    </button>
                  </div>
                )}
                {publish.shopLink && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">{t("publishShopLinkLabel")}</p>
                    <button onClick={() => copyText(publish.shopLink!)} className="w-full text-left text-xs px-3 py-2 rounded-lg border border-border/50 bg-muted/10 hover:border-primary/50 transition-colors break-all">
                      {publish.shopLink}
                    </button>
                  </div>
                )}
                {/* comment-section ops kit: the video's second landing page — a pinned self-Q&A
                    plus objection reply templates (deliberately NO seeded fake comments) */}
                {publish.commentKit && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">{t("publishCommentKitLabel")}</p>
                    <p className="text-[11px] text-muted-foreground mb-1">{t("publishCommentPinned")}</p>
                    <button onClick={() => copyText(publish.commentKit!.pinned)} className="w-full text-left text-sm px-3 py-2 rounded-lg border border-border/50 bg-muted/10 hover:border-primary/50 transition-colors mb-2">
                      {publish.commentKit.pinned}
                    </button>
                    <p className="text-[11px] text-muted-foreground mb-1">{t("publishCommentObjections")}</p>
                    <div className="space-y-1.5">
                      {publish.commentKit.objections.map((o, i) => (
                        <button key={i} onClick={() => copyText(o.a)} className="w-full text-left px-3 py-2 rounded-lg border border-border/50 bg-muted/10 hover:border-primary/50 transition-colors">
                          <span className="block text-[11px] text-muted-foreground">{o.q}</span>
                          <span className="block text-sm">{o.a}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-amber-500/90 mt-1.5">{publish.commentKit.notice}</p>
                  </div>
                )}
                {/* platform AI-disclosure kit: toggle reminder + paste-ready caption line (undeclared AI content gets auto-flagged and throttled) */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">{t("publishAiDeclLabel")}</p>
                  <p className="text-[11px] text-amber-500/90 mb-1.5">{aiDecl.notice}</p>
                  <button onClick={() => copyText(aiDecl.line)} className="text-left text-xs px-3 py-2 rounded-lg border border-border/50 bg-muted/10 hover:border-primary/50 transition-colors">
                    {aiDecl.line}
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <PlatformExportPanel key={id} projectId={id} compositions={history} />

        {/* advanced tools (collapsed by default): feedback / A/B testing / QC & compliance — keeps the primary download action prominent for casual users */}
        <details className="group rounded-xl border border-border/50 bg-card/30 mb-6">
          <summary className="flex items-center justify-between cursor-pointer list-none select-none px-5 py-3.5 text-muted-foreground hover:text-foreground">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{t("advancedTitle")}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{t("advancedHint")}</span>
            </div>
            <svg className="size-4 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {/* performance feedback: backfill data after publishing → learn which style sells better */}
            <PerformanceFeedback projectId={id} />

            {/* A/B variants: re-render one video per subtitle style + BGM combo to compare conversion rates in ads */}
            <Card className="glass-card">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <LuShuffle className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">{t("abTitle")}</h3>
                  </div>
                  <Button size="sm" variant="outline" className="text-xs" disabled={abRunning || !composition?.url} onClick={generateAbVariants}>
                    {abRunning ? t("abRunning") : t("abGenerate")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{t("abDesc")}</p>
                {abVariants.length > 0 && (
                  <div className="space-y-2">
                    {abVariants.map((v) => (
                      <div key={v.key} className="flex items-center justify-between rounded-md border border-border/40 bg-muted/10 px-3 py-2">
                        <span className="text-xs">{t(v.labelKey)}</span>
                        {v.status === "running" && <LuLoaderCircle className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                        {v.status === "done" && v.url && (
                          <a href={`${v.url}?download=1`} download>
                            <Button size="sm" variant="outline" className="text-xs h-7">{t("abDownload")}</Button>
                          </a>
                        )}
                        {v.status === "error" && <span className="text-xs text-destructive">{t("abFailed")}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* release gate: aggregated pre-publish verdict (script readiness + video QC + asset licenses) */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><LuClipboardCheck className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("gateTitle")}</span></div>
                <Button size="sm" variant="outline" className="text-xs h-7" disabled={gate.loading} onClick={runGate}>
                  {gate.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("gateRun")}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("gateHint")}</p>
              {gate.error && <p className="text-[11px] text-destructive mt-1">{gate.error}</p>}
              {gate.status && gate.verdict && (
                <p className={`text-[11px] mt-2 font-medium ${gate.status === "pass" ? "text-emerald-500" : gate.status === "warn" ? "text-amber-500" : "text-destructive"}`}>
                  {locale === "en" ? gate.verdict.en : gate.verdict.zh}
                </p>
              )}
              {gate.items && gate.items.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {gate.items.map((item) => (
                    <li key={item.id} className="text-[11px] text-muted-foreground">
                      <div className="flex items-start gap-1.5">
                        {item.status === "pass" ? <LuCircleCheck className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" /> : item.status === "warn" ? <LuTriangleAlert className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" /> : <LuCircleX className="w-3 h-3 mt-0.5 shrink-0 text-destructive" />}
                        <span>{locale === "en" ? item.message.en : item.message.zh}</span>
                      </div>
                      {item.problems.length > 0 && (
                        <ul className="mt-0.5 ml-4 space-y-0.5">
                          {item.problems.map((p, i) => (
                            <li key={i} className="text-[10px] text-muted-foreground/80">· {locale === "en" ? p.en : p.zh}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* composed-video quality check */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><LuShieldCheck className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("qcTitle")}</span></div>
                <Button size="sm" variant="outline" className="text-xs h-7" disabled={qc.loading || !composition?.url} onClick={runQualityCheck}>
                  {qc.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("qcRun")}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("qcHint")}</p>
              {qc.error && <p className="text-[11px] text-destructive mt-1">{qc.error}</p>}
              {qc.status && (
                <p className={`text-[11px] mt-2 font-medium ${qc.status === "ok" ? "text-emerald-500" : qc.status === "warn" ? "text-amber-500" : "text-destructive"}`}>
                  {qc.status === "ok" ? t("qcPass") : qc.status === "warn" ? t("qcWarn") : t("qcFail")}
                </p>
              )}
              {qc.checks && qc.checks.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {qc.checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      {c.level === "ok" ? <LuCircleCheck className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" /> : c.level === "warn" ? <LuTriangleAlert className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" /> : <LuCircleX className="w-3 h-3 mt-0.5 shrink-0 text-destructive" />}
                      <span>{locale === "en" ? c.message.en : c.message.zh}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* contact sheet: eyeball overview (filmstrip + waveform) */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><LuFilm className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("sheetTitle")}</span></div>
                <Button size="sm" variant="outline" className="text-xs h-7" disabled={sheet.loading || !composition?.url} onClick={runContactSheet}>
                  {sheet.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("sheetRun")}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("sheetHint")}</p>
              <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" className="w-3 h-3 accent-primary" checked={wantProxy} onChange={(e) => setWantProxy(e.target.checked)} />
                {t("sheetProxyOpt")}
              </label>
              {sheet.error && <p className="text-[11px] text-destructive mt-1">{sheet.error}</p>}
              {sheet.url && (
                <a href={sheet.url} target="_blank" rel="noreferrer" className="block mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sheet.url} alt={t("sheetTitle")} className="w-full rounded-md border border-border/50" />
                </a>
              )}
              {sheet.url && typeof sheet.cuts === "number" && (
                <p className="text-[11px] text-muted-foreground mt-1">{t("sheetCuts").replace("{n}", String(sheet.cuts))}</p>
              )}
              {sheet.proxy && (
                <a href={sheet.proxy} target="_blank" rel="noreferrer" className="inline-block mt-1 text-[11px] text-primary underline underline-offset-2">
                  {t("sheetProxyLink")}
                </a>
              )}
            </div>
            {/* asset license manifest */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><LuFileText className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("creditsTitle")}</span></div>
                <Button size="sm" variant="outline" className="text-xs h-7" disabled={credits.loading} onClick={runCredits}>
                  {credits.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("creditsRun")}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("creditsHint")}</p>
              {credits.error && <p className="text-[11px] text-destructive mt-1">{credits.error}</p>}
              {credits.summary && (
                <>
                  <p className={`text-[11px] mt-2 font-medium ${credits.summary.commercialSafe ? "text-emerald-500" : "text-amber-500"}`}>
                    {credits.summary.commercialSafe ? t("creditsSafe") : t("creditsUnsafe", { n: credits.summary.needsReview })}
                    {" · "}
                    <span className="text-muted-foreground font-normal">{t("creditsSummary", { total: credits.summary.total, attr: credits.summary.needsAttribution })}</span>
                  </p>
                  {credits.attributions && credits.attributions.length > 0 && (
                    <div className="mt-1.5">
                      <p className="text-[11px] text-muted-foreground mb-1">{t("creditsAttrLabel")}</p>
                      <ul className="space-y-1">
                        {credits.attributions.map((line, i) => (
                          <li key={i}>
                            <button
                              className="text-left text-[11px] text-foreground/80 hover:text-primary break-all"
                              onClick={() => copyAttribution(line, i)}
                            >
                              {line}{credits.copiedIdx === i && <span className="ml-1.5 text-emerald-500">{t("creditsCopied")}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <a href={`/api/project/${id}/credits?format=md&lang=${locale === "en" ? "en" : "zh"}`} download>
                    <Button size="sm" variant="outline" className="text-xs h-7 mt-2"><LuDownload className="w-3 h-3 mr-1" />{t("creditsDownloadMd")}</Button>
                  </a>
                </>
              )}
            </div>
            {/* native feel (hand-shot look) */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><LuFilm className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("feelTitle")}</span></div>
                <div className="flex items-center gap-2">
                  <select className="rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs" value={feelStrength} onChange={(e) => setFeelStrength(e.target.value === "medium" || e.target.value === "strong" ? (e.target.value as "medium" | "strong") : "subtle")}>
                    <option value="subtle">{t("feelStrengthSubtle")}</option>
                    <option value="medium">{t("feelStrengthMedium")}</option>
                    <option value="strong">{t("feelStrengthStrong")}</option>
                  </select>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                    <input type="checkbox" className="accent-primary" checked={feelHalation} onChange={(e) => setFeelHalation(e.target.checked)} />
                    {t("feelHalation")}
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                    <input type="checkbox" className="accent-primary" checked={feelPhoneCompress} onChange={(e) => setFeelPhoneCompress(e.target.checked)} />
                    {t("feelPhoneCompress")}
                  </label>
                  <Button size="sm" variant="outline" className="text-xs h-7" disabled={more.feel?.loading || !composition?.url} onClick={genNativeFeel}>
                    {more.feel?.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("moreGenerate")}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("feelHint")}</p>
              {more.feel?.error && <p className="text-[11px] text-destructive mt-1">{more.feel.error}</p>}
              {more.feel?.video && (
                <a href={`${more.feel.video}?download=1`} download>
                  <Button size="sm" variant="outline" className="text-xs h-7 mt-1"><LuDownload className="w-3 h-3 mr-1" />{t("feelDownload")}</Button>
                </a>
              )}
            </div>
            {/* multi-language dub */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><LuLanguages className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("moreDub")}</span></div>
                <div className="flex items-center gap-2">
                  <select className="rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs" value={dubLang} onChange={(e) => setDubLang(e.target.value)}>
                    {DUB_LANGUAGES.map((code) => (
                      <option key={code} value={code}>{new Intl.DisplayNames([code], { type: "language" }).of(code)}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" className="text-xs h-7" disabled={more.dub?.loading} onClick={genDub}>
                    {more.dub?.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("moreGenerate")}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("moreDubHint")}</p>
              {more.dub?.error && <p className="text-[11px] text-destructive mt-1">{more.dub.error}</p>}
              {more.dub?.note && <p className="text-[11px] text-emerald-500 mt-1">{more.dub.note}</p>}
            </div>
          </div>
        </details>

        {/* more outputs: monetization + localization tools (cover / carousel / shop QR / end-card / dub) */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <LuSparkles className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">{t("moreTitle")}</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{t("moreDesc")}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* cover */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                <div className="flex items-center gap-2 mb-2"><LuImage className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("moreCover")}</span></div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 min-w-0 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs"
                    placeholder={productMeta?.productName || projectName || t("moreCoverTitlePlaceholder")}
                    value={coverTitle}
                    onChange={(e) => setCoverTitle(e.target.value)}
                  />
                  <Button size="sm" variant="outline" className="text-xs h-7 shrink-0" disabled={more.cover?.loading || !composition?.url} onClick={genCover}>
                    {more.cover?.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("moreGenerate")}
                  </Button>
                </div>
                {more.cover?.error && <p className="mt-1.5 text-[11px] text-destructive">{more.cover.error}</p>}
                {more.cover?.images?.[0] && (
                  <a href={`${more.cover.images[0]}?download=1`} download className="mt-2 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={more.cover.images[0]} alt="cover" className="w-24 rounded-md border border-border/30" />
                  </a>
                )}
              </div>
              {/* xiaohongshu carousel */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><LuLayoutGrid className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("moreCarousel")}</span></div>
                  <Button size="sm" variant="outline" className="text-xs h-7" disabled={more.carousel?.loading} onClick={genCarousel}>
                    {more.carousel?.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("moreGenerate")}
                  </Button>
                </div>
                {more.carousel?.error && <p className="text-[11px] text-destructive">{more.carousel.error}</p>}
                {more.carousel?.images && more.carousel.images.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {more.carousel.images.map((img, i) => (
                      <a key={i} href={`${img}?download=1`} download className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img} alt={`card ${i}`} className="h-20 rounded-md border border-border/30" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {/* shop QR */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><LuQrCode className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("moreQr")}</span></div>
                  <Button size="sm" variant="outline" className="text-xs h-7" disabled={more.qr?.loading || !hasShopUrl} onClick={genQr}>
                    {more.qr?.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("moreGenerate")}
                  </Button>
                </div>
                {!hasShopUrl && <p className="text-[11px] text-muted-foreground">{t("moreNeedShopUrl")}</p>}
                {more.qr?.error && <p className="text-[11px] text-destructive">{more.qr.error}</p>}
                {more.qr?.warning && <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠️ {more.qr.warning}</p>}
                {more.qr?.images?.[0] && (
                  <a href={`${more.qr.images[0]}?download=1`} download className="mt-1 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={more.qr.images[0]} alt="qr" className="w-20 rounded-md border border-border/30 bg-white" />
                  </a>
                )}
              </div>
              {/* scan-to-buy end-card */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><LuScanLine className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium">{t("moreEndCard")}</span></div>
                  <Button size="sm" variant="outline" className="text-xs h-7" disabled={more.endcard?.loading || !hasShopUrl || !composition?.url} onClick={genEndCard}>
                    {more.endcard?.loading ? <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" /> : t("moreGenerate")}
                  </Button>
                </div>
                {!hasShopUrl && <p className="text-[11px] text-muted-foreground">{t("moreNeedShopUrl")}</p>}
                {more.endcard?.error && <p className="text-[11px] text-destructive">{more.endcard.error}</p>}
                {more.endcard?.warning && <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠️ {more.endcard.warning}</p>}
                {more.endcard?.video && (
                  <a href={`${more.endcard.video}?download=1`} download>
                    <Button size="sm" variant="outline" className="text-xs h-7 mt-1"><LuDownload className="w-3 h-3 mr-1" />{t("moreEndCardDownload")}</Button>
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* video details (real script data) */}
        <Card className="glass-card">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4">{t("detailTitle")}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">{t("detailStyle")}</p>
                  <p className="text-sm">{scriptInfo ? (styleLabelKeys[scriptInfo.styleType] ? t(styleLabelKeys[scriptInfo.styleType]) : scriptInfo.styleType) : t("emptyValue")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">{t("detailShots")}</p>
                  <p className="text-sm">{scriptInfo ? t("shotCount", { n: scriptInfo.shotCount }) : t("emptyValue")}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">{t("detailDuration")}</p>
                  <p className="text-sm">{scriptInfo?.totalDuration ? t("durationSeconds", { n: scriptInfo.totalDuration }) : t("emptyValue")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">{t("detailResolution")}</p>
                  <p className="text-sm">{composition.resolution ?? "1080p"} · {composition.aspectRatio ?? "9:16"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* bottom navigation */}
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/project/new">
            <Button className="brand-gradient text-white">
              <LuPlus className="w-4 h-4 mr-1.5" />
              {t("makeAnother")}
            </Button>
          </Link>
          <Link href="/projects">
            <Button variant="outline">
              <LuHouse className="w-4 h-4 mr-1.5" />
              {t("backToProjects")}
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
