"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { mergeCustomModels, buildVideoOptions } from "@/lib/gen-params";
import { referenceModelFor, buildReplicatePrompt, REPLICATE_MAX_REF_SEC, type ReplicateShot } from "@/lib/replicate-plan";
import { useT } from "@/lib/i18n";

/** storyboard card data */
interface StoryboardCard {
  id: number;
  title: string;
  description: string;
  duration: string;
}

/** product image data */
interface ProductImage {
  id: string;
  file: File;
  previewUrl: string;
}

/** real reference-video analysis result (from /api/replicate/analyze) */
interface RefAnalysis {
  path: string;
  duration: number;
  shots: ReplicateShot[];
  referenceStructure: string;
  modelTierEligible: boolean;
}

/** resolved provider target for the default video model (same pattern as the assets page) */
interface VideoModelTarget {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export default function ClonePage() {
  const t = useT("clone");
  const router = useRouter();
  const { llm, providers, defaultVideoModel, customModels, videoParams } = useSettingsStore();

  // video URL and analysis state
  const [videoUrl, setVideoUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [storyboards, setStoryboards] = useState<StoryboardCard[]>([]);
  // real reference-video analysis (rhythm skeleton + model-tier eligibility)
  const [refVideoFile, setRefVideoFile] = useState<File | null>(null);
  const [refAnalysis, setRefAnalysis] = useState<RefAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");
  const refVideoInputRef = useRef<HTMLInputElement>(null);

  // product information
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [productName, setProductName] = useState("");
  const [productFeatures, setProductFeatures] = useState("");

  // generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [genError, setGenError] = useState("");

  // model-tier one-shot replication state (Seedance reference-to-video)
  const [videoModelTarget, setVideoModelTarget] = useState<VideoModelTarget | null>(null);
  const [isReplicating, setIsReplicating] = useState(false);
  const [replicateError, setReplicateError] = useState("");
  const [replicateResult, setReplicateResult] = useState<{ url: string; projectId: string } | null>(null);

  // drag-and-drop upload state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // trend handoff from the landing-page trend radar (?trend=<word>); read from
  // location instead of useSearchParams so the page needs no Suspense boundary
  const [trendFrom, setTrendFrom] = useState<string | null>(null);
  useEffect(() => {
    const word = new URLSearchParams(window.location.search).get("trend")?.trim();
    if (word) setTrendFrom(word.slice(0, 60));
  }, []);

  // resolve the provider for the default video model (drives the model-tier replicate button)
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
        const merged = mergeCustomModels(data.models ?? [], customModels, "video", new Set(enabled.map((e) => e.name)));
        const model = merged.find((m) => m.id === defaultVideoModel);
        if (cancelled || !model) return;
        const prov = enabled.find((e) => e.name === model.provider);
        if (prov) setVideoModelTarget({ provider: prov.name, model: defaultVideoModel, apiKey: prov.apiKey, baseUrl: prov.baseUrl });
      } catch {
        // model-tier button simply stays disabled
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providers, defaultVideoModel, customModels]);

  /**
   * Analyze the reference. With an uploaded video file this is REAL analysis:
   * ffmpeg scene-cut detection returns the actual shot skeleton (count + durations),
   * which later drives rhythm-matched script generation. With only a URL (platform
   * pages can't be downloaded), it falls back to the generic high-conversion
   * structure reference — labeled as such in the UI.
   */
  const handleAnalyze = useCallback(async () => {
    if (!videoUrl.trim() && !refVideoFile) return;
    setIsAnalyzing(true);
    setStoryboards([]);
    setRefAnalysis(null);
    setAnalyzeError("");
    try {
      if (refVideoFile) {
        const fd = new FormData();
        fd.append("file", refVideoFile);
        const res = await fetch("/api/replicate/analyze", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t("analyzeFailed"));
        setRefAnalysis(data as RefAnalysis);
        setStoryboards(
          (data.shots as ReplicateShot[]).map((s) => ({
            id: s.index,
            title: t("realShotTitle", { n: s.index }),
            description: t("realShotDesc"),
            duration: `${s.duration}s`,
          }))
        );
        return;
      }
      // URL-only fallback: the generic structure reference (honest label in structureHint)
      await new Promise((resolve) => setTimeout(resolve, 600));
      setStoryboards([
        { id: 1, title: t("shot1Title"), description: t("shot1Desc"), duration: "0-3s" },
        { id: 2, title: t("shot2Title"), description: t("shot2Desc"), duration: "3-8s" },
        { id: 3, title: t("shot3Title"), description: t("shot3Desc"), duration: "8-15s" },
        { id: 4, title: t("shot4Title"), description: t("shot4Desc"), duration: "15-25s" },
        { id: 5, title: t("shot5Title"), description: t("shot5Desc"), duration: "25-35s" },
        { id: 6, title: t("shot6Title"), description: t("shot6Desc"), duration: "35-40s" },
      ]);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : t("analyzeFailed"));
    } finally {
      setIsAnalyzing(false);
    }
  }, [videoUrl, refVideoFile, t]);

  /** shared step: create the clone project + upload product images, return { projectId, paths } */
  const createCloneProject = useCallback(async (): Promise<{ projectId: string; paths: string[] }> => {
    const projRes = await fetch("/api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: t("projectNameSuffix", { name: productName }),
        productName,
        productDescription: productFeatures,
        productImages: [],
        sourceType: "clone",
        ...((refAnalysis?.path || videoUrl.trim()) && { sourceVideoUrl: refAnalysis?.path || videoUrl.trim() }),
      }),
    });
    if (!projRes.ok) throw new Error(t("errorProjectCreate"));
    const project = await projRes.json();

    const formData = new FormData();
    productImages.forEach((img) => formData.append("files", img.file));
    formData.append("projectId", project.id);
    const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
    if (!uploadRes.ok) {
      const e = await uploadRes.json().catch(() => ({}));
      throw new Error(e.error || t("errorCloneFailed"));
    }
    const { paths } = await uploadRes.json();
    const updated = await fetch(`/api/project/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productImages: paths }),
    });
    if (!updated.ok) throw new Error(t("errorCloneFailed"));
    return { projectId: project.id, paths };
  }, [productName, productFeatures, productImages, refAnalysis?.path, videoUrl, t]);

  /**
   * Model-tier one-shot replication (Seedance 2.0 reference-to-video): the analyzed
   * reference clip (≤15s) + product images go into ONE multimodal generation call;
   * the result is saved as a finished composition on the export page.
   */
  const handleModelReplicate = useCallback(async () => {
    if (isReplicating || !refAnalysis || !videoModelTarget) return;
    const refModel = referenceModelFor(videoModelTarget.model);
    if (!refModel) {
      setReplicateError(t("modelTierNeedSeedance"));
      return;
    }
    setIsReplicating(true);
    setReplicateError("");
    setReplicateResult(null);
    try {
      const inputKey = JSON.stringify([refVideoFile ? [refVideoFile.name, refVideoFile.size, refVideoFile.lastModified] : refAnalysis.path, productName, productFeatures, productImages.map(image => [image.file.name, image.file.size, image.file.lastModified])]);
      const previous = sessionStorage.getItem("clipforge-replicate-operation");
      const savedOperation = previous ? JSON.parse(previous) : null;
      const { projectId, paths } = savedOperation?.inputKey === inputKey ? savedOperation : await createCloneProject();
      sessionStorage.setItem("clipforge-replicate-operation", JSON.stringify({ inputKey, projectId, paths }));
      const videoOptions = buildVideoOptions(videoParams);
      videoOptions.duration = Math.min(15, Math.max(4, Math.round(refAnalysis.duration)));
      const res = await fetch("/api/ai/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: videoModelTarget.provider,
          model: refModel,
          apiKey: videoModelTarget.apiKey,
          baseUrl: videoModelTarget.baseUrl,
          purpose: "replicate",
          mode: "video-to-video",
          prompt: buildReplicatePrompt({ productName, sellingPoints: productFeatures, imageCount: paths.length }),
          referenceVideoUrls: [refAnalysis.path],
          referenceImageUrls: paths,
          projectId,
          options: { ...videoOptions, audioEnabled: true },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.terminal) sessionStorage.removeItem("clipforge-replicate-operation");
        throw new Error(data.error || t("modelTierFailed"));
      }
      if (!data.compositionId || !data.url) throw new Error(t("modelTierFailed"));
      setReplicateResult({ url: data.url, projectId });
    } catch (err) {
      setReplicateError(err instanceof Error ? err.message : t("modelTierFailed"));
    } finally {
      setIsReplicating(false);
    }
  }, [isReplicating, refAnalysis, videoModelTarget, videoParams, productName, productFeatures, productImages, refVideoFile, createCloneProject, t]);

  /**
   * Rhythm-tier clone: create the project + generate a script whose shot count and
   * per-shot durations follow the ANALYZED reference skeleton (referenceStructure).
   * Without a real analysis (URL-only), the script simply follows the generic
   * high-conversion structure. (The old dead `referenceUrl` field is gone — it was
   * never read by the script API.)
   */
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    if (!llm.apiKey) {
      setGenError(t("errorNoLlm"));
      return;
    }
    setGenError("");
    setIsGenerating(true);
    try {
      const { projectId, paths } = await createCloneProject();

      // rhythm skeleton: total duration follows the reference when analyzed (15-40s clamp)
      const targetDuration = refAnalysis
        ? Math.max(1, Math.round(refAnalysis.duration))
        : 40;
      const scriptRes = await fetch("/api/llm/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          productName,
          productDescription: productFeatures,
          targetDuration,
          styleType: "auto",
          videoMode: "product_closeup",
          productImages: paths,
          ...(refAnalysis?.referenceStructure && { referenceStructure: refAnalysis.referenceStructure }),
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
        throw new Error(e.error || t("errorScriptGen"));
      }

      router.push(`/project/${projectId}/script`);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t("errorCloneFailed"));
      setIsGenerating(false);
    }
  }, [isGenerating, llm, productName, productFeatures, refAnalysis, createCloneProject, router, t]);

  async function openCutEditor() {
    if (!refAnalysis || openingEditor) return;
    setOpeningEditor(true);
    setGenError("");
    try {
      const { projectId } = await createCloneProject();
      const res = await fetch(`/api/project/${projectId}/reference-cuts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: refAnalysis.path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errorCloneFailed"));
      router.push(`/project/${projectId}/assets`);
    } catch (error) {
      setGenError(error instanceof Error ? error.message : t("errorCloneFailed"));
      setOpeningEditor(false);
    }
  }

  /** handle file selection / upload */
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const remaining = 5 - productImages.length;
      if (remaining <= 0) return;

      const newImages: ProductImage[] = [];
      for (let i = 0; i < Math.min(files.length, remaining); i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) continue;
        newImages.push({
          id: `${Date.now()}-${i}`,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }
      setProductImages((prev) => [...prev, ...newImages]);
    },
    [productImages.length]
  );

  /** remove an uploaded image */
  const removeImage = useCallback((id: string) => {
    setProductImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  /** drag event handlers */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  /** whether analysis has been completed */
  const hasAnalysis = storyboards.length > 0;
  /** whether generation can be started */
  const canGenerate =
    hasAnalysis &&
    productImages.length > 0 &&
    productName.trim() !== "" &&
    productFeatures.trim() !== "";

  return (
    <div className="min-h-screen grid-bg">
      <main className="mx-auto max-w-4xl px-6 py-10">
        {/* page title */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            <span className="brand-gradient-text">{t("heroTitle")}</span>
          </h1>
          <p className="text-muted-foreground text-base max-w-lg mx-auto">
            {t("heroSubtitle")}
          </p>
        </div>

        {/* trend handoff banner: guide the user from "saw a trend" to "found a reference to remix" */}
        {trendFrom && (
          <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t("trendBannerTitle", { trend: trendFrom })}</div>
              <div className="text-xs text-muted-foreground mt-1">{t("trendBannerDesc")}</div>
            </div>
            <a
              className="shrink-0 rounded-lg brand-gradient px-4 py-2 text-sm font-semibold text-white"
              href={`https://www.douyin.com/search/${encodeURIComponent(trendFrom)}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("trendBannerSearch", { trend: trendFrom })}
            </a>
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setTrendFrom(null)}
            >
              {t("trendBannerDismiss")}
            </button>
          </div>
        )}

        {/* Step 1 - enter viral video URL */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full brand-gradient text-sm font-bold text-white">
              1
            </div>
            <h2 className="text-lg font-semibold">{t("step1Title")}</h2>
          </div>

          <Card className="glass-card card-hover">
            <CardContent className="p-6 space-y-5">
              {/* reference video file upload — the REAL analysis path (scene-cut skeleton) */}
              <div className="space-y-2">
                <Label>{t("refVideoLabel")}</Label>
                <input
                  ref={refVideoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    setRefVideoFile(f);
                    setRefAnalysis(null);
                    setStoryboards([]);
                  }}
                />
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={() => refVideoInputRef.current?.click()}
                  >
                    {refVideoFile ? t("refVideoReplace") : t("refVideoBtn")}
                  </Button>
                  <span className="text-xs text-muted-foreground truncate">
                    {refVideoFile ? t("refVideoSelected", { name: refVideoFile.name }) : t("refVideoHint")}
                  </span>
                </div>
                <p className="text-xs text-amber-600/90">{t("copyrightNote")}</p>
              </div>

              {/* video URL input (record-only fallback; platform pages can't be downloaded) */}
              <div className="space-y-2">
                <Label htmlFor="video-url">{t("videoUrlLabel")}</Label>
                <div className="flex gap-3">
                  <Input
                    id="video-url"
                    placeholder={t("videoUrlPlaceholder")}
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    className="brand-gradient text-white shrink-0"
                    disabled={(!videoUrl.trim() && !refVideoFile) || isAnalyzing}
                    onClick={handleAnalyze}
                  >
                    {isAnalyzing ? (
                      <span className="flex items-center gap-2">
                        {/* loading spinner */}
                        <svg
                          className="animate-spin h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        {t("analyzing")}
                      </span>
                    ) : (
                      t("analyze")
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("videoUrlHint")}
                </p>
              </div>
              {analyzeError && <p className="text-xs text-destructive">{analyzeError}</p>}

              {/* analysis results display area */}
              {hasAnalysis && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">
                      {refAnalysis ? t("realStructureTitle") : t("structureTitle")}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {t("storyboardCount", { n: storyboards.length })}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    {refAnalysis
                      ? t("realStructureHint", { sec: Math.round(refAnalysis.duration) })
                      : t("structureHint")}
                  </p>

                  {/* storyboard card list */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {storyboards.map((card) => (
                      <div
                        key={card.id}
                        className="rounded-lg border border-border/60 bg-background/40 p-4 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {card.title}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-xs font-mono"
                          >
                            {card.duration}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {card.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Step 2 - upload your product */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-5">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                hasAnalysis
                  ? "brand-gradient"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              2
            </div>
            <h2
              className={`text-lg font-semibold ${
                hasAnalysis ? "" : "text-muted-foreground"
              }`}
            >
              {t("step2Title")}
            </h2>
          </div>

          <Card
            className={`glass-card card-hover ${
              !hasAnalysis ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <CardContent className="p-6 space-y-6">
              {/* product image drag-and-drop upload */}
              <div className="space-y-2">
                <Label>
                  {t("productImageLabel")}{" "}
                  <span className="text-muted-foreground font-normal">
                    {t("productImageRange")}
                  </span>
                </Label>
                <div
                  className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-primary/50"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                  />

                  {productImages.length === 0 ? (
                    // empty state - upload prompt
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-muted-foreground"
                        >
                          <rect
                            x="3"
                            y="3"
                            width="18"
                            height="18"
                            rx="2"
                            ry="2"
                          />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">
                        {t("uploadHint")}
                      </p>
                      <p className="text-xs text-muted-foreground/70">
                        {t("uploadFormatHint")}
                      </p>
                    </div>
                  ) : (
                    // uploaded image preview
                    <div className="p-4">
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                        {productImages.map((img) => (
                          <div
                            key={img.id}
                            className="relative group aspect-square rounded-lg overflow-hidden bg-muted/30"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.previewUrl}
                              alt={t("productImageAlt")}
                              className="h-full w-full object-cover"
                            />
                            {/* delete button */}
                            <button
                              type="button"
                              className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeImage(img.id);
                              }}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        {/* add more button */}
                        {productImages.length < 5 && (
                          <div className="aspect-square rounded-lg border border-dashed border-border/60 flex items-center justify-center hover:border-primary/50 transition-colors">
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="text-muted-foreground"
                            >
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* product name */}
              <div className="space-y-2">
                <Label htmlFor="product-name">{t("productNameLabel")}</Label>
                <Input
                  id="product-name"
                  placeholder={t("productNamePlaceholder")}
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>

              {/* product selling points */}
              <div className="space-y-2">
                <Label htmlFor="product-features">{t("productFeaturesLabel")}</Label>
                <Textarea
                  id="product-features"
                  placeholder={t("productFeaturesPlaceholder")}
                  rows={4}
                  value={productFeatures}
                  onChange={(e) => setProductFeatures(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* model-tier one-shot replication (Seedance reference-to-video, ≤15s references) */}
        {refAnalysis && (
          <div className="mb-10">
            <Card className="glass-card">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">⚡ {t("modelTierTitle")}</h3>
                  {!refAnalysis.modelTierEligible && (
                    <Badge variant="outline" className="text-xs text-amber-600">
                      {t("modelTierTooLong", { max: REPLICATE_MAX_REF_SEC })}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t("modelTierDesc")}</p>
                {videoModelTarget && !referenceModelFor(videoModelTarget.model) && (
                  <p className="text-xs text-amber-600/90">{t("modelTierNeedSeedance")}</p>
                )}
                {!videoModelTarget && <p className="text-xs text-amber-600/90">{t("modelTierNeedModel")}</p>}
                {replicateError && <p className="text-xs text-destructive">{replicateError}</p>}
                {replicateResult ? (
                  <div className="space-y-2">
                    <video src={replicateResult.url} controls className="w-full max-w-xs rounded-lg border border-border/50" />
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-600">✓ {t("modelTierDone")}</span>
                      <Link href={`/project/${replicateResult.projectId}/export`} className="text-primary underline">
                        {t("modelTierViewExport")}
                      </Link>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs border-primary/50 text-primary hover:bg-primary/10"
                    disabled={
                      isReplicating ||
                      !refAnalysis.modelTierEligible ||
                      !videoModelTarget ||
                      !referenceModelFor(videoModelTarget.model) ||
                      productImages.length === 0 ||
                      !productName.trim()
                    }
                    onClick={handleModelReplicate}
                    title={
                      videoModelTarget
                        ? `${videoModelTarget.provider} · ${referenceModelFor(videoModelTarget.model) ?? videoModelTarget.model}`
                        : undefined
                    }
                  >
                    {isReplicating ? t("modelTierRunning") : t("modelTierBtn")}
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* bottom action buttons */}
        <div className="flex flex-col items-center pb-10 gap-3">
          {refAnalysis && (
            <Button size="lg" disabled={openingEditor || isGenerating || isReplicating || !productName.trim() || !productImages.length} onClick={openCutEditor}>
              {t("editOriginalCuts", { n: refAnalysis.shots.length })}
            </Button>
          )}
          {genError && (
            <p className="text-sm text-destructive">{genError}</p>
          )}
          <Button
            size="lg"
            className="brand-gradient text-white px-10 text-base font-semibold"
            disabled={!canGenerate || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t("cloning")}
              </>
            ) : (
              <>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-2"
                >
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                {t("startClone")}
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  );
}
