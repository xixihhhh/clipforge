"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {LuArrowLeft, LuUpload, LuX, LuCircleAlert, LuZap, LuUser, LuUserX, LuBox, LuLayoutGrid, LuEye, LuVideo, LuBookmark} from "react-icons/lu";
import { useCharacterStore } from "@/lib/stores/project-store";
import { useTemplateStore } from "@/lib/stores/template-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

// 商品品类选项
const categoryOptions = [
  { value: "beauty", label: "美妆护肤" },
  { value: "food", label: "食品零食" },
  { value: "home", label: "家居日用" },
  { value: "fashion", label: "服饰鞋包" },
  { value: "digital", label: "数码3C" },
  { value: "other", label: "其他" },
];

// 目标时长选项
const durationOptions = [
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

// 脚本风格选项
const styleOptions = [
  { value: "pain-point", label: "痛点种草", desc: "直击用户痛点，激发购买欲" },
  { value: "scenario", label: "场景安利", desc: "真实场景展示，沉浸式种草" },
  { value: "comparison", label: "对比测评", desc: "横向对比突出优势" },
  { value: "story", label: "剧情故事", desc: "故事化包装，增强代入感" },
  { value: "auto", label: "智能推荐", desc: "AI 根据商品特性自动推荐" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // 从 URL 参数初始化模板数据（从模板中心跳转过来时）
  useEffect(() => {
    const templateId = searchParams.get("templateId");
    const templateName = searchParams.get("templateName");
    const paramCategory = searchParams.get("category");
    const paramStyle = searchParams.get("scriptStyle");
    const paramDuration = searchParams.get("duration");

    if (templateId) {
      setSelectedTemplateId(templateId);
    }
    if (paramCategory) {
      setCategory(paramCategory);
    }
    if (paramStyle) {
      setScriptStyle(paramStyle);
    }
    if (paramDuration) {
      setDuration(paramDuration);
    }
  }, [searchParams]);

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

  // 表单校验
  const isValid = productName.trim().length > 0 && images.length >= 1;

  // 提交处理
  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // 第1步：创建项目（先拿到 projectId）
      setProgress({ step: "creating", percent: 15, message: "正在创建项目..." });
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
      if (!projectRes.ok) {
        const errData = await projectRes.json().catch(() => ({}));
        throw new Error(`项目创建失败 (${projectRes.status}): ${errData.error || projectRes.statusText}`);
      }
      const project = await projectRes.json();

      // 第2步：将图片编码为 base64 data URL（跳过文件上传，直接存到项目）
      setProgress({ step: "uploading", percent: 35, message: "正在处理商品图片..." });
      const paths: string[] = [];
      for (const img of images) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(img.file);
        });
        paths.push(dataUrl);
      }

      // 第3步：生成脚本
      setProgress({ step: "generating", percent: 60, message: "AI 正在分析商品并生成脚本..." });
      // 如果选了出镜人物，附带人物信息
      const selectedCharacter = selectedCharacterId
        ? characters.find((c) => c.id === selectedCharacterId)
        : null;

      // 直接调用 LLM API（绕过服务端路由）
      const systemPrompt = "你是一位顶级电商短视频编导。请根据商品信息生成3个不同风格的带货脚本。每个脚本包含标题、总时长和分镜列表。每个分镜包含：shotId(编号)、type(类型:hook/pain_point/product_reveal/demo/social_proof/cta)、duration(秒)、description(画面描述)、camera(镜头说明)、voiceover(旁白文案)、visualSource(视觉来源)。请以JSON数组格式返回，不要加markdown包裹。";

      const userPrompt = `请为以下商品生成3个带货脚本（风格: ${scriptStyle}）：
商品名称: ${productName}
品类: ${category}
商品描述: ${sellingPoints}
目标时长: ${duration}秒
${priceRange ? `价格区间: ${priceRange}` : ""}
${targetAudience.length ? `目标用户: ${targetAudience.join(",")}` : ""}
${platforms.length ? `投放平台: ${platforms.join(",")}` : ""}`;

      const llmRes = await fetch(llm.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${llm.apiKey}`,
        },
        body: JSON.stringify({
          model: llm.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 16000,
        }),
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text().catch(() => "未知错误");
        throw new Error(`AI 生成失败 (${llmRes.status}): ${errText}`);
      }

      const llmData = await llmRes.json();
      const content = llmData.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI 未返回有效内容");

      // 手动解析 JSON
      let scripts = [];
      try {
        const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
        const parsed = JSON.parse(cleaned);
        scripts = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // 尝试用正则提取
        const match = content.match(/\[[\s\S]*\]/);
        if (match) scripts = JSON.parse(match[0]);
        else throw new Error("AI 返回格式异常，请重试");
      }

      // 使用了模板时递增使用次数

      // 第4步：完成
      setProgress({ step: "done", percent: 100, message: "脚本生成完成！正在跳转..." });
      await new Promise((r) => setTimeout(r, 800));
      router.push(`/project/${project.id}/script`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试");
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
                <span className="ml-1">返回</span>
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
              <span className="text-sm font-semibold tracking-tight">萌萌的</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            新建<span className="brand-gradient-text">带货项目</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            上传商品图片并填写信息，AI 将为你生成专业的带货脚本
          </p>
        </div>

        {/* LLM 未配置警告 */}
        {!isLLMConfigured && (
          <Link href="/settings">
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3 cursor-pointer hover:bg-amber-100 transition-colors">
              <LuCircleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900">请先配置 LLM 服务</p>
                <p className="text-xs text-amber-700 mt-0.5">脚本生成需要 LLM（如 GPT-4o），请先在设置中配置 API Key。<span className="underline">前往设置 →</span></p>
              </div>
            </div>
          </Link>
        )}

        <div className="space-y-6">
          {/* 商品图片上传区域 */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                <span className="text-sm font-semibold">上传商品图片</span>
              </div>
              <div className="flex items-center justify-between mb-4">
                <Label className="text-sm font-medium">
                  商品图片
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <span className="text-xs text-muted-foreground">
                  {images.length}/5 张
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
                        拖拽图片到这里，或{" "}
                        <span className="brand-gradient-text font-semibold">点击上传</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        支持 JPG / PNG / WebP，最多 5 张
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
                        alt="商品图片"
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
                <span className="text-sm font-semibold">填写商品信息</span>
              </div>
              {/* 商品名称 */}
              <div className="space-y-2">
                <Label htmlFor="productName" className="text-sm font-medium">
                  商品名称
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  id="productName"
                  placeholder="例如：小米手环8 NFC版"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="bg-muted/30 border-border/50 focus:border-primary"
                />
              </div>

              {/* 商品品类 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">商品品类</Label>
                <Select value={category} onValueChange={(val) => setCategory(val ?? "")}>
                  <SelectTrigger className="w-full bg-muted/30 border-border/50">
                    <SelectValue placeholder="选择商品品类" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 商品卖点 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sellingPoints" className="text-sm font-medium">
                    商品卖点
                  </Label>
                  <span className="text-xs text-muted-foreground">选填</span>
                </div>
                <Textarea
                  id="sellingPoints"
                  placeholder="描述商品的核心卖点、独特优势，AI 将据此生成更精准的脚本..."
                  value={sellingPoints}
                  onChange={(e) => setSellingPoints(e.target.value)}
                  rows={3}
                  className="bg-muted/30 border-border/50 focus:border-primary resize-none"
                />
              </div>

              {/* 价格定位 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">价格定位</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "0-50", label: "50元以下" },
                    { value: "50-200", label: "50-200元" },
                    { value: "200-500", label: "200-500元" },
                    { value: "500+", label: "500元以上" },
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
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 目标人群（多选标签） */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">目标人群</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    "学生党", "上班族", "宝妈", "精致白领", "中年群体", "男性用户", "健身人群", "数码爱好者"
                  ].map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleAudience(tag)}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                        targetAudience.includes(tag)
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-muted/20 text-muted-foreground border-border/50 hover:border-primary/30"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* 投放平台（多选） */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">投放平台</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "douyin", label: "抖音" },
                    { value: "kuaishou", label: "快手" },
                    { value: "xiaohongshu", label: "小红书" },
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
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 用法与优势 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="usageAdvantage" className="text-sm font-medium">用法与优势</Label>
                  <span className="text-xs text-muted-foreground">选填</span>
                </div>
                <Textarea
                  id="usageAdvantage"
                  placeholder="描述产品的使用方法、独特优势、和竞品的差异化等..."
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
                <span className="text-sm font-semibold">选择视频配置</span>
              </div>

              {/* 目标时长 */}
              <Label className="text-sm font-medium mb-3 block">目标时长</Label>
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
              <Label className="text-sm font-medium mb-3 block">视频模式</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { value: "product_closeup", label: "产品特写", desc: "商品原图为主，真实感最高", icon: LuBox },
                  { value: "graphic_montage", label: "图文混剪", desc: "快节奏图文卡片，适合快消品", icon: LuLayoutGrid },
                  { value: "scene_demo", label: "场景演示", desc: "AI 生成使用场景，不含人脸", icon: LuEye },
                  { value: "live_presenter", label: "真人出镜", desc: "人物出镜讲解（需要角色或素材）", icon: LuVideo },
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
                          {opt.label}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5 block">{opt.desc}</span>
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
                    使用爆款模板
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    选择已保存的成功脚本结构，自动套用到新商品
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
                      不使用模板
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5">AI 自由生成</span>
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
                        {tpl.category || tpl.styleType || "通用"} · 已用 {tpl.useCount} 次
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
                <span className="text-sm font-semibold">选择脚本风格</span>
              </div>
              <Label className="text-sm font-medium mb-3 block">脚本风格</Label>
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
                      {opt.label}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {opt.desc}
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
                  <Label className="text-sm font-medium">出镜人物</Label>
                  <span className="text-xs text-muted-foreground">可选</span>
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
                      <span className="text-sm font-medium block">不使用</span>
                      <span className="text-[11px] text-muted-foreground">纯产品展示</span>
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
                  {progress?.message || "处理中..."}
                </>
              ) : (
                <>
                  <LuZap className="w-5 h-5 mr-2" />
                  开始生成脚本
                </>
              )}
            </Button>
            {!isSubmitting && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                {!isLLMConfigured
                  ? "请先在设置中配置 LLM API Key"
                  : !isValid
                    ? "请上传至少一张商品图并填写商品名称"
                    : "AI 将分析商品图片和卖点，生成多套专业带货脚本供你选择"}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
