"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { LuWand, LuClock, LuImage, LuArrowRight, LuBookmarkPlus, LuLoaderCircle, LuTriangleAlert, LuCircleCheck, LuCircleX, LuPencil } from "react-icons/lu";
import { checkScriptCompliance } from "@/lib/ad-compliance";
import { checkPublishReadiness } from "@/lib/publish-readiness";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { Shot } from "@/lib/db/schema";
import { useTemplateStore } from "@/lib/stores/template-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useT, useLocale } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";
import { LanguageToggle } from "@/components/language-toggle";
import { ProjectStepper } from "@/components/project-stepper";

// shot type labels (label changed to i18n key, resolved per locale at render time)
const shotTypeLabels: Record<Shot["type"], { labelKey: string; color: string }> = {
  hook: { labelKey: "shotTypeHook", color: "bg-red-500/20 text-red-400" },
  pain_point: { labelKey: "shotTypePainPoint", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { labelKey: "shotTypeProductReveal", color: "bg-blue-500/20 text-blue-400" },
  demo: { labelKey: "shotTypeDemo", color: "bg-green-500/20 text-green-400" },
  social_proof: { labelKey: "shotTypeSocialProof", color: "bg-purple-500/20 text-purple-400" },
  cta: { labelKey: "shotTypeCta", color: "bg-amber-500/20 text-amber-400" },
};

// script style → i18n key (resolved per locale at render time)
const styleLabelKeys: Record<string, string> = {
  pain_point: "stylePainPoint",
  scene: "styleScene",
  comparison: "styleComparison",
  story: "styleStory",
};

// structure of a script row returned from the backend scripts table
interface DbScript {
  id: string;
  title: string | null;
  styleType: string;
  totalDuration: number | null;
  shots: Shot[];
  selected: boolean | null;
}

export default function ScriptPage() {
  const t = useT("script");
  const tc = useT("common");
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [selectedScript, setSelectedScript] = useState(0);
  const [scripts, setScripts] = useState<
    { id: string; title: string; styleType: string; totalDuration: number; shots: Shot[] }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  // project metadata: reused when re-generating the script from the empty state
  const [projectMeta, setProjectMeta] = useState<{
    productName: string;
    category: string;
    description: string;
    productImages: string[];
    videoMode: string;
    contentType: string;
    topic: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const { llm } = useSettingsStore();

  // fetch real scripts by projectId (stored in the scripts table)
  const loadScripts = async () => {
    setLoading(true);
    try {
      const [scriptsRes, projectRes] = await Promise.all([
        fetch(`/api/project/${id}/scripts`),
        fetch(`/api/project/${id}`),
      ]);
      const dbScripts: DbScript[] = scriptsRes.ok ? await scriptsRes.json() : [];
      if (projectRes.ok) {
        const proj = await projectRes.json();
        setProjectName(proj.name ?? proj.productName ?? "");
        setProjectMeta({
          productName: proj.productName ?? "",
          category: proj.productCategory ?? "",
          description: proj.productDescription ?? "",
          productImages: Array.isArray(proj.productImages) ? proj.productImages : [],
          videoMode: proj.videoMode ?? "product_closeup",
          contentType: proj.contentType ?? "product",
          topic: proj.topic ?? "",
        });
      }
      if (Array.isArray(dbScripts) && dbScripts.length > 0) {
        setScripts(
          dbScripts.map((s) => ({
            id: s.id,
            title: s.title ?? t("untitledScript"),
            styleType: s.styleType,
            totalDuration: s.totalDuration ?? 0,
            shots: s.shots ?? [],
          }))
        );
        const selIdx = dbScripts.findIndex((s) => s.selected);
        setSelectedScript(selIdx >= 0 ? selIdx : 0);
      } else {
        // no real scripts: stay empty so the render layer shows the "generate" empty state
        // (fixes issue #3: old logic fell back to the Debao demo data, so users opening their own
        //  projects saw someone else's demo and thought "I can't find the task I created")
        setScripts([]);
      }
    } catch {
      setScripts([]);
    } finally {
      setLoading(false);
    }
  };

  // empty-state "generate script" click: topic projects use the de-commercialized script engine, commerce projects use the product script engine
  const handleGenerate = async () => {
    if (!projectMeta) return;
    if (!llm.apiKey) {
      setGenError(t("errorNoLlm"));
      return;
    }
    setIsGenerating(true);
    setGenError("");
    try {
      const isTopic = projectMeta.contentType === "topic";
      // topic projects use /api/topic/script (no product needed); otherwise use the commerce script engine
      const endpoint = isTopic ? "/api/topic/script" : "/api/llm/script";
      const payload = isTopic
        ? {
            projectId: id,
            topic: projectMeta.topic || projectName,
            targetDuration: 25,
            llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model },
          }
        : {
            projectId: id,
            productName: projectMeta.productName,
            category: projectMeta.category,
            productDescription: projectMeta.description,
            targetDuration: 30,
            styleType: "auto",
            videoMode: projectMeta.videoMode,
            productImages: projectMeta.productImages,
            llmConfig: {
              baseUrl: llm.baseUrl,
              apiKey: llm.apiKey,
              model: llm.model,
              visionModel: llm.visionModel,
            },
          };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || t("errorGenFailedCheckLlm"));
      }
      await loadScripts();
    } catch (err) {
      setGenError(friendlyError(err, locale));
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [scriptsRes, projectRes] = await Promise.all([
          fetch(`/api/project/${id}/scripts`),
          fetch(`/api/project/${id}`),
        ]);
        const dbScripts: DbScript[] = scriptsRes.ok ? await scriptsRes.json() : [];
        if (projectRes.ok) {
          const proj = await projectRes.json();
          if (!cancelled) {
            setProjectName(proj.name ?? proj.productName ?? "");
            setProjectMeta({
              productName: proj.productName ?? "",
              category: proj.productCategory ?? "",
              description: proj.productDescription ?? "",
              productImages: Array.isArray(proj.productImages) ? proj.productImages : [],
              videoMode: proj.videoMode ?? "product_closeup",
              contentType: proj.contentType ?? "product",
              topic: proj.topic ?? "",
            });
          }
        }
        if (cancelled) return;
        if (Array.isArray(dbScripts) && dbScripts.length > 0) {
          setScripts(
            dbScripts.map((s) => ({
              id: s.id,
              title: s.title ?? t("untitledScript"),
              styleType: s.styleType,
              totalDuration: s.totalDuration ?? 0,
              shots: s.shots ?? [],
            }))
          );
          // default to the script marked as selected
          const selIdx = dbScripts.findIndex((s) => s.selected);
          setSelectedScript(selIdx >= 0 ? selIdx : 0);
        } else {
          // no real scripts: stay empty so the render layer shows the "generate" empty state
          // (fixes issue #3: old logic fell back to the Debao demo data, so users opening their own
          //  projects saw someone else's demo and thought "I can't find the task I created")
          setScripts([]);
        }
      } catch {
        if (!cancelled) setScripts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentScript = scripts[selectedScript];
  // pre-render ad compliance scan: rule-check the current script's voiceover and text overlays; warn on risky terms (non-blocking)
  const adViolations = useMemo(
    () => (currentScript ? checkScriptCompliance(currentScript.shots as { voiceover?: string; textOverlay?: { text?: string } | null }[]) : []),
    [currentScript]
  );
  // pre-publish readiness check: inspect banned words / hook / duration / subtitles / CTA / three-act structure item by item (AIGC label is handled by the compose page, not checked here)
  const readiness = useMemo(
    () =>
      currentScript
        ? checkPublishReadiness(currentScript.shots as Shot[], currentScript.totalDuration, {
            locale,
            // commerce hard rule "product visible in the first 3s" — only for product videos (topic videos have no productName)
            productName: projectMeta?.productName || undefined,
          })
        : null,
    [currentScript, locale, projectMeta?.productName]
  );

  // template-related state
  const { addTemplate } = useTemplateStore();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  // regeneration deletes and rebuilds from scratch (the route deletes old scripts first) and is irreversible — show a confirmation dialog when scripts already exist to prevent accidental loss
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [savedTip, setSavedTip] = useState(false);

  /** click the "save as template" button */
  const handleSaveAsTemplate = () => {
    setTemplateName("");
    setShowSaveDialog(true);
  };

  /** confirm and save the template */
  const doSaveTemplate = () => {
    if (!templateName.trim() || !currentScript) return;
    addTemplate({
      id: crypto.randomUUID(),
      name: templateName.trim(),
      styleType: currentScript.styleType,
      shots: currentScript.shots as Shot[],
      totalDuration: currentScript.totalDuration,
      useCount: 0,
      createdAt: new Date(),
    });
    setShowSaveDialog(false);
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 3000);
  };

  // ---- selection persistence: switching the active variant must be written to the DB, otherwise
  // downstream steps (assets/video/export) read `selected` from the DB and use a different script ----
  const [selectionTip, setSelectionTip] = useState(false);
  const persistSelection = async (index: number) => {
    setSelectedScript(index);
    const target = scripts[index];
    if (!target) return;
    try {
      await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedScriptId: target.id }),
      });
      setSelectionTip(true);
      setTimeout(() => setSelectionTip(false), 1500);
    } catch {
      /* selection is best-effort; the UI already reflects the choice locally */
    }
  };

  // ---- per-shot inline editing: only voiceover/description text (structure/timing untouched) ----
  const [editingShotId, setEditingShotId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ voiceover: string; description: string }>({ voiceover: "", description: "" });
  const [editStatus, setEditStatus] = useState<"" | "saving" | "saved" | "failed">("");
  const startEditShot = (shot: Shot) => {
    setEditingShotId(shot.shotId);
    setEditDraft({ voiceover: shot.voiceover ?? "", description: shot.description ?? "" });
    setEditStatus("");
  };
  const cancelEditShot = () => {
    setEditingShotId(null);
    setEditStatus("");
  };
  // ---- one-click auto-finish: script → auto-fill footage → compose → export, all keyless.
  // Mirrors the batch page's autoCompose so the single-project web flow isn't the only path that
  // can't run end-to-end automatically. Compose is polled by the exact compositionId (precise, race-free). ----
  const [autoFinishing, setAutoFinishing] = useState(false);
  const [autoFinishStage, setAutoFinishStage] = useState("");
  const [autoFinishError, setAutoFinishError] = useState("");
  const autoFinish = async () => {
    if (!currentScript || autoFinishing) return;
    setAutoFinishing(true);
    setAutoFinishError("");
    try {
      // 0) make sure the picked variant is the one the pipeline uses
      setAutoFinishStage(t("autoFinishSelecting"));
      await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedScriptId: currentScript.id }),
      }).catch(() => {});
      // 1) auto-match free footage (per-shot video, fall back to image) — non-fatal
      setAutoFinishStage(t("autoFinishAssets"));
      await fetch(`/api/project/${id}/stock-fill`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // llmConfig opt-in: semantic rerank picks the best-matching footage per shot (heuristic fallback inside the route)
        body: JSON.stringify({
          source: "all", mediaType: "auto",
          ...(llm.baseUrl && llm.model ? { llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model } } : {}),
        }),
      }).catch(() => {});
      // 2) compose (free Edge TTS)
      setAutoFinishStage(t("autoFinishComposing"));
      const composeRes = await fetch(`/api/project/${id}/compose`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeTts: { enabled: true } }),
      });
      if (!composeRes.ok) throw new Error(t("autoFinishFailed"));
      const composeData = await composeRes.json().catch(() => ({}));
      const compositionId: string | undefined = composeData?.compositionId;
      const query = compositionId ? `?compositionId=${encodeURIComponent(compositionId)}` : "";
      // 3) poll until done/failed (up to ~11 min, > server render timeout)
      let done = false;
      for (let i = 0; i < 264; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const c = await fetch(`/api/project/${id}/compose${query}`).then((x) => x.json()).catch(() => ({}));
        const st = c?.composition?.status;
        if (st === "done") { done = true; break; }
        if (st === "failed") throw new Error(c?.composition?.errorMessage || t("autoFinishFailed"));
      }
      if (!done) throw new Error(t("autoFinishFailed"));
      // 4) land on export
      router.push(`/project/${id}/export`);
    } catch (err) {
      setAutoFinishError(friendlyError(err, locale));
      setAutoFinishing(false);
    }
  };

  const saveEditShot = async (shotId: number) => {
    if (!currentScript) return;
    setEditStatus("saving");
    // optimistic local update so the timeline reflects the edit immediately
    setScripts((prev) =>
      prev.map((s) =>
        s.id === currentScript.id
          ? { ...s, shots: s.shots.map((sh) => (sh.shotId === shotId ? { ...sh, voiceover: editDraft.voiceover.trim(), description: editDraft.description.trim() } : sh)) }
          : s
      )
    );
    try {
      const res = await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: currentScript.id, shotTexts: [{ shotId, voiceover: editDraft.voiceover, description: editDraft.description }] }),
      });
      if (!res.ok) throw new Error("save failed");
      setEditStatus("saved");
      setEditingShotId(null);
      setTimeout(() => setEditStatus(""), 1500);
    } catch {
      setEditStatus("failed");
    }
  };

  // top navigation bar (shared by loading, empty and normal states)
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
          <span className="text-sm text-muted-foreground truncate max-w-[40vw] sm:max-w-xs">{projectName || t("defaultProjectName")}</span>
        </div>
        {/* step progress: clickable pills (mobile shows a compact badge inside the component) */}
        <div className="flex items-center gap-1">
          <ProjectStepper />
          <LanguageToggle />
        </div>
      </div>
    </header>
  );

  // loading: skeleton screen (mimics the script card layout; feels faster than a spinner and reduces perceived wait)
  if (loading) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-4" aria-busy="true" aria-label={t("loadingScripts")}>
          {[0, 1, 2].map((i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-40 rounded bg-muted/60" />
                  <div className="h-4 w-16 rounded bg-muted/40" />
                </div>
                <div className="h-2 w-full rounded bg-muted/40" />
                <div className="flex gap-2">
                  <div className="h-6 w-20 rounded bg-muted/40" />
                  <div className="h-6 w-20 rounded bg-muted/40" />
                  <div className="h-6 w-24 rounded bg-muted/30" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // empty state: this project has no real scripts yet (fixes #3: no longer shows the Debao demo; provides a recoverable "generate script" entry point)
  if (scripts.length === 0) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="mx-auto max-w-md flex flex-col items-center justify-center py-28 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 mb-5">
            <LuWand className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-2">{t("emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t("emptyDesc", { name: projectName || t("emptyDescThisProject") })}
          </p>
          {genError && (
            <div className="mb-4 flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">{genError}</p>
              {/* most generation errors are LLM-config related — offer a direct jump to Settings */}
              <Link href="/settings" className="text-xs text-primary underline underline-offset-2 hover:text-primary/80">
                {t("goToSettings")}
              </Link>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={isGenerating} className="brand-gradient text-white">
              {isGenerating ? (
                <>
                  <LuLoaderCircle className="w-4 h-4 mr-2 animate-spin" />
                  {tc("generating")}
                </>
              ) : (
                <>
                  <LuWand className="w-4 h-4 mr-2" />
                  {t("generateScript")}
                </>
              )}
            </Button>
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
      {headerBar}

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* left panel: script option selection */}
          <div className="lg:col-span-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">{t("scriptOptions")}</h2>
              <div className="flex items-center gap-2">
                {selectionTip && (
                  <span className="text-xs text-green-400 animate-in fade-in">{t("selectionSaved")}</span>
                )}
                {savedTip && (
                  <span className="text-xs text-green-400 animate-in fade-in">{t("savedAsTemplate")}</span>
                )}
                <Button variant="outline" size="sm" className="text-xs" onClick={handleSaveAsTemplate}>
                  <LuBookmarkPlus className="w-3.5 h-3.5 mr-1" />
                  {t("saveAsTemplate")}
                </Button>
                <Button variant="outline" size="sm" disabled={isGenerating} className="text-xs" onClick={() => setRegenConfirmOpen(true)}>
                  <LuWand className="w-3.5 h-3.5 mr-1" />
                  {t("regenerate")}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {scripts.map((script, index) => (
                <Card
                  key={script.id}
                  className={`cursor-pointer transition-all ${selectedScript === index ? "ring-2 ring-primary neon-glow" : "glass-card card-hover"}`}
                  onClick={() => persistSelection(index)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-sm">{script.title}</h3>
                      <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                        {styleLabelKeys[script.styleType] ? t(styleLabelKeys[script.styleType]) : script.styleType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{t("shotCount", { n: script.shots.length })}</span>
                      <span>{script.totalDuration}s</span>
                    </div>
                    {/* shot type preview bar */}
                    <div className="mt-3 flex gap-0.5 h-1.5 rounded-full overflow-hidden">
                      {script.shots.map((shot) => {
                        const colors: Record<string, string> = {
                          hook: "bg-red-500", pain_point: "bg-orange-500",
                          product_reveal: "bg-blue-500", demo: "bg-green-500",
                          social_proof: "bg-purple-500", cta: "bg-amber-500",
                        };
                        return (
                          <div
                            key={shot.shotId}
                            className={`${colors[shot.type]} opacity-70`}
                            style={{ flex: shot.duration }}
                          />
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* right panel: shot detail editing */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="timeline" className="w-full">
              <div className="flex items-center justify-between mb-4">
                <TabsList>
                  <TabsTrigger value="timeline">{t("tabTimeline")}</TabsTrigger>
                  <TabsTrigger value="text">{t("tabText")}</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="text-sm"
                    disabled={autoFinishing}
                    onClick={autoFinish}
                    title={t("autoFinishHint")}
                  >
                    {autoFinishing ? (
                      <>
                        <LuLoaderCircle className="w-4 h-4 mr-1 animate-spin" />
                        {autoFinishStage || t("autoFinish")}
                      </>
                    ) : (
                      <>
                        <LuWand className="w-4 h-4 mr-1" />
                        {t("autoFinish")}
                      </>
                    )}
                  </Button>
                  <Link href={`/project/${id}/assets`}>
                    <Button className="brand-gradient text-white text-sm" disabled={autoFinishing}>
                      {t("nextStepAssets")}
                      <LuArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>

              {autoFinishError && (
                <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-xs text-red-400">
                  {autoFinishError}
                </div>
              )}
              {/* regenerate errors (e.g. missing LLM key) used to fail silently in this view —
                  render them here with a direct jump to Settings */}
              {genError && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-xs text-red-400">
                  <span>{genError}</span>
                  <Link href="/settings" className="shrink-0 text-primary underline underline-offset-2 hover:text-primary/80">
                    {t("goToSettings")}
                  </Link>
                </div>
              )}
              <TabsContent value="timeline" className="mt-0">
                <div className="space-y-3">
                  {readiness && (
                    <Card
                      className={
                        readiness.overall === "ready"
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : readiness.overall === "needsWork"
                          ? "border-red-500/40 bg-red-500/5"
                          : "border-amber-500/40 bg-amber-500/5"
                      }
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2.5">
                          <span className="text-sm font-semibold">{t("readinessTitle")}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              readiness.overall === "ready"
                                ? "bg-emerald-500/15 text-emerald-500"
                                : readiness.overall === "needsWork"
                                ? "bg-red-500/15 text-red-500"
                                : "bg-amber-500/15 text-amber-500"
                            }`}
                          >
                            {t(
                              readiness.overall === "ready"
                                ? "readinessReady"
                                : readiness.overall === "needsWork"
                                ? "readinessNeedsWork"
                                : "readinessRisky"
                            )}
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {readiness.items.map((it) => (
                            <li key={it.key} className="flex items-start gap-2 text-xs">
                              {it.status === "pass" ? (
                                <LuCircleCheck className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                              ) : it.status === "fail" ? (
                                <LuCircleX className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                              ) : (
                                <LuTriangleAlert className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                              )}
                              <span
                                className={
                                  it.status === "pass"
                                    ? "text-muted-foreground"
                                    : it.status === "fail"
                                    ? "text-red-400"
                                    : "text-amber-400"
                                }
                              >
                                {it.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  {adViolations.length > 0 && (
                    <Card className="border-amber-500/40 bg-amber-500/5">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <LuTriangleAlert className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-semibold">{t("adComplianceTitle", { n: adViolations.length })}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2.5">{t("adComplianceHint")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {adViolations.map((v) => (
                            <span
                              key={v.term}
                              title={v.suggestion}
                              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs cursor-help"
                            >
                              「{v.term}」· {v.category}
                            </span>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {currentScript?.shots.map((shot, index) => {
                    const typeInfo = shotTypeLabels[shot.type];
                    return (
                      <Card key={shot.shotId} className="glass-card overflow-hidden">
                        <CardContent className="p-0">
                          <div className="flex">
                            {/* left-side index and type */}
                            <div className="flex flex-col items-center justify-center w-16 py-4 border-r border-border/50 shrink-0">
                              <span className="text-lg font-bold text-muted-foreground/50">{String(index + 1).padStart(2, "0")}</span>
                              <Badge className={`${typeInfo.color} border-0 text-[10px] mt-1`}>{t(typeInfo.labelKey)}</Badge>
                              <span className="text-[10px] text-muted-foreground mt-1">{shot.duration}s</span>
                            </div>
                            {/* right-side content */}
                            <div className="flex-1 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <p className="text-sm leading-relaxed mb-2">{shot.description}</p>
                                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <LuClock className="w-3 h-3" />
                                      {shot.camera}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      {shot.visualSource === "product_image" ? t("visualProductImage") : shot.visualSource === "ai_generate" ? t("visualAiGenerate") : t("visualUserUpload")}
                                    </span>
                                    {editingShotId !== shot.shotId && (
                                      <button
                                        type="button"
                                        className="flex items-center gap-1 text-primary hover:underline"
                                        onClick={() => startEditShot(shot)}
                                      >
                                        <LuPencil className="w-3 h-3" />
                                        {t("editShot")}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {/* visual preview: product image shots show the uploaded product photo immediately so users see a visual right away; AI shots have no image yet at this stage */}
                                <div className="w-20 h-14 bg-muted/30 rounded-md shrink-0 overflow-hidden flex items-center justify-center border border-border/30 relative">
                                  {shot.visualSource === "product_image" && projectMeta?.productImages?.[0] ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={projectMeta.productImages[0]}
                                      alt=""
                                      className="absolute inset-0 w-full h-full object-cover"
                                    />
                                  ) : shot.visualSource === "product_image" ? (
                                    <span className="text-[10px] text-muted-foreground">{t("productImageShort")}</span>
                                  ) : (
                                    <LuImage className="w-4 h-4 text-muted-foreground/40" />
                                  )}
                                </div>
                              </div>
                              {/* voiceover copy — inline editable */}
                              {editingShotId === shot.shotId ? (
                                <div className="mt-3 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
                                  <div>
                                    <label className="text-[10px] text-muted-foreground">{t("editVoiceoverLabel")}</label>
                                    <Textarea
                                      className="mt-1 min-h-[64px] bg-background/50 text-xs leading-relaxed"
                                      value={editDraft.voiceover}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, voiceover: e.target.value }))}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-muted-foreground">{t("editDescriptionLabel")}</label>
                                    <Textarea
                                      className="mt-1 min-h-[48px] bg-background/50 text-xs leading-relaxed"
                                      value={editDraft.description}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                                    />
                                  </div>
                                  <div className="flex items-center justify-end gap-2">
                                    {editStatus === "failed" && <span className="text-[10px] text-red-400 mr-auto">{t("editSaveFailed")}</span>}
                                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={cancelEditShot}>{tc("cancel")}</Button>
                                    <Button size="sm" className="h-7 text-xs brand-gradient text-white" disabled={editStatus === "saving"} onClick={() => saveEditShot(shot.shotId)}>{tc("save")}</Button>
                                  </div>
                                </div>
                              ) : (
                                shot.voiceover && (
                                  <div className="mt-3 p-2.5 bg-muted/30 rounded-md">
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                      🎙 {shot.voiceover}
                                    </p>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="text" className="mt-0">
                <Card className="glass-card">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-medium text-sm mb-2">{t("fullVoiceover")}</h3>
                    {/* read-only preview: per-shot editing happens in the timeline tab (avoids the old
                        silent-discard where typing here was never saved) */}
                    <Textarea
                      readOnly
                      className="min-h-[300px] bg-background/50 text-sm leading-relaxed cursor-default"
                      value={currentScript?.shots.map((s) => s.voiceover).filter(Boolean).join("\n\n") ?? ""}
                    />
                    <p className="text-[11px] text-muted-foreground">{t("textReadOnlyHint")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("statsChars", { n: currentScript?.shots.reduce((sum, s) => sum + (s.voiceover?.length || 0), 0) ?? 0 })} ·
                      {t("statsDuration", { n: currentScript?.totalDuration ?? 0 })} ·
                      {t("statsSpeed", { n: Math.round((currentScript?.shots.reduce((sum, s) => sum + (s.voiceover?.length || 0), 0) || 0) / (currentScript?.totalDuration || 1) * 10) / 10 })}
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      {/* save template dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="glass-card w-full max-w-md mx-4">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-base font-semibold">{t("saveTemplateTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("saveTemplateDesc")}</p>
              <Input
                placeholder={t("templateNamePlaceholder")}
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(false)}>{tc("cancel")}</Button>
                <Button size="sm" className="brand-gradient text-white" onClick={doSaveTemplate} disabled={!templateName.trim()}>{tc("save")}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* regeneration confirmation dialog: deleting old scripts is irreversible, guard against accidental clicks */}
      {regenConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="glass-card w-full max-w-md mx-4">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <LuTriangleAlert className="w-4 h-4 text-amber-400 shrink-0" />
                {t("regenConfirmTitle")}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{t("regenConfirmDesc")}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setRegenConfirmOpen(false)}>{t("regenConfirmCancel")}</Button>
                <Button
                  size="sm"
                  className="brand-gradient text-white"
                  onClick={() => {
                    setRegenConfirmOpen(false);
                    handleGenerate();
                  }}
                >
                  {t("regenConfirmOk")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
