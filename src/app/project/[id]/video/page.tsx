"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {LuArrowLeft, LuPlay, LuChevronDown, LuArrowRight} from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Shot } from "@/lib/db/schema";

// 视频片段
interface VideoClipItem {
  shotId: number;
  type: Shot["type"];
  duration: number;
  voiceover: string;
  transition: "ai_start_end" | "ai_reference" | "direct_concat" | "ffmpeg_fade";
}

// 合成配置
interface ComposeConfig {
  ttsEnabled: boolean;
  ttsVoice: string;
  bgm: string;
  subtitleSize: number;
  subtitlePosition: "bottom" | "center" | "top";
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p" | "1080p";
}

// 转场标签
const transitionLabels: Record<string, string> = {
  ai_start_end: "AI 智能过渡",
  ai_reference: "AI 参考过渡",
  direct_concat: "直接拼接",
  ffmpeg_fade: "渐变过渡",
};

// 镜头类型标签
const shotTypeLabels: Record<Shot["type"], { label: string; color: string }> = {
  hook: { label: "钩子", color: "bg-red-500/20 text-red-400" },
  pain_point: { label: "痛点", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { label: "产品", color: "bg-blue-500/20 text-blue-400" },
  demo: { label: "演示", color: "bg-green-500/20 text-green-400" },
  social_proof: { label: "背书", color: "bg-purple-500/20 text-purple-400" },
  cta: { label: "转化", color: "bg-amber-500/20 text-amber-400" },
};

// 模拟视频片段数据
const initialClips: VideoClipItem[] = [
  { shotId: 1, type: "hook", duration: 3, voiceover: "你还在用一擦就烂的纸巾？", transition: "ai_start_end" },
  { shotId: 2, type: "pain_point", duration: 4, voiceover: "普通纸巾一沾水就烂，擦个嘴满脸纸屑", transition: "ai_start_end" },
  { shotId: 3, type: "product_reveal", duration: 3, voiceover: "直到我发现了德宝", transition: "ai_start_end" },
  { shotId: 4, type: "demo", duration: 5, voiceover: "湿水都不破！拉扯都不会烂", transition: "ai_start_end" },
  { shotId: 5, type: "cta", duration: 3, voiceover: "限时特价！赶紧去抢！", transition: "direct_concat" },
];

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const [clips, setClips] = useState<VideoClipItem[]>(initialClips);
  const [config, setConfig] = useState<ComposeConfig>({
    ttsEnabled: true,
    ttsVoice: "female-gentle",
    bgm: "upbeat",
    subtitleSize: 24,
    subtitlePosition: "bottom",
    aspectRatio: "9:16",
    resolution: "1080p",
  });

  // 合成状态
  const [isComposing, setIsComposing] = useState(false);
  const [composeProgress, setComposeProgress] = useState(0);
  const [composeDone, setComposeDone] = useState(false);

  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);

  // 更新片段转场
  const updateTransition = (shotId: number, transition: string) => {
    setClips((prev) =>
      prev.map((c) =>
        c.shotId === shotId ? { ...c, transition: transition as VideoClipItem["transition"] } : c
      )
    );
  };

  // 模拟合成过程
  const startCompose = () => {
    setIsComposing(true);
    setComposeProgress(0);

    const interval = setInterval(() => {
      setComposeProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsComposing(false);
          setComposeDone(true);
          return 100;
        }
        return prev + 2;
      });
    }, 100);
  };

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
                <div className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${i === 2 ? "bg-primary text-primary-foreground" : i < 2 ? "text-primary" : "text-muted-foreground"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${i === 2 ? "bg-white/20" : i < 2 ? "bg-primary/20" : "bg-muted"}`}>
                    {i < 2 ? "✓" : i + 1}
                  </span>
                  {step}
                </div>
                {i < 3 && <div className="mx-1 h-px w-4 bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：视频时间线 */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold">视频时间线</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{clips.length} 个片段 · 总时长 {totalDuration}s</p>
              </div>
              <Link href={`/project/${id}/assets`}>
                <Button variant="outline" size="sm" className="text-xs">
                  <LuArrowLeft className="w-3.5 h-3.5 mr-1" />
                  返回素材
                </Button>
              </Link>
            </div>

            <div className="space-y-1">
              {clips.map((clip, index) => {
                const typeInfo = shotTypeLabels[clip.type];
                return (
                  <div key={clip.shotId}>
                    {/* 片段卡片 */}
                    <Card className="glass-card">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          {/* 缩略图 */}
                          <div className="w-20 h-14 bg-muted/30 rounded-md shrink-0 flex items-center justify-center border border-border/30">
                            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 rounded-md flex items-center justify-center">
                              <LuPlay className="w-4 h-4 text-primary/60" />
                            </div>
                          </div>

                          {/* 信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={`${typeInfo.color} border-0 text-[10px]`}>
                                {typeInfo.label}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{clip.duration}s</span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              🎙 {clip.voiceover}
                            </p>
                          </div>

                          {/* 序号 */}
                          <span className="text-sm font-bold text-muted-foreground/30 shrink-0">
                            {String(clip.shotId).padStart(2, "0")}
                          </span>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 转场选择器（最后一个片段后面不显示） */}
                    {index < clips.length - 1 && (
                      <div className="flex items-center justify-center py-1.5">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/20 border border-border/30">
                          <LuChevronDown className="w-3 h-3 text-muted-foreground" />
                          <select
                            value={clip.transition}
                            onChange={(e) => updateTransition(clip.shotId, e.target.value)}
                            className="text-[11px] text-muted-foreground bg-transparent border-none outline-none cursor-pointer"
                          >
                            <option value="ai_start_end">{transitionLabels.ai_start_end}</option>
                            <option value="ai_reference">{transitionLabels.ai_reference}</option>
                            <option value="direct_concat">{transitionLabels.direct_concat}</option>
                            <option value="ffmpeg_fade">{transitionLabels.ffmpeg_fade}</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右侧：合成配置 */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-base font-semibold">合成设置</h2>

            {/* 配音设置 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-4">
                <Label className="text-sm font-medium">配音 (TTS)</Label>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">启用自动配音</span>
                  <button
                    onClick={() => setConfig((c) => ({ ...c, ttsEnabled: !c.ttsEnabled }))}
                    className={`relative w-10 h-5 rounded-full transition-colors ${config.ttsEnabled ? "bg-primary" : "bg-muted"}`}
                  >
                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${config.ttsEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                {config.ttsEnabled && (
                  <Select value={config.ttsVoice} onValueChange={(v) => setConfig((c) => ({ ...c, ttsVoice: v ?? c.ttsVoice }))}>
                    <SelectTrigger className="bg-muted/30 border-border/50 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female-gentle">女声 - 温柔</SelectItem>
                      <SelectItem value="female-energetic">女声 - 活力</SelectItem>
                      <SelectItem value="male-warm">男声 - 温暖</SelectItem>
                      <SelectItem value="male-pro">男声 - 专业</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </CardContent>
            </Card>

            {/* 背景音乐 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-3">
                <Label className="text-sm font-medium">背景音乐</Label>
                <Select value={config.bgm} onValueChange={(v) => setConfig((c) => ({ ...c, bgm: v ?? c.bgm }))}>
                  <SelectTrigger className="bg-muted/30 border-border/50 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">无背景音乐</SelectItem>
                    <SelectItem value="upbeat">轻快节奏</SelectItem>
                    <SelectItem value="chill">舒缓放松</SelectItem>
                    <SelectItem value="energetic">动感活力</SelectItem>
                    <SelectItem value="emotional">情感温暖</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* 字幕设置 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-3">
                <Label className="text-sm font-medium">字幕</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["bottom", "center", "top"] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setConfig((c) => ({ ...c, subtitlePosition: pos }))}
                      className={`h-9 rounded-md text-xs border transition-all ${
                        config.subtitlePosition === pos
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {pos === "bottom" ? "底部" : pos === "center" ? "居中" : "顶部"}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 画面设置 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-4">
                <Label className="text-sm font-medium">画面设置</Label>
                {/* 比例 */}
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">画面比例</span>
                  <div className="grid grid-cols-3 gap-2">
                    {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                      <button
                        key={ratio}
                        onClick={() => setConfig((c) => ({ ...c, aspectRatio: ratio }))}
                        className={`h-9 rounded-md text-xs border transition-all ${
                          config.aspectRatio === ratio
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {ratio === "9:16" ? "竖屏" : ratio === "16:9" ? "横屏" : "方形"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 分辨率 */}
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">分辨率</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["720p", "1080p"] as const).map((res) => (
                      <button
                        key={res}
                        onClick={() => setConfig((c) => ({ ...c, resolution: res }))}
                        className={`h-9 rounded-md text-xs border transition-all ${
                          config.resolution === res
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 合成按钮 */}
            <div className="space-y-3">
              {/* 合成进度 */}
              {(isComposing || composeDone) && (
                <div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${composeDone ? "bg-emerald-500" : "brand-gradient"}`}
                      style={{ width: `${composeProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    {composeDone ? "合成完成！" : `正在合成视频... ${composeProgress}%`}
                  </p>
                </div>
              )}

              <Button
                onClick={startCompose}
                disabled={isComposing}
                className="w-full brand-gradient text-white"
              >
                {isComposing ? (
                  <>
                    <svg className="animate-spin mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    合成中...
                  </>
                ) : composeDone ? (
                  "重新合成"
                ) : (
                  <>
                    <LuPlay className="w-4 h-4 mr-1" />
                    开始合成
                  </>
                )}
              </Button>

              {composeDone && (
                <Link href={`/project/${id}/export`}>
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                    下一步：导出视频
                    <LuArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
