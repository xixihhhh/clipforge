"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {LuArrowLeft, LuSearch, LuFilter, LuPlay, LuClock, LuTag, LuTrendingUp, LuLayoutGrid, LuEye, LuSparkles, LuStar, LuArrowDownAZ, LuMonitor, LuFilm, LuMusic, LuType, LuZap, LuRocket} from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  presetTemplates,
  categoryOptions,
  styleOptions,
  getCategoryLabel,
  getCategoryIcon,
  getStyleLabel,
  type Template,
} from "@/lib/templates/presets";

/** 根据 useCount 计算评分 (3.5 ~ 5.0) */
function getRating(template: Template): number {
  if (template.rating) return template.rating;
  const base = 3.5;
  const bonus = Math.min(1.5, (template.useCount / 3000) * 1.5);
  return Math.round((base + bonus) * 10) / 10;
}

/** 渲染星级显示 */
function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.3;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: fullStars }).map((_, i) => (
        <LuStar key={`f${i}`} className="w-3 h-3 fill-amber-400 text-amber-400" />
      ))}
      {hasHalf && (
        <span className="relative w-3 h-3">
          <LuStar className="absolute w-3 h-3 text-muted-foreground/30" />
          <span className="absolute overflow-hidden w-[50%] h-full">
            <LuStar className="w-3 h-3 fill-amber-400 text-amber-400" />
          </span>
        </span>
      )}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <LuStar key={`e${i}`} className="w-3 h-3 text-muted-foreground/30" />
      ))}
      <span className="ml-1 text-xs font-medium">{rating.toFixed(1)}</span>
    </span>
  );
}

/** 从 shots 生成脚本预览文本 */
function generateScriptPreview(template: Template): string {
  let currentTime = 0;
  return template.shots
    .map((shot, index) => {
      const start = currentTime;
      const end = currentTime + shot.duration;
      currentTime = end;
      const timeStr = `${start}s-${end}s`;
      const promptLine = shot.prompt ? `\n  → 提示词: ${shot.prompt}` : "";
      return `【镜头 ${index + 1} - ${shot.name}】(${timeStr})\n  ${shot.description}${promptLine}`;
    })
    .join("\n\n");
}

export default function TemplatesPage() {
  const router = useRouter();

  // 筛选状态
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStyle, setSelectedStyle] = useState("all");
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "name">("popular");

  // 预览状态
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // 筛选后的模板
  const filteredTemplates = useMemo(() => {
    let result = [...presetTemplates];

    // 搜索筛选
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    // 品类筛选
    if (selectedCategory !== "all") {
      result = result.filter(
        (t) => t.category === selectedCategory || t.category === "all"
      );
    }

    // 风格筛选
    if (selectedStyle !== "all") {
      result = result.filter((t) => t.style === selectedStyle);
    }

    // 排序
    if (sortBy === "popular") {
      result.sort((a, b) => b.useCount - a.useCount);
    } else if (sortBy === "newest") {
      result.sort((a, b) => b.id.localeCompare(a.id));
    } else if (sortBy === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    }

    return result;
  }, [searchQuery, selectedCategory, selectedStyle, sortBy]);

  // 选择模板并跳转到新建项目页（预填所有参数）
  const handleSelectTemplate = (template: Template) => {
    const settings = template.recommendedSettings || {};
    const params = new URLSearchParams({
      templateId: template.id,
      templateName: template.name,
      category: template.category,
      scriptStyle: template.style,
      duration: template.duration.toString(),
      shots: JSON.stringify(template.shots),
      // 推荐设置预填
      aspectRatio: settings.aspectRatio || "9:16",
      resolution: settings.resolution || "1080x1920",
      fps: (settings.fps || 30).toString(),
      bgmStyle: settings.bgmStyle || "轻快活力",
      textStyle: settings.textStyle || "大字标题",
    });
    router.push(`/project/new?${params.toString()}`);
  };

  // 打开预览
  const handlePreview = (e: React.MouseEvent, template: Template) => {
    e.stopPropagation();
    setPreviewTemplate(template);
    setIsPreviewOpen(true);
  };

  // 获取品类统计
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = { all: presetTemplates.length };
    presetTemplates.forEach((t) => {
      stats[t.category] = (stats[t.category] || 0) + 1;
    });
    return stats;
  }, []);

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <LuArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <LuSparkles className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-bold tracking-tight">模板中心</h1>
            </div>
          </div>
          <Badge variant="secondary" className="text-xs">
            {filteredTemplates.length} 个模板
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* 页面标题 */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold tracking-tight mb-2">
            选择<span className="brand-gradient-text">视频模板</span>，快速开始创作
          </h2>
          <p className="text-muted-foreground">
            精选 30+ 电商视频模板，覆盖十大热门品类，一键填充到新建项目
          </p>
        </div>

        {/* 品类标签栏 */}
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((cat) => (
              <Button
                key={cat.value}
                variant={selectedCategory === cat.value ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat.value)}
                className="h-9 px-3 gap-1.5"
              >
                <span className="text-base">{cat.icon}</span>
                <span>{cat.label}</span>
                {categoryStats[cat.value] && (
                  <Badge
                    variant={selectedCategory === cat.value ? "secondary" : "outline"}
                    className="ml-1 text-[10px] px-1.5 py-0"
                  >
                    {categoryStats[cat.value]}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </div>

        {/* 筛选工具栏 */}
        <div className="mb-8 space-y-4">
          {/* 搜索栏 */}
          <div className="relative">
            <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索模板名称、描述或标签..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-background/50"
            />
          </div>

          {/* 筛选选项 */}
          <div className="flex flex-wrap gap-3">
            <Select value={selectedStyle} onValueChange={setSelectedStyle}>
              <SelectTrigger className="w-[140px] bg-background/50">
                <LuLayoutGrid className="w-4 h-4 mr-2" />
                <SelectValue placeholder="风格" />
              </SelectTrigger>
              <SelectContent>
                {styleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-muted-foreground">排序：</span>
              <Button
                variant={sortBy === "popular" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSortBy("popular")}
                className="h-8"
              >
                <LuTrendingUp className="w-4 h-4 mr-1" />
                最热门
              </Button>
              <Button
                variant={sortBy === "name" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSortBy("name")}
                className="h-8"
              >
                <LuArrowDownAZ className="w-4 h-4 mr-1" />
                名称
              </Button>
              <Button
                variant={sortBy === "newest" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSortBy("newest")}
                className="h-8"
              >
                最新
              </Button>
            </div>
          </div>
        </div>

        {/* 模板网格 */}
        {filteredTemplates.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredTemplates.map((template) => {
              const rating = getRating(template);
              return (
                <Card
                  key={template.id}
                  className="card-hover glass-card cursor-pointer group overflow-hidden"
                  onClick={() => handleSelectTemplate(template)}
                >
                  {/* 缩略图区域 */}
                  <div className="relative aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 overflow-hidden">
                    {/* 模拟缩略图 */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-4xl opacity-30">
                        {getCategoryIcon(template.category)}
                      </div>
                    </div>

                    {/* 预览按钮 */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => handlePreview(e, template)}
                      >
                        <LuEye className="w-4 h-4 mr-1" />
                        预览
                      </Button>
                    </div>

                    {/* 时长标签 */}
                    <Badge
                      variant="secondary"
                      className="absolute top-2 right-2 text-xs bg-black/60 text-white border-0"
                    >
                      <LuClock className="w-3 h-3 mr-1" />
                      {template.duration}s
                    </Badge>

                    {/* 评分标签 */}
                    <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 text-white rounded-md px-1.5 py-0.5 text-[10px]">
                      <LuStar className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span className="font-medium">{rating.toFixed(1)}</span>
                    </div>
                  </div>

                  <CardContent className="p-4">
                    {/* 模板名称 */}
                    <h3 className="font-semibold text-sm mb-1 line-clamp-1">
                      {template.name}
                    </h3>

                    {/* 描述 */}
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                      {template.description}
                    </p>

                    {/* 标签 */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {getCategoryLabel(template.category)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {getStyleLabel(template.style)}
                      </Badge>
                      {template.tags.slice(0, 2).map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    {/* 使用次数 + 评分 */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <LuTrendingUp className="w-3 h-3" />
                          {template.useCount > 1000
                            ? `${(template.useCount / 1000).toFixed(1)}k`
                            : template.useCount}
                          {" 次使用"}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <LuStar className="w-3 h-3 fill-amber-400 text-amber-400" />
                          {rating.toFixed(1)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectTemplate(template);
                        }}
                      >
                        使用模板
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          /* 空状态 */
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
              <LuSearch className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-2">未找到匹配的模板</h3>
            <p className="text-sm text-muted-foreground mb-4">
              尝试调整筛选条件或搜索关键词
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("all");
                setSelectedStyle("all");
              }}
            >
              清除筛选
            </Button>
          </div>
        )}
      </main>

      {/* 详情弹窗 */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {previewTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <LuSparkles className="w-5 h-5 text-primary" />
                  {previewTemplate.name}
                </DialogTitle>
                <DialogDescription>
                  {previewTemplate.description}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-6">
                {/* 基本信息 */}
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <LuTag className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">品类：</span>
                    <Badge variant="secondary">
                      {getCategoryIcon(previewTemplate.category)}{" "}
                      {getCategoryLabel(previewTemplate.category)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <LuLayoutGrid className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">风格：</span>
                    <Badge variant="secondary">
                      {getStyleLabel(previewTemplate.style)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <LuClock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">时长：</span>
                    <Badge variant="secondary">{previewTemplate.duration}s</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <LuStar className="w-4 h-4 text-amber-500" />
                    <span className="text-muted-foreground">评分：</span>
                    <StarRating rating={getRating(previewTemplate)} />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <LuTrendingUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">使用：</span>
                    <Badge variant="secondary">
                      {previewTemplate.useCount.toLocaleString()} 次
                    </Badge>
                  </div>
                </div>

                {/* 标签 */}
                <div className="flex flex-wrap gap-2">
                  {previewTemplate.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>

                {/* 脚本预览 */}
                <div>
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <LuFilm className="w-4 h-4" />
                    脚本预览
                  </h4>
                  <div className="rounded-lg bg-muted/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
                    {generateScriptPreview(previewTemplate)}
                  </div>
                </div>

                {/* 分镜结构 */}
                <div>
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <LuPlay className="w-4 h-4" />
                    分镜结构
                  </h4>
                  <div className="space-y-3">
                    {previewTemplate.shots.map((shot, index) => (
                      <div
                        key={index}
                        className="flex gap-3 p-3 rounded-lg bg-muted/50"
                      >
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-sm">{shot.name}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {shot.duration}s
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {shot.description}
                          </p>
                          {shot.prompt && (
                            <p className="text-xs text-primary/80 mt-1 italic">
                              提示词: {shot.prompt}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 推荐设置 */}
                <div>
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <LuZap className="w-4 h-4" />
                    推荐设置
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <LuMonitor className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-muted-foreground">画面比例</div>
                        <div className="text-sm font-medium">
                          {previewTemplate.recommendedSettings?.aspectRatio || "9:16"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <LuMonitor className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-muted-foreground">分辨率</div>
                        <div className="text-sm font-medium">
                          {previewTemplate.recommendedSettings?.resolution || "1080×1920"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <LuFilm className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-muted-foreground">帧率</div>
                        <div className="text-sm font-medium">
                          {previewTemplate.recommendedSettings?.fps || 30}fps
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <LuMusic className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-muted-foreground">背景音乐</div>
                        <div className="text-sm font-medium">
                          {previewTemplate.recommendedSettings?.bgmStyle || "轻快活力"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <LuType className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-muted-foreground">文字风格</div>
                        <div className="text-sm font-medium">
                          {previewTemplate.recommendedSettings?.textStyle || "大字标题"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <LuClock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-muted-foreground">视频时长</div>
                        <div className="text-sm font-medium">
                          {previewTemplate.duration}秒
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="text-sm text-muted-foreground">
                    已被 <span className="font-semibold text-foreground">{previewTemplate.useCount.toLocaleString()}</span> 位创作者使用
                    · 评分 <span className="font-semibold text-foreground">{getRating(previewTemplate).toFixed(1)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsPreviewOpen(false)}
                    >
                      关闭
                    </Button>
                    <Button
                      onClick={() => {
                        setIsPreviewOpen(false);
                        handleSelectTemplate(previewTemplate);
                      }}
                    >
                      <LuRocket className="w-4 h-4 mr-2" />
                      一键创建项目
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
