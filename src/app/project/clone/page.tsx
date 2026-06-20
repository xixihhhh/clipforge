"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useT } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";

/** 分镜卡片数据 */
interface StoryboardCard {
  id: number;
  title: string;
  description: string;
  duration: string;
}

/** 商品图片数据 */
interface ProductImage {
  id: string;
  file: File;
  previewUrl: string;
}

export default function ClonePage() {
  const t = useT("clone");
  const router = useRouter();
  const { llm } = useSettingsStore();

  // 视频链接与分析状态
  const [videoUrl, setVideoUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [storyboards, setStoryboards] = useState<StoryboardCard[]>([]);

  // 商品信息
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [productName, setProductName] = useState("");
  const [productFeatures, setProductFeatures] = useState("");

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  // 拖拽上传状态
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 载入爆款通用结构参考。
   * 说明：暂不支持解析具体视频画面内容（需视频下载+ASR管线），
   * 这里展示的是高转化带货视频的通用分镜结构，AI 会在「开始复刻生成」时
   * 结合该结构与你的商品信息真实生成脚本。
   */
  const handleAnalyze = useCallback(async () => {
    if (!videoUrl.trim()) return;
    setIsAnalyzing(true);
    setStoryboards([]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setStoryboards([
      { id: 1, title: t("shot1Title"), description: t("shot1Desc"), duration: "0-3s" },
      { id: 2, title: t("shot2Title"), description: t("shot2Desc"), duration: "3-8s" },
      { id: 3, title: t("shot3Title"), description: t("shot3Desc"), duration: "8-15s" },
      { id: 4, title: t("shot4Title"), description: t("shot4Desc"), duration: "15-25s" },
      { id: 5, title: t("shot5Title"), description: t("shot5Desc"), duration: "25-35s" },
      { id: 6, title: t("shot6Title"), description: t("shot6Desc"), duration: "35-40s" },
    ]);
    setIsAnalyzing(false);
  }, [videoUrl, t]);

  /** 开始复刻生成：创建 clone 项目 + 真实生成脚本，然后跳转 */
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    if (!llm.apiKey) {
      setGenError(t("errorNoLlm"));
      return;
    }
    setGenError("");
    setIsGenerating(true);
    try {
      // 1) 创建复刻项目（记录来源视频链接）
      const projRes = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: t("projectNameSuffix", { name: productName }),
          productName,
          productDescription: productFeatures,
          productImages: [],
          sourceType: "clone",
          sourceVideoUrl: videoUrl,
        }),
      });
      if (!projRes.ok) throw new Error(t("errorProjectCreate"));
      const project = await projRes.json();

      // 2) 生成脚本（参考爆款通用结构 + 商品信息）
      const scriptRes = await fetch("/api/llm/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          productName,
          productDescription: productFeatures,
          targetDuration: 40,
          styleType: "auto",
          videoMode: "product_closeup",
          productImages: [],
          referenceUrl: videoUrl,
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

      // 3) 跳转到脚本页
      router.push(`/project/${project.id}/script`);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t("errorCloneFailed"));
      setIsGenerating(false);
    }
  }, [isGenerating, llm, productName, productFeatures, videoUrl, router, t]);

  /** 处理文件选择/上传 */
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

  /** 移除已上传的图片 */
  const removeImage = useCallback((id: string) => {
    setProductImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  /** 拖拽事件处理 */
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

  /** 是否已完成分析 */
  const hasAnalysis = storyboards.length > 0;
  /** 是否可以开始生成 */
  const canGenerate =
    hasAnalysis &&
    productImages.length > 0 &&
    productName.trim() !== "" &&
    productFeatures.trim() !== "";

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            {/* 返回按钮 */}
            <Link href="/">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
              </Button>
            </Link>
            {/* Logo */}
            <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">ClipForge</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {/* 页面标题 */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            <span className="brand-gradient-text">{t("heroTitle")}</span>
          </h1>
          <p className="text-muted-foreground text-base max-w-lg mx-auto">
            {t("heroSubtitle")}
          </p>
        </div>

        {/* Step 1 - 输入爆款视频 */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full brand-gradient text-sm font-bold text-white">
              1
            </div>
            <h2 className="text-lg font-semibold">{t("step1Title")}</h2>
          </div>

          <Card className="glass-card card-hover">
            <CardContent className="p-6 space-y-5">
              {/* 视频链接输入 */}
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
                    disabled={!videoUrl.trim() || isAnalyzing}
                    onClick={handleAnalyze}
                  >
                    {isAnalyzing ? (
                      <span className="flex items-center gap-2">
                        {/* 加载动画 */}
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

              {/* 分析结果展示区 */}
              {hasAnalysis && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">
                      {t("structureTitle")}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {t("storyboardCount", { n: storyboards.length })}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    {t("structureHint")}
                  </p>

                  {/* 分镜卡片列表 */}
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

        {/* Step 2 - 上传你的商品 */}
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
              {/* 商品图片拖拽上传 */}
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
                    // 空状态 - 上传提示
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
                    // 已上传图片预览
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
                            {/* 删除按钮 */}
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
                        {/* 添加更多按钮 */}
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

              {/* 商品名称 */}
              <div className="space-y-2">
                <Label htmlFor="product-name">{t("productNameLabel")}</Label>
                <Input
                  id="product-name"
                  placeholder={t("productNamePlaceholder")}
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>

              {/* 商品卖点 */}
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

        {/* 底部操作按钮 */}
        <div className="flex flex-col items-center pb-10 gap-3">
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
