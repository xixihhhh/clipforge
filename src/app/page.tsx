"use client";

import { useState, useEffect } from "react";
import { LuSettings, LuPlus, LuZap, LuVideo, LuFilm, LuPackage, LuTriangleAlert, LuLoaderCircle } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { exampleShowcase } from "@/lib/examples";

// 首页项目列表项（来自 GET /api/project，updatedAt 经 JSON 序列化为字符串）
interface ProjectItem {
  id: string;
  name: string;
  productName: string | null;
  status: string;
  updatedAt: string | null;
}

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "bg-zinc-500/20 text-zinc-400" },
  scripting: { label: "脚本中", color: "bg-blue-500/20 text-blue-400" },
  assets: { label: "素材中", color: "bg-purple-500/20 text-purple-400" },
  video: { label: "生成中", color: "bg-amber-500/20 text-amber-400" },
  composing: { label: "合成中", color: "bg-cyan-500/20 text-cyan-400" },
  done: { label: "已完成", color: "bg-emerald-500/20 text-emerald-400" },
};

export default function HomePage() {
  // 拉取真实项目列表（修复 issue #3：旧版写死 mock，用户创建后回首页永远找不到自己的项目）
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/project");
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setProjects(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 检查是否已配置 API 服务
  const { llm, providers } = useSettingsStore();
  const isConfigured = llm.apiKey.length > 0;
  const hasAnyProvider = Object.values(providers).some(p => p.enabled && p.apiKey.length > 0);

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">带货剪手</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/products">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <LuPackage className="w-4 h-4" />
                <span className="ml-1.5">商品库</span>
              </Button>
            </Link>
            <Link href="/settings">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <LuSettings className="w-4 h-4" />
                <span className="ml-1.5">设置</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Hero */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="brand-gradient-text">AI 驱动</span>的电商带货视频
          </h1>
          <p className="text-muted-foreground text-base">
            上传商品图，AI 生成脚本，一键产出高转化带货短视频
          </p>
        </div>

        {/* 未配置 API 时的引导横幅 */}
        {!isConfigured && (
          <Link href="/settings">
            <div className="mb-8 p-5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-4 cursor-pointer hover:bg-amber-100 transition-colors">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <LuTriangleAlert className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-amber-900 text-sm">首次使用？先配置 AI 服务</h3>
                <p className="text-xs text-amber-700 mt-1">
                  需要配置 LLM（用于生成脚本）和至少一个 AI 平台（用于生成图片/视频）才能开始使用。
                  <span className="underline ml-1">点击前往设置 →</span>
                </p>
              </div>
            </div>
          </Link>
        )}

        {/* 三个核心入口 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {/* 卡片1：新建带货视频 */}
          <Link href="/project/new">
            <Card className="card-hover glass-card cursor-pointer group h-full">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl brand-gradient shadow-lg group-hover:scale-105 transition-transform">
                    <LuPlus className="w-[22px] h-[22px] text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1">新建带货视频</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      上传 1-5 张商品图 → AI 自动分析卖点 → 生成 3 套专业脚本 → 逐镜头生成素材 → 合成完整视频
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Badge variant="secondary" className="text-xs">AI 脚本</Badge>
                  <Badge variant="secondary" className="text-xs">分镜生图</Badge>
                  <Badge variant="secondary" className="text-xs">AI 生视频</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* 卡片2：商品库 */}
          <Link href="/products">
            <Card className="card-hover glass-card cursor-pointer group h-full">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg group-hover:scale-105 transition-transform">
                    <LuPackage className="w-[22px] h-[22px] text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1">商品库</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      录入商品信息（名称/图片/卖点），同一商品可反复生成不同风格的视频，大促前批量出片必备
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Badge variant="secondary" className="text-xs">录入一次</Badge>
                  <Badge variant="secondary" className="text-xs">反复使用</Badge>
                  <Badge variant="secondary" className="text-xs">批量出片</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* 卡片3：爆款复刻 */}
          <Link href="/project/clone">
            <Card className="card-hover glass-card cursor-pointer group h-full">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg group-hover:scale-105 transition-transform">
                    <LuZap className="w-[22px] h-[22px] text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1">爆款复刻</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      粘贴抖音/快手/小红书爆款视频链接 → AI 自动拆解脚本逻辑和分镜结构 → 用你的商品替换重新生成同款视频
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Badge variant="secondary" className="text-xs">智能提取</Badge>
                  <Badge variant="secondary" className="text-xs">脚本复刻</Badge>
                  <Badge variant="secondary" className="text-xs">一键换品</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* 快速了解：使用流程步骤条 */}
        <div className="mb-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">1</span>上传商品图</span>
          <span className="text-border">→</span>
          <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">2</span>AI 生成脚本</span>
          <span className="text-border">→</span>
          <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">3</span>生成素材</span>
          <span className="text-border">→</span>
          <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">4</span>合成视频</span>
          <span className="text-border">→</span>
          <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">5</span>导出发布</span>
        </div>

        {/* 项目列表 */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold">我的项目</h2>
            <span className="text-sm text-muted-foreground">{projects.length} 个项目</span>
          </div>

          {loadingProjects ? (
            <Card className="glass-card">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <LuLoaderCircle className="w-7 h-7 text-muted-foreground animate-spin mb-3" />
                <p className="text-muted-foreground text-sm">正在加载项目...</p>
              </CardContent>
            </Card>
          ) : projects.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                  <LuVideo className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground mb-4">还没有项目，开始创建你的第一个带货视频吧</p>
                <Link href="/project/new">
                  <Button className="brand-gradient text-white">创建项目</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => {
                const status = statusMap[project.status] ?? statusMap.draft;
                const dateStr = project.updatedAt
                  ? new Date(project.updatedAt).toLocaleDateString("zh-CN")
                  : "";
                return (
                  <Link key={project.id} href={`/project/${project.id}/script`}>
                    <Card className="card-hover glass-card cursor-pointer group">
                      <CardContent className="p-0">
                        <div className="relative aspect-video bg-muted/30 rounded-t-lg overflow-hidden">
                          <div className="absolute inset-0 flex items-center justify-center">
                            <LuFilm className="w-8 h-8 text-muted-foreground/50" />
                          </div>
                          <div className="absolute top-2 right-2">
                            <Badge className={`${status.color} border-0 text-xs`}>
                              {status.label}
                            </Badge>
                          </div>
                        </div>
                        <div className="p-4">
                          <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {project.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            {project.productName || "未命名商品"}{dateStr ? ` · ${dateStr}` : ""}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* 示例作品（与「我的项目」分离，明确标注示例，帮助新手理解能做出什么） */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">示例作品</h2>
              <Badge variant="secondary" className="text-[10px]">示例</Badge>
            </div>
            <span className="text-sm text-muted-foreground">看看能做出什么</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link href="/examples/showcase">
              <Card className="card-hover glass-card cursor-pointer group">
                <CardContent className="p-0">
                  <div className="relative aspect-video bg-muted/30 rounded-t-lg overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={exampleShowcase.cover} alt={exampleShowcase.title} className="h-full w-full object-cover" />
                    <div className="absolute top-2 left-2">
                      <Badge className="bg-black/60 text-white border-0 text-xs">示例</Badge>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/20 transition-colors">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm border border-white/30">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white" className="ml-0.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                      {exampleShowcase.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {exampleShowcase.styleLabel} · {exampleShowcase.shots.length} 个镜头 · {exampleShowcase.totalDuration}s
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
