"use client";

import { useState } from "react";
import { LuCheck, LuCircleCheck, LuFilm, LuDownload, LuLink2, LuFileText, LuPlus, LuHouse, LuSmartphone, LuCopy, LuShuffle } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// 模拟视频信息
const videoInfo = {
  title: "Tempo 德宝纸巾推广",
  duration: 25,
  resolution: "1080p",
  aspectRatio: "9:16",
  fileSize: "12.8 MB",
  format: "MP4",
  createdAt: "2026-03-23",
  scriptStyle: "痛点种草",
  shotCount: 5,
  ttsVoice: "女声 - 温柔",
  bgm: "轻快节奏",
  hasSubtitle: true,
  models: {
    image: "FLUX.1 [dev]",
    video: "Kling v2.1",
  },
};

// 平台导出配置
const platformConfigs = [
  { id: "douyin", name: "抖音", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-pink-500 to-red-500" },
  { id: "kuaishou", name: "快手", ratio: "9:16", resolution: "1080p", subtitle: "贴边框", color: "from-orange-500 to-amber-500" },
  { id: "xiaohongshu", name: "小红书", ratio: "3:4", resolution: "1440p", subtitle: "手写字体", color: "from-red-500 to-rose-500" },
];

// A/B 测试版本
const abVersions = [
  { id: "v1", name: "版本A - 原版", hook: "你还在用一擦就烂的纸巾？", style: "痛点种草" },
  { id: "v2", name: "版本B - 利益点", hook: "这个纸巾湿水都不破！省钱又好用", style: "利益承诺" },
  { id: "v3", name: "版本C - 悬念", hook: "花了200块测了5款纸巾，结果...", style: "悬念提问" },
];

export default function ExportPage() {
  const [toast, setToast] = useState<string | null>(null);

  // 显示提示
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

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
            <span className="text-sm text-muted-foreground">{videoInfo.title}</span>
          </div>

          {/* 步骤进度 */}
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
              {/* 9:16 预览区域 */}
              <div className="relative aspect-[9/16] bg-gradient-to-b from-muted/40 via-muted/20 to-muted/40 flex items-center justify-center">
                {/* 模拟视频画面 */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <LuFilm className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground/50">{videoInfo.title}</p>
                  </div>
                </div>

                {/* 播放按钮覆盖层 */}
                <button
                  onClick={() => showToast("视频预览功能开发中")}
                  className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 transition-all group"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white" className="ml-1 group-hover:scale-110 transition-transform">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>

                {/* 时长标签 */}
                <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded bg-black/60 text-white text-xs">
                  0:{String(videoInfo.duration).padStart(2, "0")}
                </div>
              </div>
            </div>

            {/* 视频信息条 */}
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{videoInfo.resolution}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{videoInfo.aspectRatio}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{videoInfo.fileSize}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{videoInfo.format}</span>
              </div>
              <span className="text-xs text-muted-foreground">{videoInfo.createdAt}</span>
            </div>
          </CardContent>
        </Card>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-8">
          <Button
            onClick={() => showToast("视频已开始下载")}
            className="brand-gradient text-white h-11 px-8 text-sm font-semibold"
          >
            <LuDownload className="w-[18px] h-[18px] mr-2" />
            下载视频
          </Button>
          <Button
            variant="outline"
            onClick={() => showToast("链接已复制到剪贴板")}
            className="h-11 px-6 text-sm"
          >
            <LuLink2 className="w-4 h-4 mr-2" />
            复制分享链接
          </Button>
          <Button
            variant="outline"
            onClick={() => showToast("脚本文案已导出")}
            className="h-11 px-6 text-sm"
          >
            <LuFileText className="w-4 h-4 mr-2" />
            导出脚本
          </Button>
        </div>

        {/* 多平台导出 */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <LuSmartphone className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">多平台导出</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">一键生成适配各平台的视频版本</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {platformConfigs.map(platform => (
                <div key={platform.id} className="p-3 rounded-lg border border-border/50 bg-muted/10">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-6 h-6 rounded bg-gradient-to-br ${platform.color} flex items-center justify-center`}>
                      <span className="text-[10px] text-white font-bold">{platform.name[0]}</span>
                    </div>
                    <span className="text-sm font-medium">{platform.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>比例: {platform.ratio}</p>
                    <p>分辨率: {platform.resolution}</p>
                    <p>字幕: {platform.subtitle}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 text-xs"
                    onClick={() => showToast(`${platform.name}版本已开始导出`)}
                  >
                    导出{platform.name}版
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* A/B 测试版本 */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <LuShuffle className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">A/B 测试版本</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">自动生成不同开头/文案的变体，测试哪个转化率更高</p>
            <div className="space-y-3">
              {abVersions.map(version => (
                <div key={version.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{version.name}</span>
                      <Badge variant="secondary" className="text-xs">{version.style}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">开头: &quot;{version.hook}&quot;</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => showToast(`${version.name} 已开始生成`)}>
                      <LuCopy className="w-3 h-3 mr-1" />
                      生成
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 视频详情 */}
        <Card className="glass-card">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4">视频详情</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">脚本风格</p>
                  <p className="text-sm">{videoInfo.scriptStyle}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">分镜数量</p>
                  <p className="text-sm">{videoInfo.shotCount} 个镜头</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">总时长</p>
                  <p className="text-sm">{videoInfo.duration} 秒</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">配音</p>
                  <p className="text-sm">{videoInfo.ttsVoice}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">生图模型</p>
                  <Badge variant="secondary" className="text-xs">{videoInfo.models.image}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">生视频模型</p>
                  <Badge variant="secondary" className="text-xs">{videoInfo.models.video}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">背景音乐</p>
                  <p className="text-sm">{videoInfo.bgm}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">字幕</p>
                  <p className="text-sm">{videoInfo.hasSubtitle ? "已开启" : "未开启"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 底部导航 */}
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/project/new">
            <Button className="brand-gradient text-white">
              <LuPlus className="w-4 h-4 mr-1.5" />
              再做一个
            </Button>
          </Link>
          <Link href="/">
            <Button variant="outline">
              <LuHouse className="w-4 h-4 mr-1.5" />
              返回项目列表
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
