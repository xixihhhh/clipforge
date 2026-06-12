"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { LuCheck, LuCircleCheck, LuFilm, LuDownload, LuLink2, LuPlus, LuHouse, LuSmartphone, LuShuffle, LuLoaderCircle } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// 平台导出配置（规划中功能，展示用）
const platformConfigs = [
  { id: "douyin", name: "抖音", ratio: "9:16", resolution: "1080p", subtitle: "居中+描边", color: "from-pink-500 to-red-500" },
  { id: "kuaishou", name: "快手", ratio: "9:16", resolution: "1080p", subtitle: "贴边框", color: "from-orange-500 to-amber-500" },
  { id: "xiaohongshu", name: "小红书", ratio: "3:4", resolution: "1440p", subtitle: "手写字体", color: "from-red-500 to-rose-500" },
];

const styleLabels: Record<string, string> = {
  pain_point: "痛点种草",
  scene: "场景安利",
  comparison: "对比测评",
  story: "剧情故事",
  auto: "智能推荐",
};

interface Composition {
  url: string | null;
  fileName: string;
  resolution: string | null;
  aspectRatio: string | null;
  status: string;
  createdAt: string | null;
}

interface ScriptInfo {
  styleType: string;
  totalDuration: number;
  shotCount: number;
}

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [composition, setComposition] = useState<Composition | null>(null);
  const [scriptInfo, setScriptInfo] = useState<ScriptInfo | null>(null);
  const [fileSize, setFileSize] = useState<string>("");

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [compRes, projRes, scriptsRes] = await Promise.all([
          fetch(`/api/project/${id}/compose`),
          fetch(`/api/project/${id}`),
          fetch(`/api/project/${id}/scripts`),
        ]);
        if (projRes.ok) {
          const proj = await projRes.json();
          if (!cancelled) setProjectName(proj.name ?? proj.productName ?? "");
        }
        if (compRes.ok) {
          const data = await compRes.json();
          if (!cancelled && data.composition) setComposition(data.composition);
        }
        if (scriptsRes.ok) {
          const arr = await scriptsRes.json();
          const sel = Array.isArray(arr) ? (arr.find((s: { selected?: boolean }) => s.selected) ?? arr[0]) : null;
          if (!cancelled && sel) {
            setScriptInfo({
              styleType: sel.styleType,
              totalDuration: sel.totalDuration ?? 0,
              shotCount: Array.isArray(sel.shots) ? sel.shots.length : 0,
            });
          }
        }
      } catch {
        // 忽略，走空态
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 拿到真实成片后，HEAD 探测文件大小
  useEffect(() => {
    if (!composition?.url) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(composition.url!, { method: "HEAD" });
        const len = res.headers.get("content-length");
        if (len && !cancelled) {
          const mb = Number(len) / 1024 / 1024;
          setFileSize(mb >= 1 ? `${mb.toFixed(1)} MB` : `${(Number(len) / 1024).toFixed(0)} KB`);
        }
      } catch {
        // 忽略
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [composition?.url]);

  // 多平台导出状态：platformId → { status, url }
  const [platformExports, setPlatformExports] = useState<Record<string, { status: "idle" | "exporting" | "done" | "error"; url?: string }>>({});
  const exportPlatform = async (platformId: string) => {
    setPlatformExports((prev) => ({ ...prev, [platformId]: { status: "exporting" } }));
    try {
      const res = await fetch(`/api/project/${id}/export-platform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: platformId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导出失败");
      setPlatformExports((prev) => ({ ...prev, [platformId]: { status: "done", url: data.url } }));
    } catch (e) {
      setPlatformExports((prev) => ({ ...prev, [platformId]: { status: "error" } }));
      showToast(e instanceof Error ? e.message : "导出失败");
    }
  };

  const handleCopyLink = async () => {
    if (!composition?.url) return;
    const full = `${window.location.origin}${composition.url}`;
    try {
      await navigator.clipboard.writeText(full);
      showToast("链接已复制到剪贴板");
    } catch {
      showToast("复制失败，请手动复制");
    }
  };

  const dateStr = composition?.createdAt
    ? new Date(composition.createdAt).toLocaleDateString("zh-CN")
    : "";

  const headerBar = (
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
  );

  if (loading) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
          <LuLoaderCircle className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">正在加载成片...</p>
        </div>
      </div>
    );
  }

  // 空态：还没有合成视频
  if (!composition || !composition.url) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="mx-auto max-w-md flex flex-col items-center justify-center py-28 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 mb-5">
            <LuFilm className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-2">还没有合成视频</h2>
          <p className="text-sm text-muted-foreground mb-6">
            「{projectName || "该项目"}」尚未生成成片。请先到「视频」步骤完成合成，再回到这里导出。
          </p>
          <div className="flex items-center gap-3">
            <Link href={`/project/${id}/video`}>
              <Button className="brand-gradient text-white">去合成视频</Button>
            </Link>
            <Link href="/">
              <Button variant="outline">返回项目列表</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

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

      {headerBar}

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

        {/* 视频预览（真实成片） */}
        <Card className="glass-card neon-glow mb-6 overflow-hidden">
          <CardContent className="p-0">
            <div className="mx-auto max-w-xs">
              <div className="relative aspect-[9/16] bg-black flex items-center justify-center">
                <video
                  src={composition.url}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* 视频信息条 */}
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{composition.resolution ?? "1080p"}</span>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{composition.aspectRatio ?? "9:16"}</span>
                {fileSize && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                    <span>{fileSize}</span>
                  </>
                )}
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>MP4</span>
              </div>
              {dateStr && <span className="text-xs text-muted-foreground">{dateStr}</span>}
            </div>
          </CardContent>
        </Card>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-8">
          <a href={`${composition.url}?download=1`} download={composition.fileName}>
            <Button className="brand-gradient text-white h-11 px-8 text-sm font-semibold w-full">
              <LuDownload className="w-[18px] h-[18px] mr-2" />
              下载视频
            </Button>
          </a>
          <Button
            variant="outline"
            onClick={handleCopyLink}
            className="h-11 px-6 text-sm"
          >
            <LuLink2 className="w-4 h-4 mr-2" />
            复制分享链接
          </Button>
        </div>

        {/* 多平台导出（真实重编码） */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <LuSmartphone className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">多平台导出</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">一键重编码为各平台比例（模糊填充，不裁掉字幕/贴片）</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {platformConfigs.map(platform => {
                const ex = platformExports[platform.id] ?? { status: "idle" as const };
                return (
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
                    </div>
                    {ex.status === "done" && ex.url ? (
                      <a href={`${ex.url}?download=1`} download>
                        <Button variant="outline" size="sm" className="w-full mt-2 text-xs text-emerald-600">
                          <LuDownload className="w-3 h-3 mr-1" />
                          下载{platform.name}版
                        </Button>
                      </a>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 text-xs"
                        disabled={ex.status === "exporting"}
                        onClick={() => exportPlatform(platform.id)}
                      >
                        {ex.status === "exporting" ? "导出中..." : ex.status === "error" ? "重试导出" : `导出${platform.name}版`}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* A/B 测试版本（规划中） */}
        <Card className="glass-card mb-6">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <LuShuffle className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">A/B 测试版本</h3>
              </div>
              <Badge variant="secondary" className="text-xs">开发中</Badge>
            </div>
            <p className="text-xs text-muted-foreground">未来将自动生成不同开头/文案的变体，测试哪个转化率更高（当前为规划展示）</p>
          </CardContent>
        </Card>

        {/* 视频详情（真实脚本数据） */}
        <Card className="glass-card">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4">视频详情</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">脚本风格</p>
                  <p className="text-sm">{scriptInfo ? (styleLabels[scriptInfo.styleType] ?? scriptInfo.styleType) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">分镜数量</p>
                  <p className="text-sm">{scriptInfo ? `${scriptInfo.shotCount} 个镜头` : "—"}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">总时长</p>
                  <p className="text-sm">{scriptInfo?.totalDuration ? `${scriptInfo.totalDuration} 秒` : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">分辨率 / 比例</p>
                  <p className="text-sm">{composition.resolution ?? "1080p"} · {composition.aspectRatio ?? "9:16"}</p>
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
