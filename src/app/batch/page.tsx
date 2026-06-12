"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import {
  LuArrowLeft,
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
import { exampleProducts } from "@/lib/examples";

// 视频模式选项
const videoModeOptions = [
  { value: "product_closeup", label: "产品特写", icon: LuBox },
  { value: "graphic_montage", label: "图文混剪", icon: LuLayoutGrid },
  { value: "scene_demo", label: "场景演示", icon: LuEye },
  { value: "live_presenter", label: "真人出镜", icon: LuVideo },
];

// 脚本风格选项
const scriptStyleOptions = [
  { value: "pain-point", label: "痛点种草" },
  { value: "scenario", label: "场景安利" },
  { value: "comparison", label: "对比测评" },
  { value: "story", label: "剧情故事" },
  { value: "auto", label: "智能推荐" },
];

// 目标时长选项
const durationOptions = [
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

// 品类中文映射
const categoryLabels: Record<string, string> = {
  home: "家居日用",
  tech: "数码3C",
  beauty: "美妆护肤",
  food: "食品零食",
  fashion: "服饰鞋包",
  other: "其他",
};

// 脚本风格值 → 后端 styleType 规范化
const styleTypeMap: Record<string, string> = {
  "pain-point": "pain_point",
  scenario: "scene",
  comparison: "comparison",
  story: "story",
  auto: "auto",
};

// 批量任务状态
type TaskStatus = "pending" | "generating" | "done" | "failed";

interface BatchTask {
  id: string;
  productName: string;
  status: TaskStatus;
  projectId?: string; // 生成成功后的项目 ID，用于跳转
  error?: string;
}

// 任务状态标签
const statusLabels: Record<TaskStatus, string> = {
  pending: "等待中",
  generating: "生成中",
  done: "已完成",
  failed: "失败",
};

// 任务状态颜色
const statusColors: Record<TaskStatus, string> = {
  pending: "bg-zinc-500/20 text-zinc-400 border-0",
  generating: "bg-amber-500/20 text-amber-400 border-0",
  done: "bg-emerald-500/20 text-emerald-400 border-0",
  failed: "bg-red-500/20 text-red-400 border-0",
};

export default function BatchPage() {
  // 真实商品库 + LLM 配置
  const { products, incrementVideoCount, addProduct } = useProductLibraryStore();
  const { llm } = useSettingsStore();

  // 一键导入示例商品
  const importExamples = useCallback(() => {
    const existing = new Set(products.map((p) => p.name));
    exampleProducts.forEach((ex) => {
      if (existing.has(ex.name)) return;
      addProduct({
        id: crypto.randomUUID(),
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
  }, [products, addProduct]);
  // 避免 SSR/水合不一致：挂载后再渲染列表
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // 商品选择状态
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  // 配置状态
  const [videoMode, setVideoMode] = useState("product_closeup");
  const [scriptStyle, setScriptStyle] = useState("auto");
  const [duration, setDuration] = useState("30");
  // 批量生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  // 用于中断生成流程
  const abortRef = useRef(false);

  // 切换商品选中状态
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

  // 配置缺失提示
  const [configError, setConfigError] = useState("");

  // 开始批量生成（真实：逐个创建项目 + 生成脚本，复用单品流程）
  const handleStartBatch = useCallback(async () => {
    if (selectedProducts.size === 0 || isGenerating) return;
    if (!llm.apiKey) {
      setConfigError("尚未配置 LLM，请先到「设置」填写 API Key");
      return;
    }
    setConfigError("");

    abortRef.current = false;
    setIsGenerating(true);
    setIsComplete(false);

    const selected = products.filter((p) => selectedProducts.has(p.id));
    const tasks: BatchTask[] = selected.map((p) => ({
      id: p.id,
      productName: p.name,
      status: "pending" as TaskStatus,
    }));
    setBatchTasks(tasks);

    // 处理单个商品（按 task.id 更新，支持乱序并发）
    const processOne = async (product: (typeof selected)[number]) => {
      setBatchTasks((prev) => prev.map((t) => (t.id === product.id ? { ...t, status: "generating" } : t)));
      try {
        // 1) 创建项目
        const projRes = await fetch("/api/project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${product.name} 推广`,
            productName: product.name,
            productCategory: product.category,
            productDescription: product.description ?? "",
            productImages: product.images ?? [],
            videoMode,
          }),
        });
        if (!projRes.ok) throw new Error("项目创建失败");
        const project = await projRes.json();

        // 2) 生成脚本
        const scriptRes = await fetch("/api/llm/script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            productName: product.name,
            category: product.category,
            productDescription: product.description ?? "",
            targetDuration: parseInt(duration),
            styleType: styleTypeMap[scriptStyle] ?? "auto",
            videoMode,
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
          throw new Error(e.error || "脚本生成失败");
        }

        incrementVideoCount(product.id);
        setBatchTasks((prev) => prev.map((t) => (t.id === product.id ? { ...t, status: "done", projectId: project.id } : t)));
      } catch (err) {
        setBatchTasks((prev) =>
          prev.map((t) => (t.id === product.id ? { ...t, status: "failed", error: err instanceof Error ? err.message : "生成失败" } : t))
        );
      }
    };

    // 并发池：最多 3 个同时跑，加速批量出片
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (!abortRef.current) {
        const idx = cursor++;
        if (idx >= selected.length) break;
        await processOne(selected[idx]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, worker));

    if (!abortRef.current) {
      setIsComplete(true);
    }
    setIsGenerating(false);
  }, [selectedProducts, isGenerating, products, llm, videoMode, duration, scriptStyle, incrementVideoCount]);

  // 已完成的任务数量
  const doneCount = batchTasks.filter((t) => t.status === "done").length;

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
              <span className="text-sm font-semibold tracking-tight">带货剪手</span>
            </div>
            <div className="h-5 w-px bg-border/50" />
            <span className="text-sm font-medium">批量出片</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="brand-gradient-text">批量出片</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            选择多个商品并统一配置，一键批量生成带货视频
          </p>
        </div>

        <div className="space-y-6">
          {/* 步骤 1：选择商品 */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <Label className="text-sm font-medium">
                  步骤 1：选择商品
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <span className="text-xs text-muted-foreground">
                  已选 {selectedProducts.size}/{products.length} 个商品
                </span>
              </div>

              {!mounted ? null : products.length === 0 ? (
                /* 商品库为空的提示 */
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
                    <LuPackage className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    商品库还是空的，导入示例商品即可马上体验批量出片
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="brand-gradient text-white" onClick={importExamples}>
                      导入示例商品
                    </Button>
                    <Link href="/products">
                      <Button variant="outline" size="sm">
                        前往商品库
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                /* 商品列表（多选） */
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
                        {/* 复选框 */}
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
                            isSelected
                              ? "brand-gradient border-transparent"
                              : "border-border/80 bg-muted/30"
                          }`}
                        >
                          {isSelected && <LuCheck className="w-3 h-3 text-white" />}
                        </div>
                        {/* 商品图片占位 */}
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/30 border border-border/30">
                          <LuPackage className="w-5 h-5 text-muted-foreground" />
                        </div>
                        {/* 商品信息 */}
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium block truncate">
                            {product.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {categoryLabels[product.category] || product.category}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 步骤 2：统一配置 */}
          <Card className="glass-card">
            <CardContent className="p-5 space-y-5">
              <Label className="text-sm font-medium block">步骤 2：统一配置</Label>

              {/* 视频模式 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2.5 block">视频模式</Label>
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
                          {opt.label}
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
              </div>

              {/* 脚本风格 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2.5 block">脚本风格</Label>
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
                      {opt.label}
                      {scriptStyle === opt.value && (
                        <div className="absolute -top-px -right-px h-3 w-3 flex items-center justify-center">
                          <div className="h-1.5 w-1.5 rounded-full brand-gradient" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* 目标时长 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2.5 block">目标时长</Label>
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

          {/* 批量任务列表（生成过程中显示） */}
          {batchTasks.length > 0 && (
            <Card className="glass-card">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <Label className="text-sm font-medium">生成进度</Label>
                  <span className="text-xs text-muted-foreground">
                    {doneCount}/{batchTasks.length} 已完成
                  </span>
                </div>

                {/* 进度条 */}
                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full brand-gradient transition-all duration-500 rounded-full"
                    style={{
                      width: `${batchTasks.length > 0 ? (doneCount / batchTasks.length) * 100 : 0}%`,
                    }}
                  />
                </div>

                {/* 任务列表 */}
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
                          {task.status === "failed" && task.error && (
                            <span className="text-xs text-red-400">{task.error}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {task.status === "done" && task.projectId && (
                          <Link href={`/project/${task.projectId}/script`}>
                            <Button variant="outline" size="sm" className="text-xs h-7">查看</Button>
                          </Link>
                        )}
                        <Badge className={statusColors[task.status]}>
                          {task.status === "generating" && (
                            <LuLoader className="w-3 h-3 mr-1 animate-spin" />
                          )}
                          {task.status === "done" && (
                            <LuCheck className="w-3 h-3 mr-1" />
                          )}
                          {statusLabels[task.status]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 完成提示 */}
                {isComplete && (
                  <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <p className="text-sm text-emerald-400 font-medium">
                      批量生成完成！共 {doneCount} 条视频
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 底部操作栏 */}
          <div className="pt-2 pb-10">
            {configError && (
              <p className="text-sm text-destructive text-center mb-3">{configError}</p>
            )}
            <Button
              onClick={handleStartBatch}
              disabled={selectedProducts.size === 0 || isGenerating}
              className="w-full h-12 brand-gradient text-white font-semibold text-base shadow-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <LuLoader className="w-5 h-5 mr-2 animate-spin" />
                  批量生成中...
                </>
              ) : isComplete ? (
                <>
                  <LuCheck className="w-5 h-5 mr-2" />
                  生成完成，再来一批
                </>
              ) : (
                <>
                  <LuZap className="w-5 h-5 mr-2" />
                  开始批量生成
                </>
              )}
            </Button>
            {!isGenerating && !isComplete && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                {selectedProducts.size > 0
                  ? `将为 ${selectedProducts.size} 个商品批量生成带货视频`
                  : "请先选择至少 1 个商品"}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
