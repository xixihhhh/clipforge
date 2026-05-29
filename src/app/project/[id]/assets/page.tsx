"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { LuArrowLeft, LuZap, LuCheck, LuCircleX, LuImage, LuArrowRight } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Shot } from "@/lib/db/schema";

// 素材项
interface AssetItem {
  shotId: number;
  type: Shot["type"];
  duration: number;
  description: string;
  prompt: string;
  visualSource: "ai_generate" | "product_image" | "user_upload";
  status: "pending" | "generating" | "done" | "failed";
  thumbnailUrl?: string;
}

// 模拟脚本分镜数据
const initialAssets: AssetItem[] = [
  { shotId: 1, type: "hook", duration: 3, description: "手持手机第一人称视角，快步走进房间", prompt: "First person POV walking into a bright modern room, slightly shaky handheld camera, cinematic", visualSource: "ai_generate", status: "pending" },
  { shotId: 2, type: "pain_point", duration: 4, description: "桌上一堆廉价纸巾碎屑，手拿普通纸巾沾水后碎裂", prompt: "Close-up overhead shot of cheap tissue paper disintegrating in water on a clean white table", visualSource: "ai_generate", status: "pending" },
  { shotId: 3, type: "product_reveal", duration: 3, description: "德宝纸巾包装正面特写，缓慢推进", prompt: "", visualSource: "product_image", status: "done", thumbnailUrl: "" },
  { shotId: 4, type: "demo", duration: 5, description: "手拿德宝纸巾浸入水中，拉扯展示韧性", prompt: "Hands holding premium tissue paper submerged in clear water, pulling and stretching to show strength", visualSource: "ai_generate", status: "pending" },
  { shotId: 5, type: "cta", duration: 3, description: "商品包装+价格标签+购物车图标", prompt: "", visualSource: "product_image", status: "done", thumbnailUrl: "" },
];

// 镜头类型标签
const shotTypeLabels: Record<Shot["type"], { label: string; color: string }> = {
  hook: { label: "钩子", color: "bg-red-500/20 text-red-400" },
  pain_point: { label: "痛点", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { label: "产品", color: "bg-blue-500/20 text-blue-400" },
  demo: { label: "演示", color: "bg-green-500/20 text-green-400" },
  social_proof: { label: "背书", color: "bg-purple-500/20 text-purple-400" },
  cta: { label: "转化", color: "bg-amber-500/20 text-amber-400" },
};

export default function AssetsPage() {
  const { id } = useParams<{ id: string }>();
  const [assets, setAssets] = useState<AssetItem[]>(initialAssets);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);

  const doneCount = assets.filter((a) => a.status === "done").length;
  const allDone = doneCount === assets.length;

  // 模拟生成单个素材
  const generateOne = useCallback((shotId: number) => {
    setAssets((prev) =>
      prev.map((a) => (a.shotId === shotId ? { ...a, status: "generating" as const } : a))
    );
    // 模拟 2-4 秒延迟
    const delay = 2000 + Math.random() * 2000;
    setTimeout(() => {
      setAssets((prev) =>
        prev.map((a) =>
          a.shotId === shotId
            ? { ...a, status: "done" as const, thumbnailUrl: "" }
            : a
        )
      );
    }, delay);
  }, []);

  // 一键全部生成
  const generateAll = useCallback(() => {
    const pending = assets.filter((a) => a.status === "pending" || a.status === "failed");
    // 没有待生成的素材时直接返回，避免 isBatchGenerating 状态无法恢复
    if (pending.length === 0) return;
    setIsBatchGenerating(true);
    pending.forEach((asset, index) => {
      setTimeout(() => {
        generateOne(asset.shotId);
        if (index === pending.length - 1) {
          setTimeout(() => setIsBatchGenerating(false), 3000);
        }
      }, index * 1200);
    });
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
              <span className="text-lg font-bold tracking-tight">萌萌的</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">Tempo 德宝纸巾推广</span>
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
              {doneCount}/{assets.length} 个素材已就绪
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
              disabled={isBatchGenerating || allDone}
              className="brand-gradient text-white text-xs"
            >
              {isBatchGenerating ? (
                <>
                  <svg className="animate-spin mr-1.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
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

        {/* 进度条 */}
        <div className="mb-6">
          <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full brand-gradient transition-all duration-700 rounded-full"
              style={{ width: `${(doneCount / assets.length) * 100}%` }}
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
                    </div>

                    {/* 右侧预览+操作 */}
                    <div className="flex flex-col items-center justify-center gap-2 p-4 shrink-0">
                      {/* 缩略图区域 */}
                      <div className="w-24 h-16 bg-muted/30 rounded-md flex items-center justify-center border border-border/30 overflow-hidden">
                        {asset.status === "done" ? (
                          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                            <LuCheck className="w-5 h-5 text-primary" />
                          </div>
                        ) : asset.status === "generating" ? (
                          <svg className="animate-spin h-5 w-5 text-primary" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : asset.status === "failed" ? (
                          <LuCircleX className="w-5 h-5 text-destructive" />
                        ) : (
                          <LuImage className="w-4 h-4 text-muted-foreground/40" />
                        )}
                      </div>

                      {/* 操作按钮 */}
                      {asset.visualSource === "ai_generate" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs w-24"
                          disabled={asset.status === "generating"}
                          onClick={() => generateOne(asset.shotId)}
                        >
                          {asset.status === "generating" ? (
                            "生成中..."
                          ) : asset.status === "done" ? (
                            "重新生成"
                          ) : asset.status === "failed" ? (
                            "重试"
                          ) : (
                            "生成素材"
                          )}
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
            <Button
              className="brand-gradient text-white text-sm"
              disabled={!allDone}
            >
              下一步：合成视频
              <LuArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
