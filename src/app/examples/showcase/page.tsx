"use client";

import Link from "next/link";
import { LuArrowLeft, LuPlus } from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exampleShowcase, exampleTemplates } from "@/lib/examples";
import type { Shot } from "@/lib/db/schema";
import { useT } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";

// 镜头类型标签（label 走 showcase 命名空间词条 key，按语言取）
const shotTypeLabels: Record<Shot["type"], { labelKey: string; color: string }> = {
  hook: { labelKey: "shotTypeHook", color: "bg-red-500/20 text-red-400" },
  pain_point: { labelKey: "shotTypePainPoint", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { labelKey: "shotTypeProductReveal", color: "bg-blue-500/20 text-blue-400" },
  demo: { labelKey: "shotTypeDemo", color: "bg-green-500/20 text-green-400" },
  social_proof: { labelKey: "shotTypeSocialProof", color: "bg-purple-500/20 text-purple-400" },
  cta: { labelKey: "shotTypeCta", color: "bg-amber-500/20 text-amber-400" },
};

export default function ShowcasePage() {
  const t = useT("showcase");
  const tc = useT("common");
  const sc = exampleShowcase;

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2">
                <LuArrowLeft className="w-4 h-4" />
                <span className="ml-1">{tc("back")}</span>
              </Button>
            </Link>
            <div className="h-5 w-px bg-border/50" />
            <span className="text-sm font-semibold">{t("navTitle")}</span>
            <Badge variant="secondary" className="text-[10px]">{t("navBadge")}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <Link href="/project/new">
              <Button size="sm" className="brand-gradient text-white">
                <LuPlus className="w-4 h-4 mr-1" />
                {t("makeSimilar")}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* 说明 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight mb-2">{sc.title}</h1>
          <p className="text-sm text-muted-foreground">
            {t("introLead")}{t("introMeta", { style: sc.styleLabel, shots: sc.shots.length, duration: sc.totalDuration, resolution: sc.resolution, aspectRatio: sc.aspectRatio })}
            {t("introTail")}
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
            <h2 className="text-base font-semibold mb-4">{t("scriptTitle")}</h2>
            <div className="space-y-3">
              {sc.shots.map((shot, idx) => {
                // 纯计算累计时间，避免渲染期改写外层变量
                const start = sc.shots.slice(0, idx).reduce((s, sh) => s + sh.duration, 0);
                const end = start + shot.duration;
                const meta = shotTypeLabels[shot.type];
                return (
                  <div key={shot.shotId} className="rounded-lg border border-border/50 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-muted-foreground">{String(idx + 1).padStart(2, "0")}</span>
                      <Badge className={`${meta.color} border-0 text-[10px]`}>{t(meta.labelKey)}</Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">{start}-{end}s</Badge>
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
            <h2 className="text-base font-semibold">{t("templatesTitle")}</h2>
            <Badge variant="secondary" className="text-[10px]">{t("templatesBadge")}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4">{t("templatesDesc")}</p>
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
                        {t(shotTypeLabels[s.type].labelKey)}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">{t("templateShotsMeta", { shots: tpl.shots.length, duration: tpl.totalDuration })}</p>
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
              {t("bottomCta")}
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
