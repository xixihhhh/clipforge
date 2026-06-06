"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {LuArrowLeft, LuPlay, LuChevronDown, LuArrowRight, LuLoader, LuExternalLink, LuDownload} from "react-icons/lu";
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
  url?: string;
  status?: "pending" | "generating" | "done" | "failed";
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

// 备用视频片段数据
const fallbackClips: VideoClipItem[] = [
  { shotId: 1, type: "hook", duration: 3, voiceover: "吸引眼球的开场", transition: "ai_start_end" },
  { shotId: 2, type: "pain_point", duration: 4, voiceover: "痛点描述", transition: "ai_start_end" },
  { shotId: 3, type: "product_reveal", duration: 3, voiceover: "产品展示", transition: "ai_start_end" },
  { shotId: 4, type: "demo", duration: 5, voiceover: "使用演示", transition: "ai_start_end" },
  { shotId: 5, type: "cta", duration: 3, voiceover: "引导下单", transition: "direct_concat" },
];

// 从 sessionStorage 读取脚本数据并转换为 VideoClipItem 数组
function getClipsFromSessionStorage(id: string): VideoClipItem[] | null {
  try {
    if (typeof window === "undefined") return null;
    const stored = sessionStorage.getItem(`scripts_${id}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    let shots: any[] = [];
    if (Array.isArray(parsed)) {
      const first = parsed[0];
      if (first.shots) shots = first.shots;
      else shots = parsed;
    } else if (parsed.shots) {
      shots = parsed.shots;
    }
    if (!shots.length) return null;
    return shots.map((shot: any, index: number) => ({
      shotId: shot.shotId || index + 1,
      type: (shot.type as VideoClipItem["type"]) || "hook",
      duration: shot.duration || 3,
      voiceover: shot.voiceover || "",
      transition: "ai_start_end" as const,
      status: "pending" as const,
    }));
  } catch {
    return null;
  }
}

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const [clips, setClips] = useState<VideoClipItem[]>(() => {
    const stored = getClipsFromSessionStorage(id);
    return stored || fallbackClips;
  });
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
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const llm = useSettingsStore((s) => s.llm);

  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);

  // 更新片段转场
  const updateTransition = (shotId: number, transition: string) => {
    setClips((prev) =>
      prev.map((c) =>
        c.shotId === shotId ? { ...c, transition: transition as VideoClipItem["transition"] } : c
      )
    );
  };

  // 下载单个分镜视频
  const downloadSingleClip = async (clipUrl: string, shotId: number) => {
    try {
      const res = await fetch(clipUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shot_${String(shotId).padStart(2, "0")}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(clipUrl, "_blank");
    }
  };

  // 下载合成视频（所有分镜合成的完整视频）
  const [isDownloadingCompose, setIsDownloadingCompose] = useState(false);
  const downloadComposedVideo = async () => {
    const composedUrl = clips.find(c => c.status === 'done')?.url;
    if (!composedUrl) {
      alert('暂无合成视频');
      return;
    }
    setIsDownloadingCompose(true);
    try {
      const res = await fetch(composedUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `合成视频_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(composedUrl, '_blank');
    } finally {
      setIsDownloadingCompose(false);
    }
  };

  // 逐分镜生成视频
  const startCompose = async () => {
    if (!llm.apiKey) return;
    setIsComposing(true);
    setComposeProgress(0);

    try {
      const videoBaseUrl = (llm.baseUrl || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
      // 新接口 /agnesapi 固定使用根 URL，不走 /v1 前缀
      const queryBaseUrl = "https://apihub.agnes-ai.com";
      let completedCount = 0;

      // 逐个分镜生成
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipPrompt = clip.voiceover || `分镜 ${i + 1}`;

        // 标记当前分镜为生成中
        setClips((prev) =>
          prev.map((c) =>
            c.shotId === clip.shotId ? { ...c, status: "generating" as const } : c
          )
        );

        try {
          // 提交视频任务
          const submitRes = await fetch(`${videoBaseUrl}/videos`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${llm.apiKey}`,
            },
            body: JSON.stringify({
              model: "agnes-video-v2.0",
              prompt: clipPrompt,
              num_frames: 121,
              frame_rate: 24,
            }),
          });

          if (!submitRes.ok) {
            throw new Error(`提交失败 (${submitRes.status})`);
          }

          const submitData = await submitRes.json();
          const taskId = submitData.task_id || submitData.id;
          if (!taskId) throw new Error("未获取到任务ID");

          // 轮询等待结果 — 使用新 API 接口 /agnesapi?video_id=xxx
          const video_id = submitData.video_id || taskId;
          let retries = 180;
          let videoUrl = "";
          let lastStatus = "";

          while (retries > 0 && !videoUrl) {
            await new Promise((r) => setTimeout(r, 5000));
            retries--;

            // 新接口：不走 /v1 前缀，直接查询
            const pollUrl = `${queryBaseUrl}/agnesapi?video_id=${encodeURIComponent(video_id)}`;
            const pollRes = await fetch(pollUrl, {
              headers: { Authorization: `Bearer ${llm.apiKey}` },
            });

            if (!pollRes.ok) {
              console.warn("轮询失败", pollRes.status);
              continue;
            }

            const pollData = await pollRes.json();
            const status = pollData.status || "";
            const progress = pollData.progress || 0;

            // 更新当前分镜进度显示
            const progressText = status === "completed"
              ? "完成！"
              : status === "failed"
                ? "失败"
                : `生成中 ${progress}%`;

            setClips((prev) =>
              prev.map((c) =>
                c.shotId === clip.shotId
                  ? { ...c, status: status === "failed" ? "failed" : "generating" as const }
                  : c
              )
            );

            // 显示当前分镜进度
            setComposeProgress(Math.round((completedCount / clips.length) * 100) + Math.round((progress / clips.length)));

            if (status === "completed") {
              videoUrl = pollData.remixed_from_video_id || pollData.video_url || "";
              setClips((prev) =>
                prev.map((c) =>
                  c.shotId === clip.shotId
                    ? { ...c, url: videoUrl, status: "done" as const }
                    : c
                )
              );
              completedCount++;
              setComposeProgress(Math.round((completedCount / clips.length) * 100));
            } else if (status === "failed") {
              throw new Error(pollData.error || "视频生成失败");
            }
          }

          if (!videoUrl) {
            throw new Error("视频生成超时");
          }
        } catch (e: any) {
          // 单个分镜失败，标记失败但不中断整体流程
          const errMsg = e?.message || "生成失败";
          console.error(`分镜 ${i + 1} 生成失败:`, e);
          setComposeError(`分镜 ${i + 1} (${clip.voiceover?.slice(0, 20) || ''}...) 生成失败: ${errMsg}`);
          alert(`分镜 ${i + 1} 生成失败: ${errMsg}`);
          setClips((prev) =>
            prev.map((c) =>
              c.shotId === clip.shotId ? { ...c, status: "failed" as const } : c
            )
          );
          completedCount++;
          setComposeProgress(Math.round((completedCount / clips.length) * 100));
        }
      }

      // 全部完成
      setComposeProgress(100);
      setIsComposing(false);
      setComposeDone(true);
    } catch (e: any) {
      const errMsg = e?.message || "视频合成失败";
      console.error("视频合成失败:", e);
      setComposeError(errMsg);
      alert("视频合成失败:\n" + errMsg);
      setIsComposing(false);
      setComposeProgress(0);
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
              <span className="text-lg font-bold tracking-tight">萌萌的</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">通用品牌 通用商品推广</span>
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
                const typeInfo = shotTypeLabels[clip.type] || { label: "其他", color: "bg-gray-500/20 text-gray-400", bg: "bg-gray-500/20" };
                return (
                  <div key={clip.shotId}>
                    {/* 片段卡片 */}
                    <Card className="glass-card">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          {/* 缩略图/视频 */}
                          <div 
                            className="w-20 h-14 bg-muted/30 rounded-md shrink-0 flex items-center justify-center border border-border/30 overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
                            onClick={() => clip.url && setSelectedVideoUrl(clip.url)}
                          >
                            {clip.url ? (
                              <video src={clip.url} controls className="w-full h-full object-cover" />
                            ) : clip.status === "generating" ? (
                              <div className="w-full h-full bg-gradient-to-br from-amber-500/20 to-amber-500/5 rounded-md flex items-center justify-center">
                                <svg className="w-4 h-4 text-amber-500/60 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"/></svg>
                              </div>
                            ) : clip.status === "failed" ? (
                              <div className="w-full h-full bg-gradient-to-br from-red-500/20 to-red-500/5 rounded-md flex items-center justify-center">
                                <span className="text-red-500/60 text-xs font-bold">✗</span>
                              </div>
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 rounded-md flex items-center justify-center">
                                <LuPlay className="w-4 h-4 text-primary/60" />
                              </div>
                            )}
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

                          {/* 下载单个分镜按钮 */}
                          {clip.url && (
                            <button
                              className="p-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
                              onClick={() => downloadSingleClip(clip.url!, clip.shotId)}
                              title="下载此分镜视频"
                            >
                              <LuDownload className="w-4 h-4" />
                            </button>
                          )}
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
              {/* 调试信息 */}
              {!isComposing && !composeDone && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                  <div><strong>baseUrl:</strong> {llm.baseUrl || "https://apihub.agnes-ai.com/v1"}</div>
                  <div><strong>apiKey:</strong> {llm.apiKey ? llm.apiKey.slice(0, 10) + '...' : '未设置'}</div>
                  <div><strong>视频端点:</strong> {(llm.baseUrl || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "")}/videos</div>
                </div>
              )}

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
                    {composeDone
                      ? "合成完成！"
                      : `正在合成视频... ${composeProgress}%`}
                  </p>
                  <p className="text-[10px] text-amber-600 text-center mt-1">
                    ⏳ 视频生成可能需要 1-3 分钟/分镜，请耐心等待
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

              {composeError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <div className="font-medium">⚠️ 合成失败</div>
                  <div className="mt-1">{composeError}</div>
                  <button
                    className="mt-2 text-xs underline hover:no-underline"
                    onClick={() => setComposeError(null)}
                  >
                    关闭提示
                  </button>
                </div>
              )}

              {composeDone && (
                <div className="space-y-2">
                  <Button
                    onClick={downloadComposedVideo}
                    disabled={isDownloadingCompose}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {isDownloadingCompose ? (
                      <>
                        <LuLoader className="w-4 h-4 mr-2 animate-spin" />
                        下载中...
                      </>
                    ) : (
                      <>
                        <LuDownload className="w-4 h-4 mr-2" />
                        下载合成视频
                      </>
                    )}
                  </Button>
                  <Link href={`/project/${id}/export?videoUrl=${encodeURIComponent(clips.find(c => c.status === 'done')?.url || '')}`}>
                    <Button className="w-full bg-secondary hover:bg-secondary/80">
                      下一步：导出视频
                      <LuArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 视频弹窗 */}
      {selectedVideoUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setSelectedVideoUrl(null)}
        >
          <div className="relative max-w-3xl w-full bg-black rounded-lg" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white text-2xl hover:text-gray-300 z-[101]"
              onClick={() => setSelectedVideoUrl(null)}
            >
              ✕
            </button>
            <video
              src={selectedVideoUrl}
              controls
              autoPlay
              className="w-full rounded-lg"
              style={{ maxHeight: '80vh' }}
            />
            {/* 下载按钮 */}
            <div className="absolute bottom-4 right-4 flex gap-2 z-[101]">
              <button
                className="px-4 py-2 bg-white/20 backdrop-blur-md rounded-lg text-white text-sm hover:bg-white/30 transition-all"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const res = await fetch(selectedVideoUrl);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'video-' + Date.now() + '.mp4';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch {
                    window.open(selectedVideoUrl, '_blank');
                  }
                }}
              >
                💾 下载视频
              </button>
              <button
                className="px-4 py-2 bg-white/20 backdrop-blur-md rounded-lg text-white text-sm hover:bg-white/30 transition-all"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const response = await fetch(selectedVideoUrl);
                    const blob = await response.blob();
                    if (navigator.share && navigator.canShare?.({ files: [new File([blob], 'video.mp4', { type: 'video/mp4' })] })) {
                      await navigator.share({
                        files: [new File([blob], 'video.mp4', { type: 'video/mp4' })],
                        title: '分享视频',
                      });
                    } else {
                      // 降级：打开新窗口
                      const url = URL.createObjectURL(blob);
                      window.open(url, '_blank');
                    }
                  } catch (err) {
                    console.error('保存失败:', err);
                    window.open(selectedVideoUrl, '_blank');
                  }
                }}
              >
                📱 保存到相册
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
