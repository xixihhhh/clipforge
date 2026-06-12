"use client";

import Link from "next/link";
import { LuArrowLeft, LuPlus } from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exampleShowcase, exampleTemplates } from "@/lib/examples";
import type { Shot } from "@/lib/db/schema";

// 镜头类型标签
const shotTypeLabels: Record<Shot["type"], { label: string; color: string }> = {
  hook: { label: "钩子", color: "bg-red-500/20 text-red-400" },
  pain_point: { label: "痛点", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { label: "产品", color: "bg-blue-500/20 text-blue-400" },
  demo: { label: "演示", color: "bg-green-500/20 text-green-400" },
  social_proof: { label: "背书", color: "bg-purple-500/20 text-purple-400" },
  cta: { label: "转化", color: "bg-amber-500/20 text-amber-400" },
};

export default function ShowcasePage() {
  const sc = exampleShowcase;
  let acc = 0;

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2">
                <LuArrowLeft className="w-4 h-4" />
                <span className="ml-1">返回</span>
              </Button>
            </Link>
            <div className="h-5 w-px bg-border/50" />
            <span className="text-sm font-semibold">示例作品</span>
            <Badge variant="secondary" className="text-[10px]">示例</Badge>
          </div>
          <Link href="/project/new">
            <Button size="sm" className="brand-gradient text-white">
              <LuPlus className="w-4 h-4 mr-1" />
              做一个同款
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* 说明 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight mb-2">{sc.title}</h1>
          <p className="text-sm text-muted-foreground">
            这是一个用「带货剪手」完整生成的示例：{sc.styleLabel} · {sc.shots.length} 个镜头 · {sc.totalDuration}s · {sc.resolution} {sc.aspectRatio}。
            下方是成片预览和分镜脚本，你可以照着做一个自己的。
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* 左：成片预览 */}
          <div className="lg:col-span-2">
            <Card className="glass-card neon-glow overflow-hidden">
              <CardContent className="p-0">
                <div className="relative aspect-[9/16] bg-black flex items-center justify-center">
                  <video
                    src={sc.videoUrl}
                    poster={sc.cover}
                    controls
                    playsInline
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="px-4 py-3 border-t border-border/30 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{sc.resolution}</span>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span>{sc.aspectRatio}</span>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span>{sc.totalDuration}s</span>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span>MP4</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 右：分镜脚本 */}
          <div className="lg:col-span-3">
            <h2 className="text-base font-semibold mb-4">分镜脚本</h2>
            <div className="space-y-3">
              {sc.shots.map((shot, idx) => {
                const start = acc;
                acc += shot.duration;
                const t = shotTypeLabels[shot.type];
                return (
                  <div key={shot.shotId} className="rounded-lg border border-border/50 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-muted-foreground">{String(idx + 1).padStart(2, "0")}</span>
                      <Badge className={`${t.color} border-0 text-[10px]`}>{t.label}</Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">{start}-{acc}s</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">{shot.camera}</span>
                    </div>
                    <p className="text-sm mb-1">{shot.description}</p>
                    {shot.voiceover && (
                      <p className="text-xs text-muted-foreground">🎙 {shot.voiceover}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 参考脚本结构 */}
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-semibold">更多爆款结构参考</h2>
            <Badge variant="secondary" className="text-[10px]">模板</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4">这些是高转化带货视频的常见结构，做项目时可以照着选风格。</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {exampleTemplates.map((tpl) => (
              <Card key={tpl.id} className="glass-card">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">{tpl.name}</h3>
                    <Badge variant="secondary" className="text-[10px]">{tpl.styleLabel}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{tpl.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {tpl.shots.map((s) => (
                      <Badge key={s.shotId} className={`${shotTypeLabels[s.type].color} border-0 text-[10px]`}>
                        {shotTypeLabels[s.type].label}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">{tpl.shots.length} 镜头 · {tpl.totalDuration}s</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 底部 CTA */}
        <div className="mt-12 flex justify-center">
          <Link href="/project/new">
            <Button size="lg" className="brand-gradient text-white px-10">
              <LuPlus className="w-5 h-5 mr-2" />
              试着做一个自己的
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
