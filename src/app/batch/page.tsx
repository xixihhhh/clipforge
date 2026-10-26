"use client";

import { randomUUID } from "@/lib/uuid";
import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import {
  LuCheck,
  LuLoader,
  LuPackage,
  LuZap,
  LuBox,
  LuLayoutGrid,
  LuEye,
  LuVideo,
} from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useProductLibraryStore } from "@/lib/stores/product-library-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { getExampleProducts } from "@/lib/examples";
import { buildVariationPlan, describeSlot } from "@/lib/variation-plan";
import { useT, useLocale } from "@/lib/i18n";

// Video mode options (labelKey refers to a batch-namespace i18n key; resolved at render time)
const videoModeOptions = [
  { value: "product_closeup", labelKey: "modeProductCloseup", icon: LuBox },
  { value: "graphic_montage", labelKey: "modeGraphicMontage", icon: LuLayoutGrid },
  { value: "scene_demo", labelKey: "modeSceneDemo", icon: LuEye },
  { value: "live_presenter", labelKey: "modeLivePresenter", icon: LuVideo },
];

// Script style options (labelKey refers to a batch-namespace i18n key; resolved at render time)
const scriptStyleOptions = [
  { value: "pain-point", labelKey: "stylePainPoint" },
  { value: "scenario", labelKey: "styleScenario" },
  { value: "comparison", labelKey: "styleComparison" },
  { value: "story", labelKey: "styleStory" },
  { value: "drama", labelKey: "styleDrama" },
  { value: "reversal", labelKey: "styleReversal" },
  { value: "interview", labelKey: "styleInterview" },
  { value: "unboxing", labelKey: "styleUnboxing" },
  { value: "product_pov", labelKey: "styleProductPov" },
  { value: "talking_head", labelKey: "styleTalkingHead" },
  { value: "auto", labelKey: "styleAuto" },
];

// Target duration options
const durationOptions = [
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

// Category → batch-namespace i18n key (resolved at render time)
const categoryLabelKeys: Record<string, string> = {
  home: "categoryHome",
  tech: "categoryTech",
  beauty: "categoryBeauty",
  food: "categoryFood",
  fashion: "categoryFashion",
  other: "categoryOther",
};

// Script style value → normalized backend styleType
const styleTypeMap: Record<string, string> = {
  "pain-point": "pain_point",
  scenario: "scene",
  comparison: "comparison",
  story: "story",
  drama: "drama",
  reversal: "reversal",
  interview: "interview",
  unboxing: "unboxing",
  product_pov: "product_pov",
  talking_head: "talking_head",
  auto: "auto",
};

// Backend styleType → short display name (for variation-slot summaries; kept local to avoid pulling the prompt engine into the client bundle)
const styleDisplayNames: Record<string, string> = {
  pain_point: "痛点式",
  scene: "场景种草",
  comparison: "对比实测",
  story: "剧情带货",
};

// Batch task status (generating=writing script; composing=matching visuals+compositing; done=all finished)
type TaskStatus = "pending" | "generating" | "composing" | "done" | "failed";

interface BatchTask {
  id: string;
  productName: string;
  status: TaskStatus;
  projectId?: string; // project ID after successful generation, used for navigation
  error?: string;
  /** anti-homogenization slot summary (hook/style/voice/BGM/captions) shown under the task */
  variation?: string;
}

// Task status → batch-namespace i18n key (resolved at render time)
const statusLabelKeys: Record<TaskStatus, string> = {
  pending: "taskPending",
  generating: "taskGenerating",
  composing: "taskComposing",
  done: "taskDone",
  failed: "taskFailed",
};

// Task status badge colors
const statusColors: Record<TaskStatus, string> = {
  pending: "bg-zinc-500/20 text-zinc-400 border-0",
  generating: "bg-amber-500/20 text-amber-400 border-0",
  composing: "bg-violet-500/20 text-violet-300 border-0",
  done: "bg-emerald-500/20 text-emerald-400 border-0",
  failed: "bg-red-500/20 text-red-400 border-0",
};

export default function BatchPage() {
  const t = useT("batch");
  const locale = useLocale();
  // Real product library + LLM config
  const { products, incrementVideoCount, addProduct } = useProductLibraryStore();
  const { llm } = useSettingsStore();

  // One-click import of example products
  const importExamples = useCallback(() => {
    const existing = new Set(products.map((p) => p.name));
    getExampleProducts(locale).forEach((ex) => {
      if (existing.has(ex.name)) return;
      addProduct({
        id: randomUUID(),
        name: ex.name,
        category: ex.category,
        description: ex.sellingPoints,
        images: [ex.image],
        price: ex.price,
        targetAudience: "",
        videoCount: 0,
        createdAt: new Date(),
      });
    });
  }, [products, addProduct, locale]);
  // Avoid SSR/hydration mismatch: render the list only after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Product selection state
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  // Configuration state
  const [videoMode, setVideoMode] = useState("product_closeup");
  const [scriptStyle, setScriptStyle] = useState("auto");
  const [duration, setDuration] = useState("30");
  // Whether to auto-compose visuals + render after script generation (free path, no API key needed) — upgrades batch from "script only" to "one-click full video"
  const [autoCompose, setAutoCompose] = useState(true);
  const [productCard, setProductCard] = useState(true); // batch mode defaults to overlaying a product-card sticker (shown only when a product image is available)
  // anti-homogenization: rotate hook/style/voice/BGM/captions per item so the batch doesn't ship N same-template videos (platforms suppress that account-wide)
  const [antiHomogeneity, setAntiHomogeneity] = useState(true);
  // post-batch template self-check (structure fingerprints across recent projects)
  const [homogeneity, setHomogeneity] = useState<{ verdict: string; message: { zh: string; en: string } } | null>(null);
  // Batch generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  // Used to abort the generation pipeline
  const abortRef = useRef(false);

  // Toggle product selection
  const toggleProduct = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  // Missing config error message
  const [configError, setConfigError] = useState("");

  // ---- batch persistence (batch_jobs / batch_job_items): every stage transition is written
  // through /api/batch, so progress and produced project/composition links survive a refresh.
  // An unfinished job found on reload offers "continue (skip the N finished items)" below. ----
  interface BatchJobItemRow {
    id: string;
    productId: string;
    productName: string;
    variation: string | null;
    projectId: string | null;
    compositionId: string | null;
    status: TaskStatus;
    error: string | null;
  }
  interface ResumableJob {
    job: { id: string; total: number; config: Record<string, unknown> | null };
    items: BatchJobItemRow[];
  }
  const [resumableJob, setResumableJob] = useState<ResumableJob | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetch("/api/batch?active=1").then((r) => r.json());
        // a "running" job on a freshly loaded page means the previous executor died with it
        if (!cancelled && d?.job && Array.isArray(d.items)) setResumableJob(d as ResumableJob);
      } catch {
        /* resume is opportunistic */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Per-run execution context: settings + persistence handles, explicit so a resumed
   *  run replays the ORIGINAL job's config instead of whatever the form currently shows. */
  interface BatchCtx {
    videoMode: string;
    scriptStyle: string;
    duration: string;
    autoCompose: boolean;
    productCard: boolean;
    jobId?: string;
    itemIdByProduct: Map<string, string>;
  }

  /** best-effort item write-through; never blocks or fails the run */
  const reportItem = (ctx: BatchCtx, productId: string, patch: Record<string, unknown>) => {
    const itemId = ctx.itemIdByProduct.get(productId);
    if (!itemId) return;
    void fetch("/api/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, patch }),
    }).catch(() => {});
  };

  /** Poll one composition to a terminal status (~3.75 min budget). */
  const pollCompose = async (projectId: string, compositionId?: string): Promise<boolean> => {
    const query = compositionId ? `?compositionId=${encodeURIComponent(compositionId)}` : "";
    for (let i = 0; i < 90 && !abortRef.current; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const c = await fetch(`/api/project/${projectId}/compose${query}`).then((x) => x.json()).catch(() => ({}));
      const st = c?.composition?.status;
      if (st === "done") return true;
      if (st === "failed") throw new Error(t("errorComposeFailed"));
    }
    return abortRef.current; // an abort mid-poll is not a failure
  };

  /** Visual-fill + free-TTS render on an existing project (the compose sub-chain). */
  const composeSubChain = async (
    ctx: BatchCtx,
    product: (typeof products)[number],
    projectId: string,
    slot?: ReturnType<typeof buildVariationPlan>[number]
  ) => {
    await fetch(`/api/project/${projectId}/stock-fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "all", mediaType: "auto" }),
    }).catch(() => {}); // visual-fill failure is non-fatal (product images/assets may already exist)
    const composeRes = await fetch(`/api/project/${projectId}/compose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        freeTts: { enabled: true, ...(slot?.voice ? { voice: slot.voice } : {}) },
        ...(ctx.productCard && { productCard: true }),
        // variation slot: BGM mood / karaoke captions rotate per item (undefined without the plan)
        ...(slot?.bgm ? { freeBgm: true, ...(slot.bgmMood ? { bgmMood: slot.bgmMood } : {}) } : {}),
        ...(slot?.karaoke ? { karaoke: true } : {}),
      }),
    });
    if (!composeRes.ok) throw new Error(t("errorComposeFailed"));
    const composeData = await composeRes.json().catch(() => ({}));
    if (composeData?.compositionId) reportItem(ctx, product.id, { compositionId: composeData.compositionId });
    const composed = await pollCompose(projectId, composeData?.compositionId);
    if (!composed && !abortRef.current) throw new Error(t("errorComposeFailed"));
  };

  // Process a single product (updates by task.id, supports out-of-order concurrency);
  // slot = this item's anti-homogenization assignment; resume = the persisted item row,
  // letting a half-finished item continue from its recorded stage instead of scratch
  const processOne = async (
    product: (typeof products)[number],
    slot: ReturnType<typeof buildVariationPlan>[number] | undefined,
    ctx: BatchCtx,
    resume?: BatchJobItemRow
  ) => {
    setBatchTasks((prev) => prev.map((t) => (t.id === product.id ? { ...t, status: "generating", error: undefined } : t)));
    reportItem(ctx, product.id, { status: "generating" });
    try {
      // resume shortcut: a composition was already submitted — check it before re-rendering
      if (resume?.projectId && resume.compositionId) {
        setBatchTasks((prev) => prev.map((tk) => (tk.id === product.id ? { ...tk, status: "composing", projectId: resume.projectId ?? undefined } : tk)));
        try {
          const c = await fetch(`/api/project/${resume.projectId}/compose?compositionId=${encodeURIComponent(resume.compositionId)}`)
            .then((x) => x.json()).catch(() => ({}));
          if (c?.composition?.status === "done") {
            incrementVideoCount(product.id);
            reportItem(ctx, product.id, { status: "done" });
            setBatchTasks((prev) => prev.map((tk) => (tk.id === product.id ? { ...tk, status: "done", projectId: resume.projectId ?? undefined } : tk)));
            return;
          }
        } catch { /* fall through to a fresh render */ }
        reportItem(ctx, product.id, { status: "composing" });
        await composeSubChain(ctx, product, resume.projectId, slot);
        incrementVideoCount(product.id);
        reportItem(ctx, product.id, { status: "done" });
        setBatchTasks((prev) => prev.map((tk) => (tk.id === product.id ? { ...tk, status: "done", projectId: resume.projectId ?? undefined } : tk)));
        return;
      }

      // 1) Create project (a resumed item that already has one reuses it)
      let projectId = resume?.projectId ?? undefined;
      if (!projectId) {
        const projRes = await fetch("/api/project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: t("projectNameSuffix", { name: product.name }),
            productName: product.name,
            productCategory: product.category,
            productDescription: product.description ?? "",
            productImages: product.images ?? [],
            videoMode: ctx.videoMode,
          }),
        });
        if (!projRes.ok) throw new Error(t("errorProjectCreate"));
        projectId = (await projRes.json()).id as string;
        reportItem(ctx, product.id, { projectId });
      }

      // 2) Generate script
      const scriptRes = await fetch("/api/llm/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          productName: product.name,
          category: product.category,
          productDescription: product.description ?? "",
          targetDuration: parseInt(ctx.duration) + (slot?.durationOffset ?? 0),
          styleType: slot?.styleType ?? styleTypeMap[ctx.scriptStyle] ?? "auto",
          ...(slot?.hookId ? { preferredHookId: slot.hookId } : {}),
          videoMode: ctx.videoMode,
          productImages: product.images ?? [],
          llmConfig: {
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            model: llm.model,
            visionModel: llm.visionModel,
          },
        }),
      });
      if (!scriptRes.ok) {
        const e = await scriptRes.json().catch(() => ({}));
        throw new Error(e.error || t("errorScriptFailed"));
      }
      const scriptData = await scriptRes.json().catch(() => ({}));

      // 3) Auto-render (free path): fill visuals (per-shot video preferred, fall back to image) → free Edge TTS → poll until video is done
      if (ctx.autoCompose && !abortRef.current) {
        setBatchTasks((prev) => prev.map((tk) => (tk.id === product.id ? { ...tk, status: "composing", projectId } : tk)));
        reportItem(ctx, product.id, { status: "composing" });
        // 2.5) judge pass on the selected (first) variant — the same quality bar as the
        // single-project hands-off chains; best-effort, a failed pass never fails the batch item
        const judgeScriptId = scriptData?.scripts?.[0]?.id;
        if (judgeScriptId) {
          try {
            const judgeRes = await fetch(`/api/project/${projectId}/script-judge`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scriptId: judgeScriptId, llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model } }),
            });
            const judgeData = await judgeRes.json().catch(() => ({}));
            // tier gate (judge v2): auto-apply invariant/default only; taste stays display-only.
            // The visual judge's description rewrites ride the same shotTexts PATCH.
            const gated = (rows: unknown): { shotId: number; voiceover?: string; description?: string }[] =>
              Array.isArray(rows) ? (rows as { shotId: number; voiceover?: string; description?: string; tier?: string }[]).filter((r) => r.tier !== "taste") : [];
            const shotTexts = new Map<number, { shotId: number; voiceover?: string; description?: string }>();
            for (const r of gated(judgeData?.rewrites)) shotTexts.set(r.shotId, { shotId: r.shotId, voiceover: r.voiceover });
            for (const r of gated(judgeData?.descriptionRewrites)) {
              shotTexts.set(r.shotId, { ...(shotTexts.get(r.shotId) ?? { shotId: r.shotId }), description: r.description });
            }
            if (judgeRes.ok && shotTexts.size > 0) {
              await fetch(`/api/project/${projectId}/scripts`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scriptId: judgeScriptId, shotTexts: Array.from(shotTexts.values()) }),
              }).catch(() => {});
            }
          } catch {
            /* quality pass is best-effort */
          }
        }
        await composeSubChain(ctx, product, projectId, slot);
      }

      incrementVideoCount(product.id);
      reportItem(ctx, product.id, { status: "done" });
      setBatchTasks((prev) => prev.map((tk) => (tk.id === product.id ? { ...tk, status: "done", projectId } : tk)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("errorGenerateFailed");
      reportItem(ctx, product.id, { status: "failed", error: msg });
      setBatchTasks((prev) =>
        prev.map((task) => (task.id === product.id ? { ...task, status: "failed", error: msg } : task))
      );
    }
  };

  /** Shared pool executor + job settlement, used by both fresh runs and resumes. */
  const executeBatch = async (
    workItems: Array<{ product: (typeof products)[number]; slot?: ReturnType<typeof buildVariationPlan>[number]; resume?: BatchJobItemRow }>,
    ctx: BatchCtx
  ) => {
    // Concurrency pool: run at most 3 tasks simultaneously to speed up batch rendering
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (!abortRef.current) {
        const idx = cursor++;
        if (idx >= workItems.length) break;
        await processOne(workItems[idx].product, workItems[idx].slot, ctx, workItems[idx].resume);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, workItems.length) }, worker));

    if (ctx.jobId) {
      void fetch("/api/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: ctx.jobId, status: abortRef.current ? "cancelled" : "done" }),
      }).catch(() => {});
    }
    if (!abortRef.current) {
      setIsComplete(true);
      // template self-check across the freshly generated projects (needs ≥2 to compare)
      if (workItems.length >= 2) {
        try {
          const r = await fetch(`/api/insights/homogeneity?limit=${Math.min(20, workItems.length)}`);
          const d = await r.json();
          if (r.ok && d?.message) setHomogeneity({ verdict: d.verdict, message: d.message });
        } catch {
          /* self-check is advisory — never block the batch result */
        }
      }
    }
    setIsGenerating(false);
  };

  // Start batch generation (real: create project + generate script per item, reusing the single-product flow)
  const handleStartBatch = useCallback(async () => {
    if (selectedProducts.size === 0 || isGenerating) return;
    if (!llm.apiKey) {
      setConfigError(t("errorNoLlm"));
      return;
    }
    setConfigError("");

    abortRef.current = false;
    setIsGenerating(true);
    setIsComplete(false);
    setResumableJob(null);

    const selected = products.filter((p) => selectedProducts.has(p.id));
    // variation plan: one slot per item; hook pool keys off the first product's category (patterns are
    // largely universal), a fresh seed each run so consecutive batches don't share the same rotation
    const plan = antiHomogeneity
      ? buildVariationPlan({
          count: selected.length,
          category: (selected[0]?.category ?? "other") as Parameters<typeof buildVariationPlan>[0]["category"],
          styleType: styleTypeMap[scriptStyle] ?? "auto",
          seed: Date.now() % 100000,
        })
      : [];
    setHomogeneity(null);
    const tasks: BatchTask[] = selected.map((p, i) => ({
      id: p.id,
      productName: p.name,
      status: "pending" as TaskStatus,
      ...(plan[i] ? { variation: describeSlot(plan[i], styleDisplayNames, locale === "en" ? "en" : "zh") } : {}),
    }));
    setBatchTasks(tasks);

    // persist the job up front — the run config (incl. the variation plan) rides along so a
    // resume replays identical settings and slots
    const ctx: BatchCtx = { videoMode, scriptStyle, duration, autoCompose, productCard, itemIdByProduct: new Map() };
    try {
      const jobRes = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { videoMode, scriptStyle, duration, autoCompose, productCard, antiHomogeneity, plan },
          items: selected.map((p, i) => ({ productId: p.id, productName: p.name, variation: tasks[i].variation ?? null })),
        }),
      });
      const jobData = await jobRes.json().catch(() => ({}));
      if (jobRes.ok && jobData?.jobId) {
        ctx.jobId = jobData.jobId;
        for (const row of jobData.items ?? []) ctx.itemIdByProduct.set(row.productId, row.id);
      }
    } catch {
      /* persistence is an upgrade, not a dependency — the run proceeds in-memory */
    }

    await executeBatch(selected.map((p, i) => ({ product: p, slot: plan[i] })), ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executeBatch/processOne are stable page-level handlers
  }, [selectedProducts, isGenerating, products, llm, videoMode, duration, scriptStyle, autoCompose, productCard, antiHomogeneity, locale, incrementVideoCount]);

  // Resume the interrupted job: finished items are kept as-is, everything else re-runs with the
  // job's ORIGINAL config/slots; items whose composition already exists just poll/finish it.
  const handleResumeBatch = async () => {
    if (!resumableJob || isGenerating) return;
    if (!llm.apiKey) {
      setConfigError(t("errorNoLlm"));
      return;
    }
    setConfigError("");
    const { job, items } = resumableJob;
    const cfg = (job.config ?? {}) as {
      videoMode?: string; scriptStyle?: string; duration?: string; autoCompose?: boolean;
      productCard?: boolean; plan?: ReturnType<typeof buildVariationPlan>;
    };
    abortRef.current = false;
    setIsGenerating(true);
    setIsComplete(false);
    setResumableJob(null);
    setHomogeneity(null);

    const ctx: BatchCtx = {
      videoMode: cfg.videoMode ?? videoMode,
      scriptStyle: cfg.scriptStyle ?? scriptStyle,
      duration: cfg.duration ?? duration,
      autoCompose: cfg.autoCompose ?? true,
      productCard: cfg.productCard ?? true,
      jobId: job.id,
      itemIdByProduct: new Map(items.map((i) => [i.productId, i.id])),
    };
    const plan = Array.isArray(cfg.plan) ? cfg.plan : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    const tasks: BatchTask[] = items.map((it) => ({
      id: it.productId,
      productName: it.productName,
      status: it.status === "done" ? "done" : "pending",
      ...(it.projectId ? { projectId: it.projectId } : {}),
      ...(it.variation ? { variation: it.variation } : {}),
    }));
    setBatchTasks(tasks);

    const work: Array<{ product: (typeof products)[number]; slot?: ReturnType<typeof buildVariationPlan>[number]; resume?: BatchJobItemRow }> = [];
    for (const [idx, it] of items.entries()) {
      if (it.status === "done") continue;
      const product = byId.get(it.productId);
      if (!product) {
        // the product left the library since the job started — surface, don't silently skip
        reportItem(ctx, it.productId, { status: "failed", error: t("resumeProductMissing") });
        setBatchTasks((prev) => prev.map((tk) => (tk.id === it.productId ? { ...tk, status: "failed", error: t("resumeProductMissing") } : tk)));
        continue;
      }
      work.push({ product, slot: plan[idx], resume: it });
    }
    await executeBatch(work, ctx);
  };

  /** Discard the interrupted job (persisted as cancelled) and start clean. */
  const handleDiscardResumable = () => {
    if (!resumableJob) return;
    void fetch("/api/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: resumableJob.job.id, status: "cancelled" }),
    }).catch(() => {});
    setResumableJob(null);
  };

  /** Abort a running batch: stop the pool and settle the job as cancelled. */
  const handleAbortBatch = () => {
    abortRef.current = true;
  };

  // Number of completed tasks
  const doneCount = batchTasks.filter((t) => t.status === "done").length;

  return (
    <div className="min-h-screen grid-bg">
      <main className="mx-auto max-w-2xl px-6 py-10">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="brand-gradient-text">{t("heroTitle")}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("heroSubtitle")}
          </p>
        </div>

        <div className="space-y-6">
          {/* interrupted-job choice: continue where it left off (default) or discard and start clean */}
          {resumableJob && !isGenerating && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <p className="text-sm font-medium text-amber-500">⏸ {t("resumeTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("resumeDesc", {
                  done: resumableJob.items.filter((i) => i.status === "done").length,
                  total: resumableJob.job.total,
                })}
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" className="brand-gradient text-white" onClick={handleResumeBatch}>
                  {t("resumeContinue")}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDiscardResumable}>
                  {t("resumeDiscard")}
                </Button>
              </div>
            </div>
          )}
          {/* Step 1: Select products */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <Label className="text-sm font-medium">
                  {t("step1Label")}
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <span className="text-xs text-muted-foreground">
                  {t("step1Selected", { selected: selectedProducts.size, total: products.length })}
                </span>
              </div>

              {!mounted ? null : products.length === 0 ? (
                /* Empty product library hint */
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
                    <LuPackage className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t("emptyHint")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="brand-gradient text-white" onClick={importExamples}>
                      {t("importExamples")}
                    </Button>
                    <Link href="/products">
                      <Button variant="outline" size="sm">
                        {t("goToProducts")}
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                /* Product list (multi-select) */
                <div className="space-y-2">
                  {products.map((product) => {
                    const isSelected = selectedProducts.has(product.id);
                    return (
                      <button
                        key={product.id}
                        onClick={() => !isGenerating && toggleProduct(product.id)}
                        disabled={isGenerating}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border/50 bg-muted/20 hover:border-primary/40"
                        } ${isGenerating ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        {/* Checkbox */}
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
                            isSelected
                              ? "brand-gradient border-transparent"
                              : "border-border/80 bg-muted/30"
                          }`}
                        >
                          {isSelected && <LuCheck className="w-3 h-3 text-white" />}
                        </div>
                        {/* Product image placeholder */}
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/30 border border-border/30">
                          <LuPackage className="w-5 h-5 text-muted-foreground" />
                        </div>
                        {/* Product info */}
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium block truncate">
                            {product.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {categoryLabelKeys[product.category] ? t(categoryLabelKeys[product.category]) : product.category}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Unified configuration */}
          <Card className="glass-card">
            <CardContent className="p-5 space-y-5">
              <Label className="text-sm font-medium block">{t("step2Label")}</Label>

              {/* Video mode */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2.5 block">{t("videoModeLabel")}</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {videoModeOptions.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => !isGenerating && setVideoMode(opt.value)}
                        disabled={isGenerating}
                        className={`relative flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center transition-all ${
                          videoMode === opt.value
                            ? "border-primary bg-primary/10"
                            : "border-border/50 bg-muted/20 hover:border-primary/40"
                        } ${isGenerating ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <Icon
                          className={`w-5 h-5 ${
                            videoMode === opt.value ? "text-primary" : "text-muted-foreground"
                          }`}
                        />
                        <span
                          className={`text-xs font-medium ${
                            videoMode === opt.value ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {t(opt.labelKey)}
                        </span>
                        {videoMode === opt.value && (
                          <div className="absolute top-1.5 right-1.5">
                            <div className="h-1.5 w-1.5 rounded-full brand-gradient" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* Honest expectation for "live presenter": this tool does not render digital humans — relies on user-provided footage or AI mid/long-shot figures */}
                {videoMode === "live_presenter" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-400/90">{t("livePresenterHint")}</p>
                )}
              </div>

              {/* Script style */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2.5 block">{t("scriptStyleLabel")}</Label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {scriptStyleOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => !isGenerating && setScriptStyle(opt.value)}
                      disabled={isGenerating}
                      className={`relative flex items-center justify-center h-9 rounded-lg border text-xs font-medium transition-all ${
                        scriptStyle === opt.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      } ${isGenerating ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {t(opt.labelKey)}
                      {scriptStyle === opt.value && (
                        <div className="absolute -top-px -right-px h-3 w-3 flex items-center justify-center">
                          <div className="h-1.5 w-1.5 rounded-full brand-gradient" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target duration */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2.5 block">{t("durationLabel")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {durationOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => !isGenerating && setDuration(opt.value)}
                      disabled={isGenerating}
                      className={`relative flex items-center justify-center h-9 rounded-lg border text-sm font-medium transition-all ${
                        duration === opt.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      } ${isGenerating ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {opt.label}
                      {duration === opt.value && (
                        <div className="absolute -top-px -right-px h-3 w-3 flex items-center justify-center">
                          <div className="h-1.5 w-1.5 rounded-full brand-gradient" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Batch task list (shown during generation) */}
          {batchTasks.length > 0 && (
            <Card className="glass-card">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <Label className="text-sm font-medium">{t("progressLabel")}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t("progressDone", { done: doneCount, total: batchTasks.length })}
                    </span>
                    {/* abort settles the job as cancelled — progress already persisted item by item */}
                    {isGenerating && (
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={handleAbortBatch}>
                        {t("abortBatch")}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full brand-gradient transition-all duration-500 rounded-full"
                    style={{
                      width: `${batchTasks.length > 0 ? (doneCount / batchTasks.length) * 100 : 0}%`,
                    }}
                  />
                </div>

                {/* Task list */}
                <div className="space-y-2">
                  {batchTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded bg-muted/30 flex items-center justify-center shrink-0">
                          <LuPackage className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm block truncate">{task.productName}</span>
                          {task.variation && (
                            <span className="text-[11px] text-muted-foreground block truncate">{task.variation}</span>
                          )}
                          {task.status === "failed" && task.error && (
                            <span className="text-xs text-red-400">{task.error}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {task.status === "done" && task.projectId && (
                          <Link href={`/project/${task.projectId}/${autoCompose ? "export" : "script"}`}>
                            <Button variant="outline" size="sm" className="text-xs h-7">{autoCompose ? t("taskViewVideo") : t("taskView")}</Button>
                          </Link>
                        )}
                        <Badge className={statusColors[task.status]}>
                          {task.status === "generating" && (
                            <LuLoader className="w-3 h-3 mr-1 animate-spin" />
                          )}
                          {task.status === "done" && (
                            <LuCheck className="w-3 h-3 mr-1" />
                          )}
                          {t(statusLabelKeys[task.status])}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Completion notice */}
                {isComplete && (
                  <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <p className="text-sm text-emerald-400 font-medium">
                      {t("completeMsg", { count: doneCount })}
                    </p>
                  </div>
                )}
                {/* template self-check verdict (structure fingerprints across the fresh batch) */}
                {isComplete && homogeneity && (
                  <div
                    className={`mt-2 p-3 rounded-lg border text-center text-sm ${
                      homogeneity.verdict === "ok"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : homogeneity.verdict === "warn"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                          : "bg-red-500/10 border-red-500/20 text-red-400"
                    }`}
                  >
                    {locale === "en" ? homogeneity.message.en : homogeneity.message.zh}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Bottom action bar */}
          <div className="pt-2 pb-10">
            {configError && (
              <p className="text-sm text-destructive text-center mb-3">
                {configError}
                <Link href="/settings?tab=llm" className="underline underline-offset-2 ml-1.5 hover:text-foreground">
                  {t("errorNoLlmCta")}
                </Link>
              </p>
            )}
            {/* Auto-render toggle: upgrades batch from "script only" to "one-click full video" (free path) */}
            <label className="flex items-center justify-center gap-2 mb-3 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCompose}
                onChange={(e) => setAutoCompose(e.target.checked)}
                disabled={isGenerating}
                className="w-4 h-4 accent-violet-500"
              />
              {t("autoComposeLabel")}
            </label>
            {autoCompose && (
              <label className="flex items-center justify-center gap-2 mb-3 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={productCard}
                  onChange={(e) => setProductCard(e.target.checked)}
                  disabled={isGenerating}
                  className="w-4 h-4 accent-violet-500"
                />
                {t("productCardLabel")}
              </label>
            )}
            {/* anti-homogenization rotation: each item gets a different hook/style/voice/BGM/caption mix */}
            <label className="flex items-center justify-center gap-2 mb-3 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={antiHomogeneity}
                onChange={(e) => setAntiHomogeneity(e.target.checked)}
                disabled={isGenerating}
                className="w-4 h-4 accent-violet-500"
              />
              {t("variationLabel")}
            </label>
            <Button
              onClick={handleStartBatch}
              disabled={selectedProducts.size === 0 || isGenerating}
              className="w-full h-12 brand-gradient text-white font-semibold text-base shadow-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <LuLoader className="w-5 h-5 mr-2 animate-spin" />
                  {t("ctaGenerating")}
                </>
              ) : isComplete ? (
                <>
                  <LuCheck className="w-5 h-5 mr-2" />
                  {t("ctaAgain")}
                </>
              ) : (
                <>
                  <LuZap className="w-5 h-5 mr-2" />
                  {t("ctaStart")}
                </>
              )}
            </Button>
            {!isGenerating && !isComplete && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                {selectedProducts.size > 0
                  ? t("hintWillGenerate", { count: selectedProducts.size })
                  : t("hintSelectAtLeastOne")}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
