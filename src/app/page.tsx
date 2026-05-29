"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  LuSettings, LuPlus, LuVideo, LuFilm, LuPackage,
  LuTriangleAlert, LuBarChart3, LuClock, LuCheckCircle2,
  LuLoader2, LuLayoutTemplate, LuImage, LuArrowRight,
  LuSearch, LuX, LuTrash2, LuArrowUpDown,
} from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/ui/dialog";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useProjectStore } from "@/lib/stores/project-store";
import type { ProjectStatus, SortField, SortOrder } from "@/lib/stores/project-store";
import { useDebounce } from "@/lib/hooks/useDebounce";

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "bg-zinc-500/20 text-zinc-400" },
  script: { label: "脚本中", color: "bg-blue-500/20 text-blue-400" },
  storyboard: { label: "分镜中", color: "bg-purple-500/20 text-purple-400" },
  generating: { label: "生成中", color: "bg-cyan-500/20 text-cyan-400" },
  video: { label: "合成中", color: "bg-amber-500/20 text-amber-400" },
  done: { label: "已完成", color: "bg-emerald-500/20 text-emerald-400" },
  failed: { label: "失败", color: "bg-red-500/20 text-red-400" },
};

/* 用户友好的状态筛选标签 */
const statusFilterTabs: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "script", label: "生成中" },
  { value: "done", label: "已完成" },
  { value: "failed", label: "失败" },
];

/* 排序选项 */
const sortOptions: { field: SortField; order: SortOrder; label: string }[] = [
  { field: "updatedAt", order: "desc", label: "最近更新" },
  { field: "updatedAt", order: "asc", label: "最早更新" },
  { field: "createdAt", order: "desc", label: "最新创建" },
  { field: "createdAt", order: "asc", label: "最早创建" },
  { field: "name", order: "asc", label: "名称 A-Z" },
  { field: "name", order: "desc", label: "名称 Z-A" },
];

/* 格式化相对时间 */
function formatRelativeTime(date: Date | string): string {
  const now = Date.now();
  const target = new Date(date).getTime();
  const diff = now - target;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return new Date(date).toLocaleDateString("zh-CN");
}

/* 格式化日期 */
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function HomePage() {
  const {
    projects, removeProject,
    searchQuery, filterStatus, sortOption,
    setSearchQuery, setFilterStatus, setSortOption,
  } = useProjectStore();
  const { llm, providers } = useSettingsStore();

  const { confirm, ConfirmDialog } = useConfirm();

  // 本地搜索输入（受控），通过 useDebounce 延迟同步到 store
  const [searchInput, setSearchInput] = useState(searchQuery);
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    setSearchQuery(debouncedSearch);
  }, [debouncedSearch, setSearchQuery]);

  // 系统状态检测
  const isLLMConfigured = llm.apiKey.length > 0;
  const hasAnyProvider = Object.values(providers).some(p => p.enabled && p.apiKey.length > 0);
  const isSystemReady = isLLMConfigured && hasAnyProvider;

  // 项目统计
  const stats = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter(p => p.status === "done").length;
    const inProgress = projects.filter(p => p.status !== "done").length;
    return { total, completed, inProgress };
  }, [projects]);

  // 筛选后的项目列表（利用 store 的筛选/排序逻辑）
  const filteredProjects = useMemo(() => {
    const q = (debouncedSearch || "").toLowerCase().trim();
    let list = [...projects];

    // 搜索过滤
    if (q) {
      list = list.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.productName && p.productName.toLowerCase().includes(q))
      );
    }

    // 状态过滤
    if (filterStatus !== "all") {
      if (filterStatus === "script") {
        // "生成中" 分组包含 script / storyboard / generating / video
        list = list.filter(p =>
          ["script", "storyboard", "generating", "video"].includes(p.status)
        );
      } else {
        list = list.filter(p => p.status === filterStatus);
      }
    }

    // 排序
    const { field, order } = sortOption;
    list.sort((a, b) => {
      let cmp = 0;
      if (field === "name") {
        cmp = a.name.localeCompare(b.name, "zh-CN");
      } else if (field === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return order === "desc" ? -cmp : cmp;
    });

    return list;
  }, [projects, debouncedSearch, filterStatus, sortOption]);

  // 删除项目
  const handleDelete = useCallback(
    async (e: React.MouseEvent, projectId: string, projectName: string) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = await confirm({
        title: "删除项目",
        description: `确定要删除项目「${projectName}」吗？此操作不可撤销。`,
        confirmText: "删除",
        cancelText: "取消",
        variant: "destructive",
      });
      if (ok) {
        removeProject(projectId);
      }
    },
    [confirm, removeProject]
  );

  // 当前排序标签
  const currentSortLabel = sortOptions.find(
    o => o.field === sortOption.field && o.order === sortOption.order
  )?.label || "最近更新";

  return (
    <div className="min-h-screen grid-bg">
      {/* 删除确认弹窗 */}
      {ConfirmDialog}

      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">萌萌的</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/products">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <LuPackage className="w-4 h-4" />
                <span className="ml-1.5">商品库</span>
              </Button>
            </Link>
            <Link href="/settings">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <LuSettings className="w-4 h-4" />
                <span className="ml-1.5">设置</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="brand-gradient-text">AI 驱动</span>的电商带货视频
          </h1>
          <p className="text-muted-foreground text-base">
            上传商品图，AI 生成脚本，一键产出高转化带货短视频
          </p>
        </div>

        {/* 系统状态检测横幅 */}
        {!isSystemReady && (
          <Link href="/settings">
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-4 cursor-pointer hover:bg-amber-100 transition-colors">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <LuTriangleAlert className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 text-sm">
                  {!isLLMConfigured ? "请先配置 LLM 服务" : "请配置至少一个 AI 平台"}
                </h3>
                <p className="text-xs text-amber-700 mt-1">
                  {!isLLMConfigured
                    ? "LLM 用于生成脚本和分析商品，是核心功能的基础"
                    : "AI 平台用于生成图片和视频素材"}
                </p>
              </div>
              <LuArrowRight className="w-5 h-5 text-amber-600 shrink-0" />
            </div>
          </Link>
        )}

        {/* 快速统计卡片 */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card className="glass-card">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
                <LuBarChart3 className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">总项目数</p>
              </div>
            </CardContent>
          </Card>
          
          <Card className="glass-card">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                <LuCheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.completed}</p>
                <p className="text-sm text-muted-foreground">已完成</p>
              </div>
            </CardContent>
          </Card>
          
          <Card className="glass-card">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                <LuLoader2 className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.inProgress}</p>
                <p className="text-sm text-muted-foreground">进行中</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 快速操作入口 */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">快速操作</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link href="/project/new">
              <Card className="card-hover glass-card cursor-pointer group h-full">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl brand-gradient shadow-lg group-hover:scale-105 transition-transform">
                    <LuPlus className="w-[22px] h-[22px] text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">新建项目</h3>
                    <p className="text-sm text-muted-foreground">创建带货视频项目</p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/templates">
              <Card className="card-hover glass-card cursor-pointer group h-full">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg group-hover:scale-105 transition-transform">
                    <LuLayoutTemplate className="w-[22px] h-[22px] text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">模板库</h3>
                    <p className="text-sm text-muted-foreground">使用预设模板快速开始</p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/materials">
              <Card className="card-hover glass-card cursor-pointer group h-full">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg group-hover:scale-105 transition-transform">
                    <LuImage className="w-[22px] h-[22px] text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">素材库</h3>
                    <p className="text-sm text-muted-foreground">管理图片和视频素材</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        {/* 项目列表区域 */}
        <div>
          {/* 标题 + 搜索 + 筛选工具栏 */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">全部项目</h2>
          </div>

          {/* 搜索框 */}
          <div className="relative mb-4">
            <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="搜索项目名称..."
              className="pl-9 pr-9 h-9"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <LuX className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* 状态筛选 + 排序 */}
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            {/* 状态筛选标签 */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {statusFilterTabs.map(tab => (
                <button
                  key={tab.value}
                  onClick={() => setFilterStatus(tab.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filterStatus === tab.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 排序选择 */}
            <Select
              value={JSON.stringify({ field: sortOption.field, order: sortOption.order })}
              onValueChange={val => {
                const parsed = JSON.parse(val) as { field: SortField; order: SortOrder };
                setSortOption(parsed);
              }}
            >
              <SelectTrigger size="sm" className="min-w-[130px]">
                <LuArrowUpDown className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                <SelectValue>{currentSortLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map(opt => (
                  <SelectItem
                    key={`${opt.field}-${opt.order}`}
                    value={JSON.stringify({ field: opt.field, order: opt.order })}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 空状态引导 */}
          {projects.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="p-10 text-center">
                <div className="flex justify-center mb-5">
                  <div className="relative">
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5">
                      <LuVideo className="w-10 h-10 text-primary" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary shadow-lg">
                      <LuPlus className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </div>
                <h3 className="text-lg font-semibold mb-2">开始创作你的第一个带货视频</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
                  上传商品图片，AI 将自动生成带货脚本、分镜头和视频素材，助你快速产出高质量带货短视频。
                </p>
                <div className="flex items-center justify-center gap-3">
                  <Link href="/project/new">
                    <Button>
                      <LuPlus className="w-4 h-4 mr-2" />
                      新建项目
                    </Button>
                  </Link>
                  <Link href="/templates">
                    <Button variant="outline">
                      <LuLayoutTemplate className="w-4 h-4 mr-2" />
                      浏览模板
                    </Button>
                  </Link>
                </div>
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto text-left">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                      <span className="text-sm font-bold text-blue-500">1</span>
                    </div>
                    <div>
                      <p className="text-xs font-medium">上传商品</p>
                      <p className="text-xs text-muted-foreground">商品图 &amp; 基本信息</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                      <span className="text-sm font-bold text-purple-500">2</span>
                    </div>
                    <div>
                      <p className="text-xs font-medium">AI 生成</p>
                      <p className="text-xs text-muted-foreground">脚本 + 分镜 + 素材</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                      <span className="text-sm font-bold text-emerald-500">3</span>
                    </div>
                    <div>
                      <p className="text-xs font-medium">导出视频</p>
                      <p className="text-xs text-muted-foreground">一键合成成品</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : filteredProjects.length === 0 ? (
            /* 搜索/筛选无结果 */
            <Card className="glass-card">
              <CardContent className="p-8 text-center">
                <LuSearch className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground mb-1">没有找到匹配的项目</p>
                <p className="text-xs text-muted-foreground mb-4">
                  尝试修改搜索关键词或筛选条件
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchInput("");
                    setFilterStatus("all");
                  }}
                >
                  清除筛选
                </Button>
              </CardContent>
            </Card>
          ) : (
            /* 项目卡片列表 */
            <div className="space-y-3">
              {filteredProjects.map((project) => (
                <Link key={project.id} href={`/project/${project.id}`}>
                  <Card className="card-hover glass-card cursor-pointer group">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        {/* 左侧：项目信息 */}
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <LuFilm className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium truncate">{project.name}</h3>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge
                                variant="secondary"
                                className={`text-xs ${statusMap[project.status]?.color || "bg-zinc-500/20 text-zinc-400"}`}
                              >
                                {statusMap[project.status]?.label || project.status}
                              </Badge>
                              {project.productCategory && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <LuPackage className="w-3 h-3" />
                                  {project.productCategory}
                                </span>
                              )}
                              {project.productName && (
                                <span className="text-xs text-muted-foreground">
                                  {project.productName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 右侧：时间 + 删除 */}
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <div className="text-right">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <LuClock className="w-3.5 h-3.5" />
                              <span>{formatRelativeTime(project.updatedAt)}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                              创建于 {formatDate(project.createdAt)}
                            </p>
                          </div>
                          <button
                            onClick={e => handleDelete(e, project.id, project.name)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all"
                            title="删除项目"
                          >
                            <LuTrash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {/* 项目数量提示 */}
          {projects.length > 0 && filteredProjects.length > 0 && (
            <p className="text-xs text-muted-foreground text-center mt-4">
              共 {projects.length} 个项目
              {filterStatus !== "all" || searchInput
                ? `，当前显示 ${filteredProjects.length} 个`
                : ""}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
