"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {LuClapperboard, LuClock, LuImage, LuArrowRight, LuArrowLeft, LuGripVertical, LuPencil, LuTrash2, LuPlus, LuPlay, LuX, LuCheck, LuCopy} from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Shot } from "@/lib/db/schema";

// ==================== 转场类型映射 ====================
const transitionLabels: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  ai_start_end: { label: "AI 智能过渡", icon: "✨", color: "text-violet-500" },
  ai_reference: { label: "AI 参考过渡", icon: "🔗", color: "text-blue-500" },
  direct_concat: { label: "硬切", icon: "✂️", color: "text-muted-foreground" },
  ffmpeg_fade: { label: "淡入淡出", icon: "🌫", color: "text-sky-500" },
};

// 镜头类型标签
const shotTypeLabels: Record<
  Shot["type"],
  { label: string; color: string; bg: string }
> = {
  hook: { label: "钩子", color: "text-red-400", bg: "bg-red-500/20" },
  pain_point: {
    label: "痛点",
    color: "text-orange-400",
    bg: "bg-orange-500/20",
  },
  product_reveal: {
    label: "产品",
    color: "text-blue-400",
    bg: "bg-blue-500/20",
  },
  demo: { label: "演示", color: "text-green-400", bg: "bg-green-500/20" },
  social_proof: {
    label: "背书",
    color: "text-purple-400",
    bg: "bg-purple-500/20",
  },
  cta: { label: "转化", color: "text-amber-400", bg: "bg-amber-500/20" },
};

const visualSourceLabels: Record<string, { icon: string; label: string }> = {
  ai_generate: { icon: "✨", label: "AI 生成" },
  product_image: { icon: "📷", label: "商品原图" },
  user_upload: { icon: "📁", label: "用户上传" },
};

// ==================== 模拟数据 ====================
const initialShots: Shot[] = [
  {
    shotId: 1,
    type: "hook",
    duration: 3,
    description: "手持手机第一人称视角，快步走进房间，画面略有晃动",
    camera: "手持跟拍",
    visualSource: "ai_generate",
    transition: "ai_start_end",
    voiceover: "你还在用一擦就烂的纸巾？",
    prompt:
      "First person POV walking into a bright modern room, slightly shaky handheld camera, cinematic",
  },
  {
    shotId: 2,
    type: "pain_point",
    duration: 4,
    description: "桌上一堆廉价纸巾碎屑，手拿普通纸巾沾水后碎裂",
    camera: "俯拍特写",
    visualSource: "ai_generate",
    transition: "ai_start_end",
    voiceover: "普通纸巾一沾水就烂，擦个嘴满脸纸屑，太尴尬了",
    prompt:
      "Close-up overhead shot of cheap tissue paper disintegrating in water on a clean white table, dramatic lighting",
  },
  {
    shotId: 3,
    type: "product_reveal",
    duration: 3,
    description: "德宝纸巾包装正面特写，缓慢推进",
    camera: "缓慢推进",
    visualSource: "product_image",
    transition: "ai_start_end",
    voiceover: "直到我发现了德宝",
    prompt: "",
  },
  {
    shotId: 4,
    type: "demo",
    duration: 5,
    description: "手拿德宝纸巾浸入水中，拉扯展示韧性",
    camera: "中景固定",
    visualSource: "ai_generate",
    transition: "ai_start_end",
    voiceover: "湿水都不破！自己一直在用这个！拉扯都不会烂",
    prompt:
      "Hands holding premium tissue paper submerged in clear water, pulling and stretching to show strength, bright studio lighting",
  },
  {
    shotId: 5,
    type: "cta",
    duration: 3,
    description: "商品包装+价格标签+购物车图标",
    camera: "固定",
    visualSource: "product_image",
    transition: "direct_concat",
    voiceover: "限时特价！赶紧去抢！",
    prompt: "",
  },
];

// ==================== 编辑弹窗 ====================
function ShotEditModal({
  shot,
  onSave,
  onCancel,
}: {
  shot: Shot;
  onSave: (s: Shot) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ ...shot });

  const update = <K extends keyof Shot>(key: K, value: Shot[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="glass-card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6 space-y-5">
          {/* 标题栏 */}
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">
              编辑镜头 {String(draft.shotId).padStart(2, "0")}
            </h3>
            <Button variant="ghost" size="icon-sm" onClick={onCancel}>
              <LuX className="w-4 h-4" />
            </Button>
          </div>

          {/* 镜头类型 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              镜头类型
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                Object.entries(shotTypeLabels) as [
                  Shot["type"],
                  (typeof shotTypeLabels)[Shot["type"]]
                ][]
              ).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => update("type", key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    draft.type === key
                      ? `${info.bg} ${info.color} border-current`
                      : "border-border/50 text-muted-foreground hover:border-border"
                  }`}
                >
                  {info.label}
                </button>
              ))}
            </div>
          </div>

          {/* 画面描述 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              画面描述
            </label>
            <Textarea
              className="min-h-[80px] bg-background/50 text-sm"
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </div>

          {/* 配音文案 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              配音文案
            </label>
            <Textarea
              className="min-h-[60px] bg-background/50 text-sm"
              value={draft.voiceover}
              onChange={(e) => update("voiceover", e.target.value)}
            />
          </div>

          {/* 时长 + 镜头运动 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                时长（秒）
              </label>
              <Input
                type="number"
                min={1}
                max={30}
                value={draft.duration}
                onChange={(e) =>
                  update("duration", Math.max(1, Number(e.target.value)))
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                镜头运动
              </label>
              <Input
                value={draft.camera}
                onChange={(e) => update("camera", e.target.value)}
                placeholder="如：缓慢推进、手持跟拍"
              />
            </div>
          </div>

          {/* 视觉来源 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              视觉来源
            </label>
            <div className="flex gap-2">
              {(
                [
                  "ai_generate",
                  "product_image",
                  "user_upload",
                ] as Shot["visualSource"][]
              ).map((vs) => {
                const info = visualSourceLabels[vs];
                return (
                  <button
                    key={vs}
                    type="button"
                    onClick={() => update("visualSource", vs)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      draft.visualSource === vs
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 text-muted-foreground hover:border-border"
                    }`}
                  >
                    {info.icon} {info.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 转场 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              转场方式
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                Object.entries(transitionLabels) as [
                  string,
                  (typeof transitionLabels)[string]
                ][]
              ).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => update("transition", key as Shot["transition"])}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    draft.transition === key
                      ? `border-primary bg-primary/10 ${info.color}`
                      : "border-border/50 text-muted-foreground hover:border-border"
                  }`}
                >
                  {info.icon} {info.label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              AI Prompt（可选）
            </label>
            <Textarea
              className="min-h-[60px] bg-background/50 text-sm font-mono text-xs"
              value={draft.prompt || ""}
              onChange={(e) => update("prompt", e.target.value)}
              placeholder="English prompt for AI video/image generation"
            />
          </div>

          {/* 按钮 */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              取消
            </Button>
            <Button
              size="sm"
              className="brand-gradient text-white"
              onClick={() => onSave(draft)}
            >
              <LuCheck className="w-3.5 h-3.5 mr-1" />
              保存
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== 单镜头预览弹窗 ====================
function ShotPreviewModal({
  shot,
  index,
  onClose,
}: {
  shot: Shot;
  index: number;
  onClose: () => void;
}) {
  const typeInfo = shotTypeLabels[shot.type];
  const transInfo = transitionLabels[shot.transition];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="glass-card w-full max-w-md mx-4">
        <CardContent className="p-0 overflow-hidden">
          {/* 预览画面 */}
          <div className="relative aspect-[9/16] max-h-[50vh] bg-gradient-to-br from-muted/80 to-muted/30 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
                {shot.visualSource === "product_image" ? (
                  <span className="text-2xl">📷</span>
                ) : (
                  <LuClapperboard className="w-8 h-8 text-primary/60" />
                )}
              </div>
              <p className="text-sm text-muted-foreground max-w-[240px]">
                {shot.description}
              </p>
            </div>

            {/* 左上角序号 */}
            <div className="absolute top-3 left-3">
              <span className="bg-black/50 text-white text-xs px-2 py-1 rounded-md font-mono">
                SHOT {String(index + 1).padStart(2, "0")}
              </span>
            </div>

            {/* 右上角时长 */}
            <div className="absolute top-3 right-3">
              <span className="bg-black/50 text-white text-xs px-2 py-1 rounded-md">
                {shot.duration}s
              </span>
            </div>

            {/* 底部播放按钮 */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <LuPlay className="w-5 h-5 text-white ml-0.5" />
              </div>
            </div>
          </div>

          {/* 镜头信息 */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge className={`${typeInfo.bg} ${typeInfo.color} border-0`}>
                {typeInfo.label}
              </Badge>
              <span className={`text-xs ${transInfo.color}`}>
                {transInfo.icon} {transInfo.label}
              </span>
            </div>

            {/* 配音文案 */}
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground leading-relaxed">
                🎙 {shot.voiceover}
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <LuClock className="w-3 h-3" />
                {shot.camera}
              </span>
              <span>
                {visualSourceLabels[shot.visualSource]?.icon}{" "}
                {visualSourceLabels[shot.visualSource]?.label}
              </span>
            </div>

            {/* AI Prompt */}
            {shot.prompt && (
              <div className="p-3 bg-muted/20 rounded-lg">
                <p className="text-[10px] text-muted-foreground/70 mb-1 font-medium">
                  AI Prompt
                </p>
                <p className="text-xs text-muted-foreground font-mono leading-relaxed break-all">
                  {shot.prompt}
                </p>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onClose}
            >
              关闭
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== 主页面 ====================
export default function StoryboardPage() {
  const { id } = useParams<{ id: string }>();

  // 分镜数据
  const [shots, setShots] = useState<Shot[]>(initialShots);

  // 编辑弹窗
  const [editingShot, setEditingShot] = useState<Shot | null>(null);

  // 预览弹窗
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // 拖拽状态
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // 保存提示
  const [showSaved, setShowSaved] = useState(false);

  // ==================== 拖拽排序（原生 HTML5 DnD） ====================
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
      // Firefox 需要设置 data
      e.dataTransfer.setData("text/plain", String(index));
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragIndex !== null && index !== dragIndex) {
        setOverIndex(index);
      }
    },
    [dragIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === dropIndex) {
        setDragIndex(null);
        setOverIndex(null);
        return;
      }
      setShots((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dropIndex, 0, moved);
        // 重新编号
        return next.map((s, i) => ({ ...s, shotId: i + 1 }));
      });
      setDragIndex(null);
      setOverIndex(null);
    },
    [dragIndex]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  // ==================== 镜头操作 ====================
  const handleEditSave = useCallback((updated: Shot) => {
    setShots((prev) =>
      prev.map((s) => (s.shotId === updated.shotId ? updated : s))
    );
    setEditingShot(null);
  }, []);

  const handleDelete = useCallback((shotId: number) => {
    setShots((prev) => {
      const next = prev.filter((s) => s.shotId !== shotId);
      return next.map((s, i) => ({ ...s, shotId: i + 1 }));
    });
  }, []);

  const handleAddAfter = useCallback((afterIndex: number) => {
    setShots((prev) => {
      const newShot: Shot = {
        shotId: 0, // 将被重新编号
        type: "demo",
        duration: 3,
        description: "新镜头描述",
        camera: "固定",
        visualSource: "ai_generate",
        transition: "ai_start_end",
        voiceover: "",
        prompt: "",
      };
      const next = [...prev];
      next.splice(afterIndex + 1, 0, newShot);
      return next.map((s, i) => ({ ...s, shotId: i + 1 }));
    });
  }, []);

  const handleDuplicate = useCallback((index: number) => {
    setShots((prev) => {
      const original = prev[index];
      const copy: Shot = {
        ...original,
        shotId: 0,
        description: original.description + "（副本）",
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next.map((s, i) => ({ ...s, shotId: i + 1 }));
    });
  }, []);

  const handleSaveAll = useCallback(() => {
    // TODO: 后续对接 API 保存
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }, []);

  // 统计
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0);

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <span className="text-lg font-bold brand-gradient-text">
                带货建手
              </span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">分镜编辑器</span>
          </div>

          <div className="flex items-center gap-3">
            {showSaved && (
              <span className="text-xs text-green-500 flex items-center gap-1">
                <LuCheck className="w-3.5 h-3.5" />
                已保存
              </span>
            )}
            <Button
              size="sm"
              className="brand-gradient text-white text-sm"
              onClick={handleSaveAll}
            >
              保存修改
            </Button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* 顶部信息栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <LuClapperboard className="w-5 h-5 text-primary" />
              分镜编辑器
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              拖拽调整镜头顺序，点击编辑单个镜头详情
            </p>
          </div>

          {/* 统计 */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <LuClapperboard className="w-4 h-4" />
              <span className="font-medium">{shots.length}</span> 个镜头
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <LuClock className="w-4 h-4" />
              总时长 <span className="font-medium">{totalDuration}s</span>
            </div>
          </div>
        </div>

        {/* 时间线总览条 */}
        <Card className="glass-card mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-medium text-muted-foreground">
                时间线
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {totalDuration}s
              </span>
            </div>
            <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
              {shots.map((shot, i) => {
                const typeInfo = shotTypeLabels[shot.type];
                return (
                  <button
                    key={shot.shotId}
                    type="button"
                    className="relative flex items-center justify-center transition-all hover:brightness-110 cursor-pointer"
                    style={{
                      flex: shot.duration,
                      minWidth: 40,
                    }}
                    onClick={() => setPreviewIndex(i)}
                    title={`镜头 ${i + 1}: ${typeInfo.label} ${shot.duration}s`}
                  >
                    <div
                      className={`absolute inset-0 ${typeInfo.bg} opacity-60`}
                    />
                    <span className="relative text-[10px] font-mono font-medium text-foreground/70">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* 转场连接线 */}
            <div className="flex mt-1">
              {shots.slice(0, -1).map((shot, i) => {
                const transInfo = transitionLabels[shot.transition];
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center text-[10px] text-muted-foreground/50"
                    style={{
                      flex: shot.duration,
                      minWidth: 40,
                    }}
                  >
                    {transInfo.icon}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 分镜卡片列表 */}
        <div className="space-y-3">
          {shots.map((shot, index) => {
            const typeInfo = shotTypeLabels[shot.type];
            const transInfo = transitionLabels[shot.transition];
            const vsInfo = visualSourceLabels[shot.visualSource];
            const isDragging = dragIndex === index;
            const isOver = overIndex === index;

            return (
              <div key={`shot-${index}`}>
                {/* 拖拽插入指示器 */}
                {isOver && dragIndex !== null && index < dragIndex && (
                  <div className="h-1 mb-2 rounded-full bg-primary/40 mx-8 transition-all" />
                )}

                <Card
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`glass-card overflow-hidden transition-all ${
                    isDragging
                      ? "opacity-40 scale-[0.98]"
                      : isOver
                      ? "ring-2 ring-primary/50 scale-[1.01]"
                      : "card-hover"
                  }`}
                >
                  <CardContent className="p-0">
                    <div className="flex">
                      {/* 左侧：拖拽手柄 + 序号 + 类型 */}
                      <div className="flex flex-col items-center justify-center w-20 py-5 border-r border-border/50 shrink-0">
                        <div
                          className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/60 mb-2 transition-colors"
                          title="拖拽排序"
                        >
                          <LuGripVertical className="w-4 h-4" />
                        </div>
                        <span className="text-xl font-bold text-muted-foreground/40 font-mono">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <Badge
                          className={`${typeInfo.bg} ${typeInfo.color} border-0 text-[10px] mt-2`}
                        >
                          {typeInfo.label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-0.5">
                          <LuClock className="w-2.5 h-2.5" />
                          {shot.duration}s
                        </span>
                      </div>

                      {/* 中间：内容 */}
                      <div className="flex-1 p-4 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            {/* 画面描述 */}
                            <p className="text-sm leading-relaxed mb-2 text-foreground/90">
                              {shot.description}
                            </p>

                            {/* 信息标签 */}
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <LuClock className="w-3 h-3" />
                                {shot.camera}
                              </span>
                              <span>
                                {vsInfo?.icon} {vsInfo?.label}
                              </span>
                              <span className={transInfo.color}>
                                {transInfo.icon} {transInfo.label}
                              </span>
                            </div>

                            {/* 配音文案 */}
                            {shot.voiceover && (
                              <div className="mt-3 p-2.5 bg-muted/30 rounded-lg">
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  🎙 {shot.voiceover}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* 右侧：缩略图预览 */}
                          <div className="w-24 h-16 bg-muted/30 rounded-lg shrink-0 flex flex-col items-center justify-center border border-border/30 gap-1">
                            {shot.visualSource === "product_image" ? (
                              <>
                                <span className="text-base">📷</span>
                                <span className="text-[9px] text-muted-foreground">
                                  商品图
                                </span>
                              </>
                            ) : (
                              <>
                                <LuImage className="w-4 h-4 text-muted-foreground/40" />
                                <span className="text-[9px] text-muted-foreground/60">
                                  AI 预览
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 右侧操作按钮 */}
                      <div className="flex flex-col items-center justify-center gap-1 px-3 border-l border-border/50 shrink-0">
                        <button
                          type="button"
                          className="p-1.5 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                          title="预览镜头"
                          onClick={() => setPreviewIndex(index)}
                        >
                          <LuPlay className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                          title="编辑镜头"
                          onClick={() => setEditingShot(shot)}
                        >
                          <LuPencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                          title="复制镜头"
                          onClick={() => handleDuplicate(index)}
                        >
                          <LuCopy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="删除镜头"
                          onClick={() => handleDelete(shot.shotId)}
                        >
                          <LuTrash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 拖拽插入指示器 */}
                {isOver && dragIndex !== null && index > dragIndex && (
                  <div className="h-1 mt-2 rounded-full bg-primary/40 mx-8 transition-all" />
                )}

                {/* 镜头之间的 + 添加按钮 */}
                {index < shots.length - 1 && (
                  <div className="flex justify-center py-1">
                    <button
                      type="button"
                      onClick={() => handleAddAfter(index)}
                      className="group flex items-center gap-1.5 px-3 py-1 rounded-full text-muted-foreground/30 hover:text-primary hover:bg-primary/5 transition-all"
                      title="在此镜头后插入新镜头"
                    >
                      <div className="w-4 h-4 rounded-full border border-current flex items-center justify-center">
                        <LuPlus className="w-2.5 h-2.5" />
                      </div>
                      <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                        插入镜头
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* 最后追加按钮 */}
          <Card className="glass-card border-dashed">
            <CardContent className="p-0">
              <button
                type="button"
                onClick={() => handleAddAfter(shots.length - 1)}
                className="w-full flex items-center justify-center gap-2 py-6 text-muted-foreground/50 hover:text-primary transition-colors"
              >
                <div className="w-8 h-8 rounded-lg border border-current flex items-center justify-center">
                  <LuPlus className="w-4 h-4" />
                </div>
                <span className="text-sm">添加新镜头</span>
              </button>
            </CardContent>
          </Card>
        </div>

        {/* 底部导航 */}
        <div className="flex items-center justify-between mt-8 pb-8">
          <Link href={`/project/${id}/script`}>
            <Button variant="outline" size="sm">
              <LuArrowLeft className="w-4 h-4 mr-1" />
              返回脚本分析
            </Button>
          </Link>
          <Link href={`/project/${id}/assets`}>
            <Button className="brand-gradient text-white text-sm">
              下一步：生成素材
              <LuArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </main>

      {/* 编辑弹窗 */}
      {editingShot && (
        <ShotEditModal
          shot={editingShot}
          onSave={handleEditSave}
          onCancel={() => setEditingShot(null)}
        />
      )}

      {/* 预览弹窗 */}
      {previewIndex !== null && (
        <ShotPreviewModal
          shot={shots[previewIndex]}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}
