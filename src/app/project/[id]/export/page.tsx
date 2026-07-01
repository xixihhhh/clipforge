"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { LuCheck, LuCircleCheck, LuFilm, LuDownload, LuLink2, LuFileText, LuPlus, LuHouse, LuSmartphone, LuShuffle, LuLoaderCircle } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { buildPublishPack } from "@/lib/publish-pack";
import { useT, useLocale } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";
import { PerformanceFeedback } from "@/components/performance-feedback";

// platform export config (planned feature, for display). name uses an i18n key (nameKey) resolved to the translated text at render time
const platformConfigs = [
  { id: "douyin", nameKey: "platformDouyin", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-pink-500 to-red-500" },
  { id: "kuaishou", nameKey: "platformKuaishou", ratio: "9:16", resolution: "1080p", subtitle: "贴边框", color: "from-orange-500 to-amber-500" },
  { id: "xiaohongshu", nameKey: "platformXiaohongshu", ratio: "3:4", resolution: "1440p", subtitle: "手写字体", color: "from-red-500 to-rose-500" },
  { id: "shipinhao", nameKey: "platformShipinhao", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-green-500 to-emerald-600" },
  { id: "tiktok", nameKey: "platformTiktok", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-slate-700 to-slate-900" },
  { id: "reels", nameKey: "platformReels", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-fuchsia-500 to-purple-600" },
  { id: "shorts", nameKey: "platformShorts", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-red-600 to-red-700" },
];

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
  const [scriptInfo, setScriptInfo] = useState<ScriptInfo | null>(null);
  const [fileSize, setFileSize] = useState<string>("");
  // publish copy
  const { llm } = useSettingsStore();
  const [productMeta, setProductMeta] = useState<{ productName: string; category: string; description: string } | null>(null);
  const [publish, setPublish] = useState<{ loading: boolean; titles: string[]; hashtags: string[]; caption: string; error?: string; template?: boolean }>({ loading: false, titles: [], hashtags: [], caption: "" });
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

  const generatePublish = async () => {
    // LLM not configured: fall back to the key-free template copy pack so users can still "copy and publish" (with LLM configured, the AI path below produces better copy)
    if (!llm.apiKey) {
      const pack = buildPublishPack({
        productName: productMeta?.productName || projectName,
        category: productMeta?.category,
        sellingPoints: productMeta?.description,
        locale: locale === "en" ? "en" : "zh", // follow the UI language: English users receive English copy
      });
      setPublish({ loading: false, titles: pack.titles, hashtags: pack.hashtags, caption: pack.caption, template: true });
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
      setPublish({ loading: false, titles: data.titles ?? [], hashtags: data.hashtags ?? [], caption: data.caption ?? "" });
    } catch (e) {
      setPublish((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : t("publishFailed") }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [compRes, projRes, scriptsRes] = await Promise.all([
          fetch(`/api/project/${id}/compose`),
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
            });
          }
        }
        if (compRes.ok) {
          const data = await compRes.json();
          if (!cancelled && data.composition) setComposition(data.composition);
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

  // multi-platform export state: platformId → { status, url }
  const [platformExports, setPlatformExports] = useState<Record<string, { status: "idle" | "exporting" | "done" | "error"; url?: string }>>({});
  const exportPlatform = async (platformId: string) => {
    setPlatformExports((prev) => ({ ...prev, [platformId]: { status: "exporting" } }));
    try {
      const res = await fetch(`/api/project/${id}/export-platform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: platformId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("exportFailed"));
      setPlatformExports((prev) => ({ ...prev, [platformId]: { status: "done", url: data.url } }));
    } catch (e) {
      setPlatformExports((prev) => ({ ...prev, [platformId]: { status: "error" } }));
      showToast(e instanceof Error ? e.message : t("exportFailed"));
    }
  };

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

  const headerBar = (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">ClipForge</span>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground truncate max-w-[40vw] sm:max-w-xs">{projectName || t("projectFallback")}</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          {/* step pills don't fit on narrow screens, hidden on mobile (progress display only, not navigation) */}
          <div className="hidden sm:flex items-center gap-1">
            {["stepScript", "stepAssets", "stepVideo", "stepExport"].map((stepKey, i) => (
              <div key={stepKey} className="flex items-center">
                <div className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${i === 3 ? "bg-primary text-primary-foreground" : "text-primary"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${i === 3 ? "bg-white/20" : "bg-primary/20"}`}>
                    {i < 3 ? "✓" : i + 1}
                  </span>
                  {t(stepKey)}
                </div>
                {i < 3 && <div className="mx-1 h-px w-4 bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  );

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
            <Link href="/">
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
            <Button className="brand-gradient text-white h-11 px-8 text-sm font-semibold w-full">
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* multi-platform export (real re-encoding) */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <LuSmartphone className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">{t("multiExportTitle")}</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{t("multiExportDesc")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {platformConfigs.map(platform => {
                const ex = platformExports[platform.id] ?? { status: "idle" as const };
                const platformName = t(platform.nameKey);
                return (
                  <div key={platform.id} className="p-3 rounded-lg border border-border/50 bg-muted/10">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-6 h-6 rounded bg-gradient-to-br ${platform.color} flex items-center justify-center`}>
                        <span className="text-[10px] text-white font-bold">{platformName[0]}</span>
                      </div>
                      <span className="text-sm font-medium">{platformName}</span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>{t("ratioLabel", { ratio: platform.ratio })}</p>
                      <p>{t("resolutionLabel", { resolution: platform.resolution })}</p>
                    </div>
                    {ex.status === "done" && ex.url ? (
                      <a href={`${ex.url}?download=1`} download>
                        <Button variant="outline" size="sm" className="w-full mt-2 text-xs text-emerald-600">
                          <LuDownload className="w-3 h-3 mr-1" />
                          {t("downloadPlatform", { platform: platformName })}
                        </Button>
                      </a>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 text-xs"
                        disabled={ex.status === "exporting"}
                        onClick={() => exportPlatform(platform.id)}
                      >
                        {ex.status === "exporting" ? t("exporting") : ex.status === "error" ? t("retryExport") : t("exportPlatform", { platform: platformName })}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* performance feedback: backfill data after publishing → learn which style sells better */}
        <div className="mb-6">
          <PerformanceFeedback projectId={id} />
        </div>

        {/* A/B variants: re-render one video per subtitle style + BGM combo to compare conversion rates in ads */}
        <Card className="glass-card mb-6">
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
          <Link href="/">
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
