"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { LuArrowLeft, LuZap, LuCheck, LuCircleX, LuImage, LuArrowRight, LuLoaderCircle, LuTriangleAlert } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import type { Shot } from "@/lib/db/schema";

// 素材项（由真实脚本分镜派生）
interface AssetItem {
  shotId: number;
  type: Shot["type"];
  duration: number;
  description: string;
  prompt: string;
  visualSource: Shot["visualSource"];
  status: "pending" | "generating" | "done" | "failed";
  thumbnailUrl?: string;
  error?: string;
}

// 镜头类型标签
const shotTypeLabels: Record<Shot["type"], { label: string; color: string }> = {
  hook: { label: "钩子", color: "bg-red-500/20 text-red-400" },
  pain_point: { label: "痛点", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { label: "产品", color: "bg-blue-500/20 text-blue-400" },
  demo: { label: "演示", color: "bg-green-500/20 text-green-400" },
  social_proof: { label: "背书", color: "bg-purple-500/20 text-purple-400" },
  cta: { label: "转化", color: "bg-amber-500/20 text-amber-400" },
};

// 默认生图模型对应的平台信息（用于发起生成请求）
interface ImageModelTarget {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export default function AssetsPage() {
  const { id } = useParams<{ id: string }>();
  const { providers, defaultImageModel } = useSettingsStore();

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [productImages, setProductImages] = useState<string[]>([]);
  const [projectName, setProjectName] = useState("");
  const [modelTarget, setModelTarget] = useState<ImageModelTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);

  const doneCount = assets.filter((a) => a.status === "done").length;
  const allDone = assets.length > 0 && doneCount === assets.length;

  // 载入真实数据：项目信息 + 已选脚本分镜 + 解析默认生图模型所属平台
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [projectRes, scriptsRes] = await Promise.all([
          fetch(`/api/project/${id}`),
          fetch(`/api/project/${id}/scripts`),
        ]);

        const project = projectRes.ok ? await projectRes.json() : null;
        const scripts = scriptsRes.ok ? await scriptsRes.json() : [];
        if (cancelled) return;

        const imgs: string[] = project && Array.isArray(project.productImages) ? project.productImages : [];
        if (project) {
          setProjectName(project.name ?? project.productName ?? "");
          setProductImages(imgs);
        }

        // 取已选中的脚本（无 selected 则取第一套）
        const selected = Array.isArray(scripts)
          ? scripts.find((s: { selected?: boolean }) => s.selected) ?? scripts[0]
          : null;

        if (!selected || !Array.isArray(selected.shots) || selected.shots.length === 0) {
          setAssets([]);
          setLoadError("尚未生成脚本，请先返回脚本步骤生成分镜");
          return;
        }

        setAssets(
          (selected.shots as Shot[]).map((s) => ({
            shotId: s.shotId,
            type: s.type,
            duration: s.duration,
            description: s.description,
            prompt: s.prompt ?? "",
            visualSource: s.visualSource,
            // 商品原图分镜直接就绪，AI 生成分镜待生成
            status: s.visualSource === "product_image" ? "done" : "pending",
            // 商品原图分镜直接用第一张商品图作缩略图
            thumbnailUrl: s.visualSource === "product_image" ? imgs[0] : undefined,
          }))
        );
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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
        const model = (data.models ?? []).find((m: { id: string }) => m.id === defaultImageModel);
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
  }, [providers, defaultImageModel]);

  // 真实生成单个素材
  const generateOne = useCallback(
    async (shotId: number) => {
      const asset = assets.find((a) => a.shotId === shotId);
      if (!asset) return;

      // 商品原图分镜：直接用商品图，无需调用 AI
      if (asset.visualSource === "product_image") {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId ? { ...a, status: "done", thumbnailUrl: productImages[0] } : a
          )
        );
        return;
      }

      // AI 生成分镜：需要已配置默认生图模型
      if (!modelTarget) {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId
              ? { ...a, status: "failed", error: "未配置默认生图模型，请先在设置中启用平台并选择模型" }
              : a
          )
        );
        return;
      }

      setAssets((prev) => prev.map((a) => (a.shotId === shotId ? { ...a, status: "generating", error: undefined } : a)));

      try {
        const res = await fetch("/api/ai/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: modelTarget.provider,
            model: modelTarget.model,
            apiKey: modelTarget.apiKey,
            baseUrl: modelTarget.baseUrl,
            mode: "text-to-image",
            prompt: asset.prompt || asset.description,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "生成失败");
        const url = data.imageUrls?.[0];
        if (!url) throw new Error("生成结果为空");
        setAssets((prev) =>
          prev.map((a) => (a.shotId === shotId ? { ...a, status: "done", thumbnailUrl: url } : a))
        );
      } catch (e) {
        setAssets((prev) =>
          prev.map((a) =>
            a.shotId === shotId ? { ...a, status: "failed", error: e instanceof Error ? e.message : "生成失败" } : a
          )
        );
      }
    },
    [assets, modelTarget, productImages]
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
              <span className="text-lg font-bold tracking-tight">带货剪手</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">{projectName || "带货项目"}</span>
          </div>

          {/* 步骤进度 */}
          <div className="flex items-center gap-1">
            {["脚本", "素材", "视频", "导出"].map((step, i) => (
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
            <h2 className="text-lg font-semibold">素材生成</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {loading ? "加载中..." : `${doneCount}/${assets.length} 个素材已就绪`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/project/${id}/script`}>
              <Button variant="outline" size="sm" className="text-xs">
                <LuArrowLeft className="w-3.5 h-3.5 mr-1" />
                返回脚本
              </Button>
            </Link>
            <Button
              onClick={generateAll}
              disabled={isBatchGenerating || allDone || assets.length === 0}
              className="brand-gradient text-white text-xs"
            >
              {isBatchGenerating ? (
                <>
                  <LuLoaderCircle className="animate-spin mr-1.5 h-3.5 w-3.5" />
                  生成中...
                </>
              ) : allDone ? (
                "全部完成"
              ) : (
                <>
                  <LuZap className="w-3.5 h-3.5 mr-1" />
                  一键全部生成
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 未配置生图模型提示 */}
        {!loading && !modelTarget && assets.some((a) => a.visualSource === "ai_generate") && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <LuTriangleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">未配置默认生图模型</p>
              <p className="text-xs text-amber-700 mt-0.5">
                AI 生成类分镜需要在设置中启用 AI 平台并选择「默认生图模型」（如 GPT Image 2）。
                <Link href="/settings" className="underline ml-1">前往设置 →</Link>
              </p>
            </div>
          </div>
        )}

        {/* 加载态 / 空态 */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <LuLoaderCircle className="w-6 h-6 animate-spin mb-3" />
            <p className="text-sm">正在加载脚本分镜...</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <LuImage className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
            <Link href={`/project/${id}/script`}>
              <Button variant="outline" size="sm">返回脚本步骤</Button>
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
                            {typeInfo.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground mt-1">{asset.duration}s</span>
                        </div>

                        {/* 中间内容 */}
                        <div className="flex-1 p-4">
                          <p className="text-sm leading-relaxed mb-2">{asset.description}</p>
                          {asset.prompt && (
                            <p className="text-xs text-muted-foreground bg-muted/20 rounded px-2 py-1.5 mb-2 line-clamp-2">
                              Prompt: {asset.prompt}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {asset.visualSource === "product_image" ? "📷 商品原图" : asset.visualSource === "ai_generate" ? "✨ AI 生成" : "📁 用户上传"}
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
                              <img src={asset.thumbnailUrl} alt="素材预览" className="w-full h-full object-cover" />
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
                              disabled={asset.status === "generating"}
                              onClick={() => generateOne(asset.shotId)}
                            >
                              {asset.status === "generating"
                                ? "生成中..."
                                : asset.status === "done"
                                ? "重新生成"
                                : asset.status === "failed"
                                ? "重试"
                                : "生成素材"}
                            </Button>
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
                  下一步：合成视频
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
