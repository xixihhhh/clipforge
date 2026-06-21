"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { LuArrowLeft, LuZap, LuCheck, LuCircleX, LuImage, LuArrowRight, LuLoaderCircle, LuTriangleAlert } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { mergeCustomModels, buildImageOptions, buildVideoOptions } from "@/lib/gen-params";
import type { Shot } from "@/lib/db/schema";
import { buildAssetRows, shouldOfferStockFill, needsImageModelWarning, type AssetItem } from "@/lib/assets-view";
import { useT } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";

// 镜头类型标签（label 改为 assets 命名空间的词条 key，按语言取）
const shotTypeLabels: Record<Shot["type"], { key: string; color: string }> = {
  hook: { key: "shotTypeHook", color: "bg-red-500/20 text-red-400" },
  pain_point: { key: "shotTypePainPoint", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { key: "shotTypeProductReveal", color: "bg-blue-500/20 text-blue-400" },
  demo: { key: "shotTypeDemo", color: "bg-green-500/20 text-green-400" },
  social_proof: { key: "shotTypeSocialProof", color: "bg-purple-500/20 text-purple-400" },
  cta: { key: "shotTypeCta", color: "bg-amber-500/20 text-amber-400" },
};

// 默认生图模型对应的平台信息（用于发起生成请求）
interface ImageModelTarget {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

// 会"展示商品"的分镜类型：开启商品保真时，这些 AI 分镜走 image-to-image（用商品图重绘，锁定主体）
const PRODUCT_SHOT_TYPES = new Set(["product_reveal", "demo", "cta"]);

// 把文生图模型映射到对应的编辑/图生图变体（商品保真重绘）
function toEditVariant(modelId: string): string {
  if (modelId === "openai/gpt-image-2") return "openai/gpt-image-2/image-to-image";
  if (modelId === "fal-ai/gpt-image-1.5") return "fal-ai/gpt-image-1.5/edit";
  // Replicate FLUX 文生图 → Kontext 编辑模型
  if (modelId.startsWith("black-forest-labs/flux") && !modelId.includes("kontext")) {
    return "black-forest-labs/flux-kontext-pro";
  }
  // 其余模型（Seedream/通义万相等）多数原生支持参考图 image-to-image，沿用原模型
  return modelId;
}

export default function AssetsPage() {
  const t = useT("assets");
  const tc = useT("common");
  const { id } = useParams<{ id: string }>();
  const { providers, defaultImageModel, defaultVideoModel, customModels, imageParams, videoParams } = useSettingsStore();

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [productImages, setProductImages] = useState<string[]>([]);
  // 商品保真：AI 生成展示商品的分镜时，用商品原图作参考重绘，避免 AI 篡改商品（带货命门）
  const [productSafe, setProductSafe] = useState(true);
  const [projectName, setProjectName] = useState("");
  // 项目类型：topic（无商品一句话成片）走免费素材库自动配画面
  const [contentType, setContentType] = useState<string>("");
  const [modelTarget, setModelTarget] = useState<ImageModelTarget | null>(null);
  const [videoModelTarget, setVideoModelTarget] = useState<ImageModelTarget | null>(null);
  // 正在转动态镜头的分镜
  const [motionShots, setMotionShots] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  // 「自动配画面（免费素材）」状态
  const [isFillingStock, setIsFillingStock] = useState(false);
  const [stockMsg, setStockMsg] = useState<string | null>(null);

  const doneCount = assets.filter((a) => a.status === "done").length;
  const allDone = assets.length > 0 && doneCount === assets.length;
  // 未配置生图模型时（modelTarget 为空）给无 Key 用户提供免费素材配画面入口
  const offerStockFill = !loading && shouldOfferStockFill(assets, contentType, modelTarget !== null);
  // 仅当还有 AI 分镜未出图时才提示配模型（已全部就绪则不提示，避免与「已就绪」矛盾）
  const showModelWarning = !loading && needsImageModelWarning(assets, modelTarget !== null);

  // 载入真实数据：项目信息 + 已选脚本分镜 + 解析默认生图模型所属平台
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [projectRes, scriptsRes, assetsRes] = await Promise.all([
          fetch(`/api/project/${id}`),
          fetch(`/api/project/${id}/scripts`),
          fetch(`/api/project/${id}/assets`),
        ]);

        const project = projectRes.ok ? await projectRes.json() : null;
        const scripts = scriptsRes.ok ? await scriptsRes.json() : [];
        const savedAssets = assetsRes.ok ? await assetsRes.json() : [];
        if (cancelled) return;

        const imgs: string[] = project && Array.isArray(project.productImages) ? project.productImages : [];
        if (project) {
          setProjectName(project.name ?? project.productName ?? "");
          setProductImages(imgs);
          setContentType(typeof project.contentType === "string" ? project.contentType : "");
        }

        // 取已选中的脚本（无 selected 则取第一套）
        const selected = Array.isArray(scripts)
          ? scripts.find((s: { selected?: boolean }) => s.selected) ?? scripts[0]
          : null;

        if (!selected || !Array.isArray(selected.shots) || selected.shots.length === 0) {
          setAssets([]);
          setLoadError(t("errorNoScript"));
          return;
        }

        // 选中脚本分镜 + 已落库素材 → 视图行（与「配画面后刷新」共用同一纯函数）
        setAssets(buildAssetRows(selected.shots as Shot[], Array.isArray(savedAssets) ? savedAssets : [], imgs));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : t("errorLoadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 重新拉取项目/脚本/素材并重建视图行（配画面后刷新缩略图，复用同一纯函数）
  const reloadAssets = useCallback(async () => {
    const [projectRes, scriptsRes, assetsRes] = await Promise.all([
      fetch(`/api/project/${id}`),
      fetch(`/api/project/${id}/scripts`),
      fetch(`/api/project/${id}/assets`),
    ]);
    const project = projectRes.ok ? await projectRes.json() : null;
    const scripts = scriptsRes.ok ? await scriptsRes.json() : [];
    const savedAssets = assetsRes.ok ? await assetsRes.json() : [];
    const imgs: string[] = project && Array.isArray(project.productImages) ? project.productImages : [];
    const selected = Array.isArray(scripts)
      ? scripts.find((s: { selected?: boolean }) => s.selected) ?? scripts[0]
      : null;
    if (selected && Array.isArray(selected.shots)) {
      setAssets(buildAssetRows(selected.shots as Shot[], Array.isArray(savedAssets) ? savedAssets : [], imgs));
    }
  }, [id]);

  // 一键「自动配画面（免费素材）」：从免费素材库（keyless Openverse 图片）按检索词逐镜配画面。
  // 无需任何生图 Key —— 这是「一句话主题成片」零门槛闭环的关键一步。
  const fillStock = useCallback(async () => {
    if (isFillingStock) return;
    setIsFillingStock(true);
    setStockMsg(null);
    try {
      const res = await fetch(`/api/project/${id}/stock-fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 免费源以 Openverse 图片为主（视频源需 Pexels/Pixabay Key，后续在设置接入）
        body: JSON.stringify({ source: "all", mediaType: "image" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("stockFillFailed"));
      await reloadAssets();
      setStockMsg(t("stockFilledMsg", { filled: data.filled ?? 0, total: data.total ?? 0 }));
    } catch (e) {
      setStockMsg(e instanceof Error ? e.message : t("stockFillFailed"));
    } finally {
      setIsFillingStock(false);
    }
  }, [id, isFillingStock, reloadAssets, t]);

  // 解析默认生图模型对应的平台（从 /api/ai/models 聚合结果里按 model 定位 provider）
  useEffect(() => {
    let cancelled = false;
    const enabled = Object.entries(providers)
      .filter(([, p]) => p.enabled && p.apiKey)
      .map(([name, p]) => ({ name, apiKey: p.apiKey, baseUrl: p.baseUrl }));
    if (enabled.length === 0 || !defaultImageModel) {
      setModelTarget(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: enabled, mediaType: "image" }),
        });
        if (!res.ok) return;
        const data = await res.json();
        // 并入用户自定义模型，使自定义生图模型也能被解析到对应平台
        const merged = mergeCustomModels(data.models ?? [], customModels, "image", new Set(enabled.map((e) => e.name)));
        const model = merged.find((m) => m.id === defaultImageModel);
        if (cancelled || !model) return;
        const prov = enabled.find((e) => e.name === model.provider);
        if (prov) {
          setModelTarget({ provider: prov.name, model: defaultImageModel, apiKey: prov.apiKey, baseUrl: prov.baseUrl });
        }
      } catch {
        // 忽略，generateOne 时会提示未配置
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providers, defaultImageModel, customModels]);

  // 解析默认生视频模型对应的平台（用于「转动态镜头」）
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
        // 并入用户自定义视频模型
        const merged = mergeCustomModels(data.models ?? [], customModels, "video", new Set(enabled.map((e) => e.name)));
        const model = merged.find((m) => m.id === defaultVideoModel);
        if (cancelled || !model) return;
        const prov = enabled.find((e) => e.name === model.provider);
        if (prov) {
          setVideoModelTarget({ provider: prov.name, model: defaultVideoModel, apiKey: prov.apiKey, baseUrl: prov.baseUrl });
        }
      } catch {
        // 忽略
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providers, defaultVideoModel, customModels]);

  // 转动态镜头：用该分镜已生成的图作首帧，调图生视频模型，结果存为该分镜素材（视频）
  const generateMotion = useCallback(
    async (shotId: number) => {
      const asset = assets.find((a) => a.shotId === shotId);
      if (!asset?.thumbnailUrl) return;
      if (!videoModelTarget) {
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, error: t("errorNoVideoModel") } : a))
        );
        return;
      }
      setMotionShots((prev) => new Set(prev).add(shotId));
      try {
        const res = await fetch("/api/ai/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: videoModelTarget.provider,
            model: videoModelTarget.model,
            apiKey: videoModelTarget.apiKey,
            baseUrl: videoModelTarget.baseUrl,
            mode: "image-to-video",
            prompt: asset.prompt || asset.description,
            imageUrl: asset.thumbnailUrl,
            // 用户自定义视频参数（比例/分辨率/时长/帧率/运动/种子/反向词）
            options: buildVideoOptions(videoParams),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("errorImageToVideoFailed"));
        const url = data.videoUrls?.[0];
        if (!url) throw new Error(t("errorEmptyResult"));
        // 存为该分镜素材（视频会被下载到本地），compose 会按视频片段处理（含原生音轨检测）
        const saveRes = await fetch(`/api/project/${id}/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shotId, type: "ai_generate", sourceUrl: url,
            prompt: asset.prompt, provider: videoModelTarget.provider, model: videoModelTarget.model,
          }),
        });
        let savedUrl = url;
        if (saveRes.ok) {
          const saved = await saveRes.json();
          if (saved.filePath) savedUrl = saved.filePath;
        }
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, status: "done", thumbnailUrl: savedUrl, isVideo: true, error: undefined } : a))
        );
      } catch (e) {
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, error: e instanceof Error ? e.message : t("errorImageToVideoFailed") } : a))
        );
      } finally {
        setMotionShots((prev) => {
          const next = new Set(prev);
          next.delete(shotId);
          return next;
        });
      }
    },
    [assets, videoModelTarget, id, videoParams]
  );

  // 真实生成单个素材
  const generateOne = useCallback(
    async (shotId: number) => {
      const asset = assets.find((a) => a.shotId === shotId);
      if (!asset) return;

      // 商品原图分镜：直接用商品图，无需调用 AI（落库供合成读取）
      if (asset.visualSource === "product_image") {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId ? { ...a, status: "done", thumbnailUrl: productImages[0] } : a
          )
        );
        if (productImages[0]) {
          fetch(`/api/project/${id}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shotId, type: "product_image", sourceUrl: productImages[0] }),
          }).catch(() => {});
        }
        return;
      }

      // AI 生成分镜：需要已配置默认生图模型
      if (!modelTarget) {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId
              ? { ...a, status: "failed", error: t("errorNoImageModel") }
              : a
          )
        );
        return;
      }

      setAssets((prev) => prev.map((a) => (a.shotId === shotId ? { ...a, status: "generating", error: undefined } : a)));

      // 商品保真：展示商品的 AI 分镜 + 有商品图 + 开关开 → 用商品图重绘（image-to-image，锁定商品主体）
      const useProductSafe =
        productSafe && !!productImages[0] && PRODUCT_SHOT_TYPES.has(asset.type);
      const genModel = useProductSafe ? toEditVariant(modelTarget.model) : modelTarget.model;
      const genMode = useProductSafe ? "image-to-image" : "text-to-image";
      const basePrompt = asset.prompt || asset.description;
      const genPrompt = useProductSafe
        ? `${basePrompt}。严格保持商品的外观、包装、颜色、logo 和文字完全不变，只重绘符合描述的场景、背景与光线。`
        : basePrompt;

      try {
        const res = await fetch("/api/ai/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: modelTarget.provider,
            model: genModel,
            apiKey: modelTarget.apiKey,
            baseUrl: modelTarget.baseUrl,
            mode: genMode,
            prompt: genPrompt,
            ...(useProductSafe && { imageUrl: productImages[0] }),
            // 用户自定义图片参数（比例→尺寸/数量/步数/引导/种子/反向词）
            options: buildImageOptions(imageParams),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("errorGenerateFailed"));
        const url = data.imageUrls?.[0];
        if (!url) throw new Error(t("errorEmptyResult"));
        // 落库（远程图会被下载到本地），供合成读取真实 AI 素材
        let savedUrl = url;
        try {
          const saveRes = await fetch(`/api/project/${id}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shotId, type: "ai_generate", sourceUrl: url,
              prompt: asset.prompt, provider: modelTarget.provider, model: genModel,
            }),
          });
          if (saveRes.ok) {
            const saved = await saveRes.json();
            if (saved.filePath) savedUrl = saved.filePath;
          }
        } catch {
          // 落库失败不影响预览（仅合成时会回退商品图兜底）
        }
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, status: "done", thumbnailUrl: savedUrl } : a))
        );
      } catch (e) {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId ? { ...a, status: "failed", error: e instanceof Error ? e.message : t("errorGenerateFailed") } : a
          )
        );
      }
    },
    [assets, modelTarget, productImages, productSafe, imageParams]
  );

  // 一键全部生成（串行，避免并发打满平台限流）
  const generateAll = useCallback(async () => {
    const pending = assets.filter((a) => a.status === "pending" || a.status === "failed");
    if (pending.length === 0) return;
    setIsBatchGenerating(true);
    for (const asset of pending) {
      await generateOne(asset.shotId);
    }
    setIsBatchGenerating(false);
  }, [assets, generateOne]);

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
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
            <span className="text-sm text-muted-foreground">{projectName || t("untitledProject")}</span>
          </div>

          {/* 步骤进度 */}
          <div className="flex items-center gap-1">
            <LanguageToggle className="mr-1" />
            {[t("stepScript"), t("stepAssets"), t("stepVideo"), t("stepExport")].map((step, i) => (
              <div key={step} className="flex items-center">
                <div className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${i === 1 ? "bg-primary text-primary-foreground" : i < 1 ? "text-primary" : "text-muted-foreground"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${i === 1 ? "bg-white/20" : i < 1 ? "bg-primary/20" : "bg-muted"}`}>
                    {i < 1 ? "✓" : i + 1}
                  </span>
                  {step}
                </div>
                {i < 3 && <div className="mx-1 h-px w-4 bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* 操作栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {loading ? tc("loading") : t("assetsReady", { done: doneCount, total: assets.length })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {productImages.length > 0 && (
              <button
                type="button"
                onClick={() => setProductSafe((v) => !v)}
                title={t("productSafeTip")}
                className={`flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-medium transition-all ${
                  productSafe
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-muted/20 text-muted-foreground"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${productSafe ? "bg-primary" : "bg-muted-foreground/40"}`} />
                {t("productSafe")}{productSafe ? t("on") : t("off")}
              </button>
            )}
            <Link href={`/project/${id}/script`}>
              <Button variant="outline" size="sm" className="text-xs">
                <LuArrowLeft className="w-3.5 h-3.5 mr-1" />
                {t("backToScript")}
              </Button>
            </Link>
            {offerStockFill && (
              <Button
                onClick={fillStock}
                disabled={isFillingStock}
                variant="outline"
                size="sm"
                className="text-xs border-primary/50 text-primary hover:bg-primary/10"
                title={t("stockFillHint")}
              >
                {isFillingStock ? (
                  <>
                    <LuLoaderCircle className="animate-spin w-3.5 h-3.5 mr-1" />
                    {t("stockFilling")}
                  </>
                ) : (
                  <>
                    <LuImage className="w-3.5 h-3.5 mr-1" />
                    {t("stockFill")}
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={generateAll}
              disabled={isBatchGenerating || allDone || assets.length === 0}
              className="brand-gradient text-white text-xs"
            >
              {isBatchGenerating ? (
                <>
                  <LuLoaderCircle className="animate-spin mr-1.5 h-3.5 w-3.5" />
                  {t("generatingAll")}
                </>
              ) : allDone ? (
                t("allDone")
              ) : (
                <>
                  <LuZap className="w-3.5 h-3.5 mr-1" />
                  {t("generateAll")}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 自动配画面 提示/结果（免费素材，零 Key，topic 成片首选路径） */}
        {offerStockFill && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 text-xs text-muted-foreground">
            <LuImage className="w-3.5 h-3.5 text-primary/70 shrink-0" />
            <span>{stockMsg ?? t("stockFillTip")}</span>
          </div>
        )}

        {/* 未配置生图模型提示（仅当仍有 AI 分镜待出图） */}
        {showModelWarning && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <LuTriangleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">{t("noModelTitle")}</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {t("noModelDesc")}
                <Link href="/settings" className="underline ml-1">{t("goToSettings")}</Link>
              </p>
            </div>
          </div>
        )}

        {/* 加载态 / 空态 */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <LuLoaderCircle className="w-6 h-6 animate-spin mb-3" />
            <p className="text-sm">{t("loadingShots")}</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <LuImage className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
            <Link href={`/project/${id}/script`}>
              <Button variant="outline" size="sm">{t("backToScriptStep")}</Button>
            </Link>
          </div>
        ) : (
          <>
            {/* 进度条 */}
            <div className="mb-6">
              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="h-full brand-gradient transition-all duration-700 rounded-full"
                  style={{ width: `${assets.length ? (doneCount / assets.length) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* 素材列表 */}
            <div className="space-y-4">
              {assets.map((asset) => {
                const typeInfo = shotTypeLabels[asset.type];
                return (
                  <Card key={asset.shotId} className="glass-card overflow-hidden">
                    <CardContent className="p-0">
                      <div className="flex">
                        {/* 左侧序号 */}
                        <div className="flex flex-col items-center justify-center w-16 py-4 border-r border-border/50 shrink-0">
                          <span className="text-lg font-bold text-muted-foreground/50">
                            {String(asset.shotId).padStart(2, "0")}
                          </span>
                          <Badge className={`${typeInfo.color} border-0 text-[10px] mt-1`}>
                            {t(typeInfo.key)}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground mt-1">{asset.duration}s</span>
                        </div>

                        {/* 中间内容 */}
                        <div className="flex-1 p-4">
                          <p className="text-sm leading-relaxed mb-2">{asset.description}</p>
                          {asset.prompt && (
                            <p className="text-xs text-muted-foreground bg-muted/20 rounded px-2 py-1.5 mb-2 line-clamp-2">
                              {t("promptLabel", { prompt: asset.prompt })}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {asset.assetType === "stock_footage"
                                ? t("sourceStock")
                                : asset.visualSource === "product_image"
                                ? t("sourceProductImage")
                                : asset.visualSource === "ai_generate"
                                ? t("sourceAiGenerate")
                                : t("sourceUserUpload")}
                            </span>
                          </div>
                          {asset.status === "failed" && asset.error && (
                            <p className="text-xs text-destructive mt-2">⚠ {asset.error}</p>
                          )}
                        </div>

                        {/* 右侧预览+操作 */}
                        <div className="flex flex-col items-center justify-center gap-2 p-4 shrink-0">
                          {/* 缩略图区域 */}
                          <div className="w-24 h-16 bg-muted/30 rounded-md flex items-center justify-center border border-border/30 overflow-hidden">
                            {asset.status === "done" && asset.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={asset.thumbnailUrl} alt={t("assetPreviewAlt")} className="w-full h-full object-cover" />
                            ) : asset.status === "done" ? (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                <LuCheck className="w-5 h-5 text-primary" />
                              </div>
                            ) : asset.status === "generating" ? (
                              <LuLoaderCircle className="animate-spin h-5 w-5 text-primary" />
                            ) : asset.status === "failed" ? (
                              <LuCircleX className="w-5 h-5 text-destructive" />
                            ) : (
                              <LuImage className="w-4 h-4 text-muted-foreground/40" />
                            )}
                          </div>

                          {/* 操作按钮（AI 生成分镜可手动生成/重试） */}
                          {asset.visualSource === "ai_generate" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs w-24"
                              disabled={asset.status === "generating" || motionShots.has(asset.shotId)}
                              onClick={() => generateOne(asset.shotId)}
                            >
                              {asset.status === "generating"
                                ? t("btnGenerating")
                                : asset.status === "done"
                                ? t("btnRegenerate")
                                : asset.status === "failed"
                                ? tc("retry")
                                : t("btnGenerate")}
                            </Button>
                          )}
                          {/* 转动态镜头：已有图素材 → 图生视频（真实运镜）。商品特写镜头建议保持静态避免篡改 */}
                          {asset.status === "done" && asset.thumbnailUrl && !asset.isVideo && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs w-24 text-muted-foreground hover:text-primary"
                              disabled={motionShots.has(asset.shotId)}
                              onClick={() => generateMotion(asset.shotId)}
                              title={t("motionTip")}
                            >
                              {motionShots.has(asset.shotId) ? t("btnConvertingMotion") : t("btnConvertMotion")}
                            </Button>
                          )}
                          {asset.isVideo && (
                            <span className="text-[10px] text-primary">{t("motionDone")}</span>
                          )}
                          {asset.error && (
                            <span className="text-[10px] text-destructive max-w-24 text-center">{asset.error}</span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* 底部操作 */}
            <div className="mt-8 flex justify-end">
              <Link href={allDone ? `/project/${id}/video` : "#"}>
                <Button className="brand-gradient text-white text-sm" disabled={!allDone}>
                  {t("nextCompose")}
                  <LuArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
