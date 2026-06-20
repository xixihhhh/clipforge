"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LuArrowLeft, LuUpload, LuX, LuCircleAlert, LuZap, LuUser, LuUserX, LuBox, LuLayoutGrid, LuEye, LuVideo, LuBookmark } from "react-icons/lu";
import { useCharacterStore } from "@/lib/stores/project-store";
import { useTemplateStore } from "@/lib/stores/template-store";
import { exampleProducts, type ExampleProduct } from "@/lib/examples";
import { useSettingsStore } from "@/lib/stores/settings-store";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";

// 商品品类选项（label 改为 i18n key，渲染时经 t() 转换）
const categoryOptions = [
  { value: "beauty", labelKey: "categoryBeauty" },
  { value: "food", labelKey: "categoryFood" },
  { value: "home", labelKey: "categoryHome" },
  { value: "fashion", labelKey: "categoryFashion" },
  { value: "digital", labelKey: "categoryDigital" },
  { value: "other", labelKey: "categoryOther" },
];

// 目标时长选项（label 为纯单位文案，无需翻译）
const durationOptions = [
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

// 脚本风格选项（label/desc 改为 i18n key，渲染时经 t() 转换）
const styleOptions = [
  { value: "pain-point", labelKey: "stylePainPointLabel", descKey: "stylePainPointDesc" },
  { value: "scenario", labelKey: "styleScenarioLabel", descKey: "styleScenarioDesc" },
  { value: "comparison", labelKey: "styleComparisonLabel", descKey: "styleComparisonDesc" },
  { value: "story", labelKey: "styleStoryLabel", descKey: "styleStoryDesc" },
  { value: "auto", labelKey: "styleAutoLabel", descKey: "styleAutoDesc" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const t = useT("newProject");
  const tc = useT("common");

  // 检查 LLM API 配置状态
  const { llm, providers } = useSettingsStore();
  const isLLMConfigured = llm.apiKey.length > 0;
  const hasProvider = Object.values(providers).some((p: { enabled: boolean; apiKey: string }) => p.enabled && p.apiKey.length > 0);

  // 表单状态
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [duration, setDuration] = useState("30");
  const [scriptStyle, setScriptStyle] = useState("auto");
  const [videoMode, setVideoMode] = useState<string>("product_closeup");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

  // 新增字段状态
  const [priceRange, setPriceRange] = useState<string>("");
  const [targetAudience, setTargetAudience] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>(["douyin"]);
  const [usageAdvantage, setUsageAdvantage] = useState("");

  // 多选切换辅助函数
  const toggleAudience = (tag: string) => {
    setTargetAudience(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };
  const togglePlatform = (p: string) => {
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  // 模板库
  const { templates, incrementUseCount } = useTemplateStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // 人物库
  const { characters } = useCharacterStore();

  // 图片上传状态（本地模拟）
  const [images, setImages] = useState<{ id: string; url: string; file: File }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 提交状态
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    step: string;
    percent: number;
    message: string;
  } | null>(null);

  // 处理图片选择
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const remaining = 5 - images.length;
      if (remaining <= 0) return;

      const newImages = Array.from(files)
        .slice(0, remaining)
        .filter((f) => f.type.startsWith("image/"))
        .map((file) => ({
          id: crypto.randomUUID(),
          url: URL.createObjectURL(file),
          file,
        }));

      setImages((prev) => [...prev, ...newImages]);
    },
    [images.length]
  );

  // 拖拽事件处理
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

  // 删除图片
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  // 一键填充示例商品（含真实示例图），方便新手零门槛试用
  const fillExample = useCallback(async (ex: ExampleProduct) => {
    setProductName(ex.name);
    setCategory(ex.category);
    setSellingPoints(ex.sellingPoints);
    try {
      const res = await fetch(ex.image);
      const blob = await res.blob();
      const file = new File([blob], `${ex.id}.png`, { type: blob.type || "image/png" });
      // 释放旧的预览 URL，避免内存泄漏
      setImages((prev) => {
        prev.forEach((img) => URL.revokeObjectURL(img.url));
        return [{ id: crypto.randomUUID(), url: URL.createObjectURL(file), file }];
      });
    } catch {
      // 取示例图失败也无妨，文字已填好，用户可自行上传
    }
  }, []);

  // 表单校验
  const isValid = productName.trim().length > 0 && images.length >= 1;

  // 提交处理
  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // 第1步：创建项目（先拿到 projectId）
      setProgress({ step: "creating", percent: 15, message: t("progressCreating") });
      const projectRes = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${productName} 推广`,
          productName,
          productCategory: category,
          productDescription: sellingPoints,
          productImages: [],
        }),
      });
      if (!projectRes.ok) throw new Error(t("errorCreateFailed"));
      const project = await projectRes.json();

      // 第2步：上传图片（携带 projectId）
      setProgress({ step: "uploading", percent: 35, message: t("progressUploading") });
      const formData = new FormData();
      images.forEach((img) => formData.append("files", img.file));
      formData.append("projectId", project.id);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.error || t("errorUploadFailed"));
      }
      const { paths } = await uploadRes.json();

      // 第2.5步：更新项目的图片路径
      await fetch(`/api/project/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productImages: paths }),
      });

      // 第3步：生成脚本
      setProgress({ step: "generating", percent: 60, message: t("progressGenerating") });
      // 如果选了出镜人物，附带人物信息
      const selectedCharacter = selectedCharacterId
        ? characters.find((c) => c.id === selectedCharacterId)
        : null;

      // 套用模板：把选中模板的分镜结构拼成参考结构，让 AI 据此生成（真正消费模板，而非装饰）
      const selectedTemplate = selectedTemplateId
        ? templates.find((t) => t.id === selectedTemplateId)
        : null;
      const referenceStructure = selectedTemplate
        ? selectedTemplate.shots
            .map((s, i) => `${i + 1}. [${s.type}] ${s.duration}s ${s.camera ?? ""} 口播参考：「${s.voiceover ?? ""}」`)
            .join("\n")
        : undefined;

      const scriptRes = await fetch("/api/llm/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          productName,
          category,
          productDescription: sellingPoints,
          targetDuration: parseInt(duration),
          styleType: scriptStyle,
          videoMode,
          productImages: paths,
          llmConfig: {
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            model: llm.model,
            visionModel: llm.visionModel,
          },
          priceRange,
          targetAudience: targetAudience.join(","),
          platforms: platforms.join(","),
          usageAdvantage,
          // 传入选中的模板 ID + 模板结构（让 AI 真正套用模板节奏）
          ...(selectedTemplateId && { templateId: selectedTemplateId }),
          ...(referenceStructure && { referenceStructure }),
          ...(selectedCharacter && {
            character: {
              id: selectedCharacter.id,
              name: selectedCharacter.name,
              appearance: selectedCharacter.appearance || "",
              voiceStyle: selectedCharacter.voiceProfile?.style,
            },
          }),
        }),
      });

      // 使用了模板时递增使用次数
      if (selectedTemplateId) {
        incrementUseCount(selectedTemplateId);
      }
      if (!scriptRes.ok) throw new Error(t("errorScriptFailed"));

      // 第4步：完成
      setProgress({ step: "done", percent: 100, message: t("progressDone") });
      await new Promise((r) => setTimeout(r, 800));
      router.push(`/project/${project.id}/script`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"));
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            {/* 返回按钮 */}
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2">
                <LuArrowLeft className="w-4 h-4" />
                <span className="ml-1">{tc("back")}</span>
              </Button>
            </Link>
            <div className="h-5 w-px bg-border/50" />
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md brand-gradient">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <span className="text-sm font-semibold tracking-tight">ClipForge</span>
            </div>
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("pageTitlePrefix")}<span className="brand-gradient-text">{t("pageTitleAccent")}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("pageSubtitle")}
          </p>
        </div>

        {/* LLM 未配置警告 */}
        {!isLLMConfigured && (
          <Link href="/settings">
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3 cursor-pointer hover:bg-amber-100 transition-colors">
              <LuCircleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900">{t("llmWarnTitle")}</p>
                <p className="text-xs text-amber-700 mt-0.5">{t("llmWarnDesc")}<span className="underline">{t("llmWarnCta")}</span></p>
              </div>
            </div>
          </Link>
        )}

        <div className="space-y-6">
          {/* 快速开始：示例商品一键填充（新手零门槛试用） */}
          <Card className="glass-card border-primary/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-1">
                <LuZap className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">{t("quickStartTitle")}</span>
                <Badge variant="secondary" className="text-[10px]">{t("exampleBadge")}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-4">{t("quickStartDesc")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {exampleProducts.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => fillExample(ex)}
                    className="group flex items-center gap-3 p-2.5 rounded-lg border border-border/50 bg-muted/10 text-left hover:border-primary/50 hover:bg-primary/5 transition-all"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ex.image} alt={ex.name} className="h-12 w-12 shrink-0 rounded-md object-cover border border-border/30" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{ex.name}</p>
                      <p className="text-xs text-muted-foreground">¥{ex.price}</p>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 商品图片上传区域 */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                <span className="text-sm font-semibold">{t("stepUploadTitle")}</span>
              </div>
              <div className="flex items-center justify-between mb-4">
                <Label className="text-sm font-medium">
                  {t("imageLabel")}
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <span className="text-xs text-muted-foreground">
                  {t("imageCount", { n: images.length })}
                </span>
              </div>

              {/* 拖拽上传区域 */}
              {images.length < 5 && (
                <div
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-primary/50 hover:bg-muted/20"
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
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
                      <LuUpload className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {t("dropHintPrefix")}
                        <span className="brand-gradient-text font-semibold">{t("dropHintClick")}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("dropHintFormats")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 已上传图片预览网格 */}
              {images.length > 0 && (
                <div className={`grid grid-cols-3 sm:grid-cols-5 gap-3 ${images.length < 5 ? "mt-4" : ""}`}>
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className="group relative aspect-square rounded-lg overflow-hidden border border-border/50 bg-muted/20"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={t("imageAlt")}
                        className="h-full w-full object-cover"
                      />
                      {/* 删除按钮 */}
                      <button
                        onClick={() => removeImage(img.id)}
                        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                      >
                        <LuX className="w-3 h-3" />
                      </button>
                      {/* 悬停遮罩 */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 商品信息表单 */}
          <Card className="glass-card">
            <CardContent className="p-5 space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
                <span className="text-sm font-semibold">{t("stepInfoTitle")}</span>
              </div>
              {/* 商品名称 */}
              <div className="space-y-2">
                <Label htmlFor="productName" className="text-sm font-medium">
                  {t("productNameLabel")}
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  id="productName"
                  placeholder={t("productNamePlaceholder")}
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="bg-muted/30 border-border/50 focus:border-primary"
                />
              </div>

              {/* 商品品类 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("categoryLabel")}</Label>
                <Select value={category} onValueChange={(val) => setCategory(val ?? "")}>
                  <SelectTrigger className="w-full bg-muted/30 border-border/50">
                    {/* Base UI 的 Select.Value 默认显示原始 value，用函数子节点映射为中文标签 */}
                    <SelectValue>
                      {(value: string) => {
                        const opt = categoryOptions.find((o) => o.value === value);
                        return opt ? t(opt.labelKey) : t("categoryPlaceholder");
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 商品卖点 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sellingPoints" className="text-sm font-medium">
                    {t("sellingPointsLabel")}
                  </Label>
                  <span className="text-xs text-muted-foreground">{t("optional")}</span>
                </div>
                <Textarea
                  id="sellingPoints"
                  placeholder={t("sellingPointsPlaceholder")}
                  value={sellingPoints}
                  onChange={(e) => setSellingPoints(e.target.value)}
                  rows={3}
                  className="bg-muted/30 border-border/50 focus:border-primary resize-none"
                />
              </div>

              {/* 价格定位 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("priceLabel")}</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "0-50", labelKey: "priceUnder50" },
                    { value: "50-200", labelKey: "price50to200" },
                    { value: "200-500", labelKey: "price200to500" },
                    { value: "500+", labelKey: "price500plus" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPriceRange(opt.value)}
                      className={`relative flex items-center justify-center h-11 rounded-lg border text-sm font-medium transition-all ${
                        priceRange === opt.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 目标人群（多选标签） */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("audienceLabel")}</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    // value 为传给 API 的原始标签（不翻译），labelKey 仅用于展示
                    { value: "学生党", labelKey: "audienceStudent" },
                    { value: "上班族", labelKey: "audienceWorker" },
                    { value: "宝妈", labelKey: "audienceMom" },
                    { value: "精致白领", labelKey: "audienceWhiteCollar" },
                    { value: "中年群体", labelKey: "audienceMiddleAge" },
                    { value: "男性用户", labelKey: "audienceMale" },
                    { value: "健身人群", labelKey: "audienceFitness" },
                    { value: "数码爱好者", labelKey: "audienceTechFan" },
                  ].map((tag) => (
                    <button
                      key={tag.value}
                      onClick={() => toggleAudience(tag.value)}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                        targetAudience.includes(tag.value)
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-muted/20 text-muted-foreground border-border/50 hover:border-primary/30"
                      }`}
                    >
                      {t(tag.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 投放平台（多选） */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("platformLabel")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "douyin", labelKey: "platformDouyin" },
                    { value: "kuaishou", labelKey: "platformKuaishou" },
                    { value: "xiaohongshu", labelKey: "platformXiaohongshu" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => togglePlatform(opt.value)}
                      className={`relative flex items-center justify-center h-11 rounded-lg border text-sm font-medium transition-all ${
                        platforms.includes(opt.value)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 用法与优势 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="usageAdvantage" className="text-sm font-medium">{t("usageLabel")}</Label>
                  <span className="text-xs text-muted-foreground">{t("optional")}</span>
                </div>
                <Textarea
                  id="usageAdvantage"
                  placeholder={t("usagePlaceholder")}
                  value={usageAdvantage}
                  onChange={(e) => setUsageAdvantage(e.target.value)}
                  rows={3}
                  className="bg-muted/30 border-border/50 focus:border-primary resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* 视频配置（目标时长 + 视频模式） */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
                <span className="text-sm font-semibold">{t("stepConfigTitle")}</span>
              </div>

              {/* 目标时长 */}
              <Label className="text-sm font-medium mb-3 block">{t("durationLabel")}</Label>
              <div className="grid grid-cols-3 gap-3">
                {durationOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDuration(opt.value)}
                    className={`relative flex items-center justify-center h-11 rounded-lg border text-sm font-medium transition-all ${
                      duration === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                    {/* 选中指示器 */}
                    {duration === opt.value && (
                      <div className="absolute -top-px -right-px h-4 w-4 flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full brand-gradient" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* 分隔线 */}
              <div className="my-5 border-t border-border/40" />

              {/* 视频模式 */}
              <Label className="text-sm font-medium mb-3 block">{t("videoModeLabel")}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { value: "product_closeup", labelKey: "modeCloseupLabel", descKey: "modeCloseupDesc", icon: LuBox },
                  { value: "graphic_montage", labelKey: "modeMontageLabel", descKey: "modeMontageDesc", icon: LuLayoutGrid },
                  { value: "scene_demo", labelKey: "modeSceneLabel", descKey: "modeSceneDesc", icon: LuEye },
                  { value: "live_presenter", labelKey: "modePresenterLabel", descKey: "modePresenterDesc", icon: LuVideo },
                ].map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setVideoMode(opt.value);
                        // 非真人出镜模式，清除人物选择
                        if (opt.value !== "live_presenter") {
                          setSelectedCharacterId(null);
                        }
                      }}
                      className={`relative flex items-start gap-3 p-3.5 rounded-lg border text-left transition-all ${
                        videoMode === opt.value
                          ? "border-primary bg-primary/10"
                          : "border-border/50 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${videoMode === opt.value ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <span className={`text-sm font-medium ${videoMode === opt.value ? "text-primary" : "text-foreground"}`}>
                          {t(opt.labelKey)}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5 block">{t(opt.descKey)}</span>
                      </div>
                      {videoMode === opt.value && (
                        <div className="absolute top-2.5 right-2.5">
                          <div className="h-2 w-2 rounded-full brand-gradient" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 使用爆款模板（仅在有模板时显示） */}
          {templates.length > 0 && (
            <Card className="glass-card">
              <CardContent className="p-5">
                <div className="mb-3">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <LuBookmark className="w-4 h-4 text-primary" />
                    {t("templateTitle")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("templateDesc")}
                  </p>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {/* 不使用模板 */}
                  <button
                    onClick={() => setSelectedTemplateId(null)}
                    className={`shrink-0 flex flex-col items-start p-3 rounded-lg border text-left transition-all min-w-[140px] ${
                      selectedTemplateId === null
                        ? "border-primary bg-primary/10"
                        : "border-border/50 bg-muted/20 hover:border-primary/40"
                    }`}
                  >
                    <span className={`text-sm font-medium ${selectedTemplateId === null ? "text-primary" : "text-foreground"}`}>
                      {t("templateNone")}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5">{t("templateNoneDesc")}</span>
                  </button>
                  {/* 模板列表 */}
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`shrink-0 flex flex-col items-start p-3 rounded-lg border text-left transition-all min-w-[140px] ${
                        selectedTemplateId === tpl.id
                          ? "border-primary bg-primary/10"
                          : "border-border/50 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <span className={`text-sm font-medium truncate max-w-[120px] ${selectedTemplateId === tpl.id ? "text-primary" : "text-foreground"}`}>
                        {tpl.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground mt-0.5">
                        {tpl.category || tpl.styleType || t("templateGeneric")} · {t("templateUsedCount", { n: tpl.useCount })}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 脚本风格 */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">4</span>
                <span className="text-sm font-semibold">{t("stepStyleTitle")}</span>
              </div>
              <Label className="text-sm font-medium mb-3 block">{t("scriptStyleLabel")}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {styleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setScriptStyle(opt.value)}
                    className={`relative flex flex-col items-start p-3.5 rounded-lg border text-left transition-all ${
                      scriptStyle === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-border/50 bg-muted/20 hover:border-primary/40"
                    }`}
                  >
                    <span
                      className={`text-sm font-medium ${
                        scriptStyle === opt.value ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {t(opt.descKey)}
                    </span>
                    {/* 选中指示器 */}
                    {scriptStyle === opt.value && (
                      <div className="absolute top-2.5 right-2.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-primary">
                          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
                          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 出镜人物（仅真人出镜模式显示） */}
          {videoMode === "live_presenter" && characters.length > 0 && (
            <Card className="glass-card">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm font-medium">{t("characterTitle")}</Label>
                  <span className="text-xs text-muted-foreground">{t("characterOptional")}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {/* 不使用人物 */}
                  <button
                    onClick={() => setSelectedCharacterId(null)}
                    className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                      selectedCharacterId === null
                        ? "border-primary bg-primary/10"
                        : "border-border/50 bg-muted/20 hover:border-primary/40"
                    }`}
                  >
                    <LuUserX className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <span className="text-sm font-medium block">{t("characterNone")}</span>
                      <span className="text-[11px] text-muted-foreground">{t("characterNoneDesc")}</span>
                    </div>
                  </button>

                  {/* 已有人物 */}
                  {characters.map((char) => (
                    <button
                      key={char.id}
                      onClick={() => setSelectedCharacterId(char.id)}
                      className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                        selectedCharacterId === char.id
                          ? "border-primary bg-primary/10"
                          : "border-border/50 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <LuUser className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-medium block truncate">{char.name}</span>
                        {char.description && (
                          <span className="text-[11px] text-muted-foreground truncate block">{char.description}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 提交按钮 */}
          <div className="pt-2 pb-10">
            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive flex items-center gap-2">
                  <LuCircleAlert className="w-4 h-4 shrink-0" />
                  {error}
                </p>
              </div>
            )}

            {/* 进度条 */}
            {progress && (
              <div className="mb-4">
                <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full brand-gradient transition-all duration-500 rounded-full"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {progress.message}
                </p>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting || !isLLMConfigured}
              className="w-full h-12 brand-gradient text-white font-semibold text-base shadow-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin mr-2 h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {progress?.message || t("submitProcessing")}
                </>
              ) : (
                <>
                  <LuZap className="w-5 h-5 mr-2" />
                  {t("submitGenerate")}
                </>
              )}
            </Button>
            {!isSubmitting && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                {!isLLMConfigured
                  ? t("hintNeedLlm")
                  : !isValid
                    ? t("hintNeedInput")
                    : t("hintReady")}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
