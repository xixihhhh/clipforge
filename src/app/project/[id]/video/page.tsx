"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { LuArrowLeft, LuPlay, LuChevronDown, LuArrowRight, LuLoaderCircle } from "react-icons/lu";
import { useSettingsStore } from "@/lib/stores/settings-store";
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

interface DbShot {
  shotId: number;
  type: VideoClipItem["type"];
  duration: number;
  voiceover: string;
  transition: VideoClipItem["transition"];
}

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const { defaultResolution, defaultAspectRatio, tts } = useSettingsStore();
  const [clips, setClips] = useState<VideoClipItem[]>([]);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [composeError, setComposeError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  // 背景音乐
  const [bgm, setBgm] = useState<{ path: string; name: string } | null>(null);
  const [bgmUploading, setBgmUploading] = useState(false);
  const uploadBgm = async (file: File) => {
    setBgmUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/project/${id}/bgm`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上传失败");
      setBgm({ path: data.path, name: data.name });
    } catch {
      setBgm(null);
    } finally {
      setBgmUploading(false);
    }
  };

  // 载入真实分镜（已选脚本）+ 项目名 + 默认画面设置
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
        if (project) setProjectName(project.name ?? project.productName ?? "");
        const selected = Array.isArray(scripts)
          ? scripts.find((s: { selected?: boolean }) => s.selected) ?? scripts[0]
          : null;
        if (!selected || !Array.isArray(selected.shots) || selected.shots.length === 0) {
          setLoadError("尚未生成脚本，请先完成脚本与素材步骤");
          setClips([]);
        } else {
          setClips(
            (selected.shots as DbShot[]).map((s) => ({
              shotId: s.shotId,
              type: s.type,
              duration: s.duration,
              voiceover: s.voiceover ?? "",
              transition: s.transition ?? "ai_start_end",
            }))
          );
        }
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

  // 用设置里的默认分辨率/比例初始化一次
  useEffect(() => {
    setConfig((c) => ({ ...c, resolution: defaultResolution, aspectRatio: defaultAspectRatio }));
  }, [defaultResolution, defaultAspectRatio]);

  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);

  // 更新片段转场
  const updateTransition = (shotId: number, transition: string) => {
    setClips((prev) =>
      prev.map((c) =>
        c.shotId === shotId ? { ...c, transition: transition as VideoClipItem["transition"] } : c
      )
    );
  };

  // 真实合成：调用 compose API 跑 FFmpeg，配乐观进度动画，完成后拿到真实 mp4
  const startCompose = async () => {
    setIsComposing(true);
    setComposeError(null);
    setComposeDone(false);
    setOutputUrl(null);
    setComposeProgress(0);

    // 乐观进度：先爬到 90%，等真实结果回来再到 100%
    const timer = setInterval(() => {
      setComposeProgress((prev) => (prev >= 90 ? 90 : prev + 3));
    }, 200);

    try {
      // 提交合成任务（后台异步），随后轮询状态
      const res = await fetch(`/api/project/${id}/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution: config.resolution,
          aspectRatio: config.aspectRatio,
          ...(bgm?.path && { bgmPath: bgm.path }),
          // 开启 TTS 时带上配音配置，合成会为每个分镜生成口播音轨
          ...(tts.enabled && tts.apiKey && tts.model && tts.voice && {
            ttsConfig: {
              baseUrl: tts.baseUrl,
              apiKey: tts.apiKey,
              model: tts.model,
              voice: tts.voice,
              speed: tts.speed,
            },
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "合成失败");

      // 轮询合成状态，直到 done / failed（后台任务，避免长视频请求超时）
      const url: string = await new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const r = await fetch(`/api/project/${id}/compose`);
            const d = await r.json();
            const c = d.composition;
            if (!c) return;
            if (c.status === "done" && c.url) {
              clearInterval(poll);
              resolve(c.url);
            } else if (c.status === "failed") {
              clearInterval(poll);
              reject(new Error("合成失败，请检查素材后重试"));
            }
          } catch {
            // 单次轮询失败忽略，继续重试
          }
        }, 3000);
        // 兜底超时：5 分钟
        setTimeout(() => {
          clearInterval(poll);
          reject(new Error("合成超时，请稍后在导出页查看"));
        }, 300000);
      });

      clearInterval(timer);
      setComposeProgress(100);
      setOutputUrl(url);
      setComposeDone(true);
    } catch (e) {
      clearInterval(timer);
      setComposeError(e instanceof Error ? e.message : "合成失败");
      setComposeProgress(0);
    } finally {
      setIsComposing(false);
    }
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
              <span className="text-lg font-bold tracking-tight">带货剪手</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">{projectName || "带货项目"}</span>
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
              {/* 背景音乐（可选，合成时混入并自动压低让位配音） */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/10">
                <div className="min-w-0">
                  <p className="text-xs font-medium">背景音乐（可选）</p>
                  <p className="text-[11px] text-muted-foreground truncate">{bgm ? `已选：${bgm.name}` : "上传 mp3，合成时自动压低让位配音"}</p>
                </div>
                <label className="shrink-0">
                  <input type="file" accept="audio/*" className="hidden" disabled={isComposing || bgmUploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBgm(f); e.target.value = ""; }} />
                  <span className={`inline-flex items-center h-8 px-3 rounded-md border border-border/60 text-xs cursor-pointer hover:border-primary/50 ${(isComposing || bgmUploading) ? "opacity-50 pointer-events-none" : ""}`}>
                    {bgmUploading ? "上传中..." : bgm ? "更换" : "上传 BGM"}
                  </span>
                </label>
              </div>

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

              {/* 合成失败提示 */}
              {composeError && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="text-xs text-destructive">⚠ {composeError}</p>
                </div>
              )}

              {/* 成片预览 */}
              {composeDone && outputUrl && (
                <div className="rounded-lg overflow-hidden border border-border/50 bg-black">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={outputUrl} controls className="w-full max-h-[360px]" />
                </div>
              )}

              <Button
                onClick={startCompose}
                disabled={isComposing || clips.length === 0}
                className="w-full brand-gradient text-white"
              >
                {isComposing ? (
                  <>
                    <LuLoaderCircle className="animate-spin mr-2 h-4 w-4" />
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

              {composeDone && outputUrl && (
                <>
                  <a href={`${outputUrl}?download=1`} download>
                    <Button variant="outline" className="w-full">下载视频</Button>
                  </a>
                  <Link href={`/project/${id}/export`}>
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                      下一步：导出视频
                      <LuArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
