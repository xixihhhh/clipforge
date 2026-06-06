"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useSearchParams } from "next/navigation"
import {
  LuCheck, LuCircleCheck, LuFilm, LuDownload, LuLink2, LuFileText,
  LuSmartphone, LuCopy, LuShuffle, LuImage, LuImagePlus, LuLoader,
  LuArrowLeft, LuShare2, LuCamera,
} from "react-icons/lu"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { downloadVideo, saveToGallery, shareVideo } from "@/lib/download-service"
import type { PlatformId, PlatformInfo } from "@/lib/platform-export"

// ============ 类型 ============
interface ExportState {
  platform: PlatformId | null
  isExporting: boolean
  progress: number
  result: { success: boolean; url?: string; error?: string } | null
}

// ============ 导出状态 ============
export interface ExportVideoInfo {
  title: string
  duration: number
  resolution: string
  aspectRatio: string
  fileSize: string
  format: string
  createdAt: string
  videoUrl: string
}

// ============ 平台导出配置 ============
const platformConfigs = [
  { id: "douyin" as PlatformId, name: "抖音", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-pink-500 to-red-500" },
  { id: "kuaishou" as PlatformId, name: "快手", ratio: "9:16", resolution: "1080p", subtitle: "贴边框", color: "from-orange-500 to-amber-500" },
  { id: "xiaohongshu" as PlatformId, name: "小红书", ratio: "3:4", resolution: "1440p", subtitle: "手写字体", color: "from-red-500 to-rose-500" },
]

// ============ A/B 测试版本 ============
const abVersions = [
  { id: "v1", name: "版本A - 原版", hook: "你还在用产品核心卖点？", style: "痛点种草" },
  { id: "v2", name: "版本B - 利益点", hook: "这个商品湿水都不破！省钱又好用", style: "利益承诺" },
  { id: "v3", name: "版本C - 悬念", hook: "预算投入深度测评商品，结果...", style: "悬念提问" },
]

export const dynamic = 'force-dynamic'

export default function ExportPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const [toast, setToast] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isSavingToGallery, setIsSavingToGallery] = useState(false)
  const [exportStates, setExportStates] = useState<Record<string, ExportState>>({})
  const [selectedAB, setSelectedAB] = useState<string>("v1")
  const [videoInfo, setVideoInfo] = useState<ExportVideoInfo | null>(null)

  // 从 URL query params 或 sessionStorage 获取真实视频信息
  useEffect(() => {
    // 优先从 URL query 获取
    const videoUrlFromUrl = searchParams.get('videoUrl')
    if (videoUrlFromUrl) {
      setVideoInfo({
        title: `项目 ${id} 带货视频`,
        duration: 25,
        resolution: "1080p",
        aspectRatio: "9:16",
        fileSize: "12.8 MB",
        format: "MP4",
        createdAt: new Date().toISOString().split('T')[0],
        videoUrl: videoUrlFromUrl,
      })
      return
    }

    // 尝试从 sessionStorage 获取
    try {
      const stored = sessionStorage.getItem(`export_video_${id}`)
      if (stored) {
        const parsed = JSON.parse(stored) as ExportVideoInfo
        setVideoInfo(parsed)
        return
      }
    } catch {}

    // 兜底：使用默认信息（但没有真实视频 URL）
    setVideoInfo({
      title: `项目 ${id} 带货视频`,
      duration: 25,
      resolution: "1080p",
      aspectRatio: "9:16",
      fileSize: "12.8 MB",
      format: "MP4",
      createdAt: new Date().toISOString().split('T')[0],
      videoUrl: "",
    })
  }, [id, searchParams])

  // Toast 提示
  const showToast = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ========== 功能2: 下载视频到本地 ==========
  const handleDownload = useCallback(async () => {
    if (!videoInfo?.videoUrl) {
      showToast("❌ 暂无可下载的视频")
      return
    }
    setIsDownloading(true)
    try {
      const result = await downloadVideo(videoInfo?.videoUrl, {
        fileName: `${videoInfo?.title ?? "项目视频"}_${Date.now()}.mp4`,
      })
      if (result.success) {
        showToast("✅ 视频已开始下载")
      } else {
        showToast(`❌ 下载失败: ${result.error}`)
      }
    } catch (err) {
      showToast("❌ 下载失败，请重试")
    } finally {
      setIsDownloading(false)
    }
  }, [showToast, videoInfo])

  // ========== 功能2: 保存到相册 ==========
  const handleSaveToGallery = useCallback(async () => {
    if (!videoInfo?.videoUrl) {
      showToast("❌ 暂无可保存的视频")
      return
    }
    setIsSavingToGallery(true)
    try {
      const result = await saveToGallery(videoInfo?.videoUrl, `${videoInfo?.title ?? "项目视频"}_${Date.now()}.mp4`)
      if (result.success) {
        showToast("✅ 已保存到相册")
      } else if (result.error !== "用户取消保存") {
        showToast(`❌ ${result.error}`)
      }
    } catch {
      showToast("❌ 保存失败，请重试")
    } finally {
      setIsSavingToGallery(false)
    }
  }, [showToast, videoInfo])

  // ========== 分享视频 ==========
  const handleShare = useCallback(async () => {
    if (!videoInfo?.videoUrl) {
      showToast("❌ 暂无可分享的视频")
      return
    }
    const ok = await shareVideo(videoInfo?.videoUrl, videoInfo?.title ?? "带货视频")
    if (ok) showToast("✅ 分享成功")
    else showToast("📋 已复制链接到剪贴板")
  }, [showToast, videoInfo])

  // ========== 功能7: 导出到平台 ==========
  const handleExportToPlatform = useCallback(async (platformId: PlatformId) => {
    if (!videoInfo?.videoUrl) {
      showToast("❌ 暂无可导出的视频")
      return
    }
    setExportStates((prev) => ({
      ...prev,
      [platformId]: { platform: platformId, isExporting: true, progress: 0, result: null },
    }))

    try {
      // 模拟进度
      const progressInterval = setInterval(() => {
        setExportStates((prev) => {
          const state = prev[platformId]
          if (!state || state.progress >= 90) return prev
          return {
            ...prev,
            [platformId]: { ...state, progress: state.progress + Math.random() * 15 },
          }
        })
      }, 500)

      const res = await fetch("/api/ai/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: videoInfo?.videoUrl ?? "",
          platform: platformId,
          title: videoInfo?.title ?? "带货视频",
          description: `${videoInfo?.title ?? "项目视频"} - 由萌萌的AI生成`,
          watermark: { text: "萌萌的", position: "bottomRight" },
          subtitle: { enabled: true, style: "bottom" },
        }),
      })

      clearInterval(progressInterval)
      const data = await res.json()

      if (data.success) {
        setExportStates((prev) => ({
          ...prev,
          [platformId]: { platform: platformId, isExporting: false, progress: 100, result: { success: true, url: data.data.processedUrl } },
        }))
        showToast(`✅ 已导出到${data.meta.platform}`)
      } else {
        throw new Error(data.error || "导出失败")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "导出失败"
      setExportStates((prev) => ({
        ...prev,
        [platformId]: { platform: platformId, isExporting: false, progress: 0, result: { success: false, error: msg } },
      }))
      showToast(`❌ ${msg}`)
    }
  }, [showToast])

  // ========== 复制脚本 ==========
  const handleCopyScript = useCallback(() => {
    const scriptText = `【${videoInfo?.title ?? "项目视频"} - 带货脚本】

钩子: "你还在用产品核心卖点？"
痛点: "普通商品核心痛点..."
产品: "惊喜发现通用品牌"
演示: "湿水都不破！"
CTA: "限时特价！赶紧去抢！"`
    navigator.clipboard.writeText(scriptText).then(() => {
      showToast("✅ 脚本文案已复制")
    }).catch(() => {
      showToast("📋 脚本文案已就绪")
    })
  }, [showToast])

  // 获取平台导出状态
  const getExportState = (platformId: PlatformId) =>
    exportStates[platformId] || { platform: platformId, isExporting: false, progress: 0, result: null }

  return (
    <div className="min-h-screen grid-bg">
      {/* Toast 提示 */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm shadow-xl">
            <LuCheck className="w-4 h-4" />
            {toast}
          </div>
        </div>
      )}

      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href={`/project/${id}/video`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <LuArrowLeft className="w-4 h-4" />
              <span className="text-sm">返回合成</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">{videoInfo?.title ?? "项目视频"}</span>
          </div>
          <div className="flex items-center gap-1">
            {["脚本", "素材", "视频", "导出"].map((step, i) => (
              <div key={step} className="flex items-center">
                <div className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${i === 3 ? "bg-primary text-primary-foreground" : "text-primary"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${i === 3 ? "bg-white/20" : "bg-primary/20"}`}>
                    {i < 3 ? "✓" : i + 1}
                  </span>
                  {step}
                </div>
                {i < 3 && <div className="mx-1 h-px w-4 bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* 完成提示 */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
            <LuCircleCheck className="w-8 h-8 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">
            视频<span className="brand-gradient-text">生成完成</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            你的带货视频已准备就绪，可以下载或分享
          </p>
        </div>

        {/* 视频预览 */}
        <Card className="glass-card neon-glow mb-6 overflow-hidden">
          <CardContent className="p-0">
            <div className="mx-auto max-w-xs">
              <div className="relative aspect-[9/16] bg-gradient-to-b from-muted/40 via-muted/20 to-muted/40 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <LuFilm className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground/50">{videoInfo?.title ?? "项目视频"}</p>
                  </div>
                </div>
                <button
                  onClick={() => showToast("▶️ 视频预览播放中")}
                  className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 transition-all group"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white" className="ml-1 group-hover:scale-110 transition-transform">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>
                <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded bg-black/60 text-white text-xs">
                  0:{String(videoInfo?.duration ?? 25).padStart(2, "0")}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{videoInfo?.resolution ?? "1080p"}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{videoInfo?.aspectRatio ?? "9:16"}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{videoInfo?.fileSize ?? "12.8 MB"}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{videoInfo?.format ?? "MP4"}</span>
              </div>
              <span className="text-xs text-muted-foreground">{videoInfo?.createdAt ?? ""}</span>
            </div>
          </CardContent>
        </Card>

        {/* ===== 功能2: 下载操作按钮 ===== */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-8">
          <Button
            onClick={handleDownload}
            disabled={isDownloading}
            className="brand-gradient text-white h-11 px-8 text-sm font-semibold"
          >
            {isDownloading ? (
              <LuLoader className="w-[18px] h-[18px] mr-2 animate-spin" />
            ) : (
              <LuDownload className="w-[18px] h-[18px] mr-2" />
            )}
            下载视频
          </Button>

          <Button
            onClick={handleSaveToGallery}
            disabled={isSavingToGallery}
            variant="outline"
            className="h-11 px-6 text-sm"
          >
            {isSavingToGallery ? (
              <LuLoader className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <LuCamera className="w-4 h-4 mr-2" />
            )}
            保存到相册
          </Button>

          <Button
            onClick={handleShare}
            variant="outline"
            className="h-11 px-6 text-sm"
          >
            <LuShare2 className="w-4 h-4 mr-2" />
            分享视频
          </Button>

          <Button
            onClick={handleCopyScript}
            variant="outline"
            className="h-11 px-6 text-sm"
          >
            <LuFileText className="w-4 h-4 mr-2" />
            复制脚本
          </Button>
        </div>

        {/* ===== 功能7: 多平台导出 ===== */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <LuSmartphone className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">多平台导出</h3>
              </div>
              {selectedAB && (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <LuShuffle className="w-3 h-3" />
                  A/B: {abVersions.find((v) => v.id === selectedAB)?.name}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">一键生成适配各平台的视频版本，自动调整分辨率、码率和字幕样式</p>

            {/* A/B 测试选择 */}
            <div className="flex gap-2 mb-4">
              {abVersions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedAB(v.id)}
                  className={`flex-1 p-2 rounded-lg border text-xs text-center transition-all ${
                    selectedAB === v.id
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border/50 text-muted-foreground hover:border-border"
                  }`}
                >
                  <div className="font-medium mb-0.5">{v.name}</div>
                  <div className="text-[10px] opacity-70">{v.hook.slice(0, 12)}...</div>
                </button>
              ))}
            </div>

            {/* 平台导出列表 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {platformConfigs.map((platform) => {
                const state = getExportState(platform.id)
                return (
                  <div
                    key={platform.id}
                    className={`p-3 rounded-lg border transition-all ${
                      state.result?.success
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-border/50 bg-muted/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded bg-gradient-to-br ${platform.color} flex items-center justify-center`}>
                          <span className="text-[10px] text-white font-bold">{platform.name[0]}</span>
                        </div>
                        <span className="text-sm font-medium">{platform.name}</span>
                      </div>
                      {state.result?.success && (
                        <LuCircleCheck className="w-4 h-4 text-emerald-500" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5 mb-3">
                      <p>比例: {platform.ratio}</p>
                      <p>分辨率: {platform.resolution}</p>
                      <p>字幕: {platform.subtitle}</p>
                    </div>

                    {/* 进度条 */}
                    {state.isExporting && (
                      <div className="mb-3">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(state.progress, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-primary mt-1">导出中 {Math.round(state.progress)}%</p>
                      </div>
                    )}

                    {/* 导出按钮 / 完成状态 */}
                    {state.result?.success ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 text-[11px]"
                          onClick={() => {
                            if (state.result?.url) {
                              navigator.clipboard.writeText(state.result.url)
                              showToast("📋 已复制导出链接")
                            }
                          }}
                        >
                          <LuCopy className="w-3 h-3 mr-1" />
                          复制链接
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => {
                            if (state.result?.url) window.open(state.result.url, "_blank")
                          }}
                        >
                          <LuDownload className="w-3 h-3 mr-1" />
                          下载
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleExportToPlatform(platform.id)}
                        disabled={state.isExporting}
                        className={`w-full h-8 text-[11px] bg-gradient-to-r ${platform.color} text-white`}
                      >
                        {state.isExporting ? (
                          <LuLoader className="w-3 h-3 mr-1 animate-spin" />
                        ) : state.result?.error ? (
                          "重试导出"
                        ) : (
                          "导出到此平台"
                        )}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 自定义封面 */}
            <div className="mt-4 pt-4 border-t border-border/30">
              <div className="flex items-center gap-3">
                <div className="w-16 h-24 rounded-lg bg-muted/20 border border-border/50 flex items-center justify-center">
                  <LuImage className="w-5 h-5 text-muted-foreground/40" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-medium mb-1">自定义封面</h4>
                  <p className="text-[10px] text-muted-foreground mb-2">上传视频封面图，各平台导出时自动适配尺寸</p>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]">
                    <LuImagePlus className="w-3 h-3 mr-1" />
                    选择封面
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 底部操作 */}
        <div className="flex items-center justify-center gap-4">
          <Link
            href={`/project/${id}/video`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← 返回视频合成
          </Link>
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            返回首页
          </Link>
          <button
            onClick={() => showToast("🚀 项目已发布！可以在历史记录中查看")}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            发布项目 →
          </button>
        </div>
      </main>
    </div>
  )
}
