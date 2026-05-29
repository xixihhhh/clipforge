"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  LuArrowLeft,
  LuSearch,
  LuFilter,
  LuClock,
  LuCircleCheck,
  LuCircleX,
  LuChartBar,
  LuTrash2,
  LuRefreshCw,
  LuDownload,
  LuPlay,
  LuPause,
  LuEye,
  LuLoader,
  LuFilm,
  LuCalendar,
  LuTrendingUp,
  LuVideo,
  LuX,
  LuArrowUpDown,
  LuTriangleAlert,
  LuSparkles,
  LuLayoutGrid,
  LuList,
} from "react-icons/lu";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { useProjectStore } from "@/lib/stores/project-store";
import type { Project, ProjectStatus } from "@/lib/stores/project-store";
import { toast } from "@/lib/stores/toast-store";

/* ================================================================== */
/*  常量 & 映射                                                        */
/* ================================================================== */

const statusMap: Record<
  ProjectStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  draft: {
    label: "草稿",
    color: "bg-zinc-500/20 text-zinc-400",
    icon: <LuLayoutGrid className="w-3.5 h-3.5" />,
  },
  script: {
    label: "脚本中",
    color: "bg-blue-500/20 text-blue-400",
    icon: <LuSparkles className="w-3.5 h-3.5" />,
  },
  storyboard: {
    label: "分镜中",
    color: "bg-purple-500/20 text-purple-400",
    icon: <LuLayoutGrid className="w-3.5 h-3.5" />,
  },
  generating: {
    label: "生成中",
    color: "bg-cyan-500/20 text-cyan-400",
    icon: <LuLoader className="w-3.5 h-3.5 animate-spin" />,
  },
  video: {
    label: "合成中",
    color: "bg-amber-500/20 text-amber-400",
    icon: <LuFilm className="w-3.5 h-3.5" />,
  },
  done: {
    label: "已完成",
    color: "bg-emerald-500/20 text-emerald-400",
    icon: <LuCircleCheck className="w-3.5 h-3.5" />,
  },
  failed: {
    label: "失败",
    color: "bg-red-500/20 text-red-400",
    icon: <LuCircleX className="w-3.5 h-3.5" />,
  },
};

/** 状态筛选标签 */
const statusFilterOptions: {
  value: ProjectStatus | "all";
  label: string;
}[] = [
  { value: "all", label: "全部状态" },
  { value: "done", label: "已完成" },
  { value: "generating", label: "生成中" },
  { value: "script", label: "脚本中" },
  { value: "storyboard", label: "分镜中" },
  { value: "video", label: "合成中" },
  { value: "draft", label: "草稿" },
  { value: "failed", label: "失败" },
];

/** 排序选项 */
type SortKey = "createdAt_desc" | "createdAt_asc" | "name_asc" | "name_desc";
const sortOptions: { value: SortKey; label: string }[] = [
  { value: "createdAt_desc", label: "最新创建" },
  { value: "createdAt_asc", label: "最早创建" },
  { value: "name_asc", label: "名称 A-Z" },
  { value: "name_desc", label: "名称 Z-A" },
];

/* ================================================================== */
/*  工具函数                                                           */
/* ================================================================== */

/** 格式化相对时间 */
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

/** 格式化完整日期 */
function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 格式化时长（秒 → 分:秒） */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** 模拟视频时长（根据项目信息估算） */
function estimateDuration(project: Project): number {
  // 实际项目中应从脚本/视频元数据中获取
  // 这里用 createdAt 和 updatedAt 的差值模拟
  const diff = new Date(project.updatedAt).getTime() - new Date(project.createdAt).getTime();
  const seconds = Math.floor(diff / 1000);
  return seconds > 0 && seconds < 3600 ? seconds : Math.floor(15 + Math.random() * 45);
}

/** 是否为终态 */
function isTerminal(status: ProjectStatus): boolean {
  return status === "done" || status === "failed";
}

/** 是否可操作（终态可以重新生成/导出/删除） */
function canRegenerate(status: ProjectStatus): boolean {
  return status === "done" || status === "failed";
}

function canExport(status: ProjectStatus): boolean {
  return status === "done";
}

/* ================================================================== */
/*  统计信息组件                                                        */
/* ================================================================== */

function StatsCards({ projects }: { projects: Project[] }) {
  const total = projects.length;
  const done = projects.filter((p) => p.status === "done").length;
  const failed = projects.filter((p) => p.status === "failed").length;
  const successRate = total > 0 ? Math.round((done / total) * 100) : 0;
  const totalDuration = projects
    .filter((p) => p.status === "done")
    .reduce((sum, p) => sum + estimateDuration(p), 0);
  const totalMinutes = Math.floor(totalDuration / 60);
  const totalHours = Math.floor(totalMinutes / 60);

  const stats = [
    {
      label: "总生成数",
      value: total.toString(),
      sub: `完成 ${done} · 失败 ${failed}`,
      icon: <LuChartBar className="w-5 h-5 text-blue-400" />,
      color: "from-blue-500/10 to-blue-500/5",
    },
    {
      label: "成功率",
      value: `${successRate}%`,
      sub: total > 0 ? `${done}/${total} 个项目` : "暂无数据",
      icon: <LuTrendingUp className="w-5 h-5 text-emerald-400" />,
      color: "from-emerald-500/10 to-emerald-500/5",
    },
    {
      label: "总生成时长",
      value: totalHours > 0 ? `${totalHours}h ${totalMinutes % 60}m` : `${totalMinutes}m`,
      sub: `共 ${totalDuration} 秒`,
      icon: <LuClock className="w-5 h-5 text-amber-400" />,
      color: "from-amber-500/10 to-amber-500/5",
    },
    {
      label: "进行中",
      value: (total - done - failed).toString(),
      sub: "正在生成/合成中的任务",
      icon: <LuLoader className="w-5 h-5 text-cyan-400" />,
      color: "from-cyan-500/10 to-cyan-500/5",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="border-border/50 bg-gradient-to-br hover:shadow-md transition-shadow"
          style={{
            backgroundImage: `var(--tw-gradient-stops, none)`,
          }}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-xs text-muted-foreground/70">{stat.sub}</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/50">{stat.icon}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  历史记录卡片                                                        */
/* ================================================================== */

function HistoryCard({
  project,
  isSelected,
  onSelect,
  onRegenerate,
  onExport,
  onDelete,
  onView,
}: {
  project: Project;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onRegenerate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onView: () => void;
}) {
  const status = statusMap[project.status];
  const duration = estimateDuration(project);
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <Card
      className={`group border-border/50 hover:border-border hover:shadow-md transition-all ${
        isSelected ? "ring-2 ring-primary/50 border-primary/50" : ""
      }`}
    >
      <CardContent className="p-4">
        <div className="flex gap-4">
          {/* 左侧：选择框 + 视频预览 */}
          <div className="flex flex-col items-center gap-2">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onSelect(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
            />
            {/* 视频预览区域 */}
            <div
              className="relative w-24 h-40 rounded-lg overflow-hidden bg-muted/50 border border-border/50 
                         group-hover:border-border transition-colors cursor-pointer shrink-0"
              onClick={onView}
            >
              {project.productImages.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={project.productImages[0]}
                  alt={project.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground/50">
                  <LuFilm className="w-6 h-6" />
                  <span className="text-[10px]">暂无预览</span>
                </div>
              )}
              {/* 播放按钮覆盖层 */}
              {project.status === "done" && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPlaying(!isPlaying);
                  }}
                >
                  <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                    {isPlaying ? (
                      <LuPause className="w-5 h-5 text-foreground" />
                    ) : (
                      <LuPlay className="w-5 h-5 text-foreground ml-0.5" />
                    )}
                  </div>
                </div>
              )}
              {/* 时长标签 */}
              {duration > 0 && (
                <span className="absolute bottom-1 right-1 text-[10px] text-white bg-black/70 px-1.5 py-0.5 rounded">
                  {formatDuration(duration)}
                </span>
              )}
            </div>
          </div>

          {/* 右侧：项目信息 */}
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div className="space-y-2">
              {/* 头部：名称 + 状态 */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3
                    className="font-semibold text-sm truncate cursor-pointer hover:text-primary transition-colors"
                    onClick={onView}
                  >
                    {project.name}
                  </h3>
                  {project.productName && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      商品：{project.productName}
                    </p>
                  )}
                </div>
                <Badge className={`${status.color} shrink-0 flex items-center gap-1`}>
                  {status.icon}
                  {status.label}
                </Badge>
              </div>

              {/* 元信息 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {project.productCategory && (
                  <span className="flex items-center gap-1">
                    <LuLayoutGrid className="w-3 h-3" />
                    {project.productCategory}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <LuClock className="w-3 h-3" />
                  时长 {formatDuration(duration)}
                </span>
                <span className="flex items-center gap-1">
                  <LuCalendar className="w-3 h-3" />
                  {formatRelativeTime(project.createdAt)}
                </span>
                {project.videoMode && (
                  <span className="flex items-center gap-1">
                    <LuVideo className="w-3 h-3" />
                    {project.videoMode === "product_closeup"
                      ? "商品特写"
                      : project.videoMode === "graphic_montage"
                        ? "图文混剪"
                        : project.videoMode === "scene_demo"
                          ? "场景演示"
                          : "真人出镜"}
                  </span>
                )}
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground/60">
                创建于 {formatDateTime(project.createdAt)}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onView}
                  title="查看详情"
                >
                  <LuEye className="w-3.5 h-3.5" />
                </Button>
                {canRegenerate(project.status) && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onRegenerate}
                    title="重新生成"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    <LuRefreshCw className="w-3.5 h-3.5" />
                  </Button>
                )}
                {canExport(project.status) && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onExport}
                    title="导出视频"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    <LuDownload className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onDelete}
                  title="删除"
                  className="text-destructive/70 hover:text-destructive"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  主页面                                                             */
/* ================================================================== */

export default function HistoryPage() {
  const { projects, removeProject, removeProjects, updateProjectById, setCurrentProject } =
    useProjectStore();

  // ---- 筛选 & 搜索状态 ----
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | "all">("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("createdAt_desc");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // ---- 选择状态 ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- 确认弹窗 ----
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"single" | "batch">("single");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  // ---- 提取所有品类选项 ----
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    projects.forEach((p) => {
      if (p.productCategory) cats.add(p.productCategory);
    });
    return ["all", ...Array.from(cats).sort()];
  }, [projects]);

  // ---- 筛选后的列表（按时间倒序） ----
  const filteredProjects = useMemo(() => {
    let result = [...projects];

    // 搜索
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.productName && p.productName.toLowerCase().includes(q)) ||
          (p.productDescription && p.productDescription.toLowerCase().includes(q))
      );
    }

    // 状态筛选
    if (filterStatus !== "all") {
      result = result.filter((p) => p.status === filterStatus);
    }

    // 品类筛选
    if (filterCategory !== "all") {
      result = result.filter((p) => p.productCategory === filterCategory);
    }

    // 排序
    result.sort((a, b) => {
      switch (sortBy) {
        case "createdAt_desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "createdAt_asc":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "name_asc":
          return a.name.localeCompare(b.name, "zh-CN");
        case "name_desc":
          return b.name.localeCompare(a.name, "zh-CN");
        default:
          return 0;
      }
    });

    return result;
  }, [projects, searchQuery, filterStatus, filterCategory, sortBy]);

  // ---- 操作处理 ----
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(filteredProjects.map((p) => p.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [filteredProjects]
  );

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const isAllSelected =
    filteredProjects.length > 0 && filteredProjects.every((p) => selectedIds.has(p.id));
  const isIndeterminate = selectedIds.size > 0 && !isAllSelected;

  const handleRegenerate = useCallback(
    (project: Project) => {
      // 重置为 draft 状态，用户可以从头开始
      updateProjectById(project.id, { status: "draft" });
      toast.success(`已重置「${project.name}」，可以重新生成`);
    },
    [updateProjectById]
  );

  const handleExport = useCallback(
    (project: Project) => {
      // 模拟导出
      toast.info(`正在导出「${project.name}」的视频...`);
      setTimeout(() => {
        toast.success(`「${project.name}」导出完成！`);
      }, 1500);
    },
    []
  );

  const handleDeleteSingle = useCallback(
    (id: string) => {
      const project = projects.find((p) => p.id === id);
      setDeleteTarget("single");
      setDeleteTargetId(id);
      setDeleteDialogOpen(true);
    },
    [projects]
  );

  const confirmDelete = useCallback(() => {
    if (deleteTarget === "single" && deleteTargetId) {
      const project = projects.find((p) => p.id === deleteTargetId);
      removeProject(deleteTargetId);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTargetId);
        return next;
      });
      toast.success(`已删除「${project?.name ?? "项目"}」`);
    }
    setDeleteDialogOpen(false);
    setDeleteTargetId(null);
  }, [deleteTarget, deleteTargetId, projects, removeProject]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setBatchDeleteDialogOpen(true);
  }, [selectedIds]);

  const confirmBatchDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    removeProjects(ids);
    setSelectedIds(new Set());
    setBatchDeleteDialogOpen(false);
    toast.success(`已删除 ${ids.length} 个项目`);
  }, [selectedIds, removeProjects]);

  const handleView = useCallback(
    (project: Project) => {
      setCurrentProject(project);
      // 跳转到项目详情
      window.location.href = `/project/${project.id}`;
    },
    [setCurrentProject]
  );

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus("all");
    setFilterCategory("all");
  }, []);

  const hasActiveFilters = searchQuery || filterStatus !== "all" || filterCategory !== "all";

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <LuArrowLeft className="w-4 h-4" />
              <span className="text-sm">返回</span>
            </Link>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <LuFilm className="w-5 h-5 text-primary" />
              <h1 className="text-base font-semibold">生成历史</h1>
              <Badge variant="secondary" className="text-xs">
                {filteredProjects.length}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setViewMode("list")}
              title="列表视图"
            >
              <LuList className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setViewMode("grid")}
              title="网格视图"
            >
              <LuLayoutGrid className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* 统计卡片 */}
        <StatsCards projects={projects} />

        {/* 筛选栏 */}
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              {/* 搜索框 */}
              <div className="relative flex-1">
                <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索项目名 / 商品名 / 描述..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <LuX className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* 状态筛选 */}
              <Select
                value={filterStatus}
                onValueChange={(v) => setFilterStatus(v as ProjectStatus | "all")}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  {statusFilterOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 品类筛选 */}
              {categoryOptions.length > 1 && (
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="品类" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部品类</SelectItem>
                    {categoryOptions
                      .filter((c) => c !== "all")
                      .map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}

              {/* 排序 */}
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="w-[130px]">
                  <LuArrowUpDown className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="排序" />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 活跃筛选标签 & 批量操作 */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {searchQuery && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          搜索: {searchQuery}
                          <button onClick={() => setSearchQuery("")}>
                            <LuX className="w-3 h-3" />
                          </button>
                        </Badge>
                      )}
                      {filterStatus !== "all" && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          状态: {statusMap[filterStatus].label}
                          <button onClick={() => setFilterStatus("all")}>
                            <LuX className="w-3 h-3" />
                          </button>
                        </Badge>
                      )}
                      {filterCategory !== "all" && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          品类: {filterCategory}
                          <button onClick={() => setFilterCategory("all")}>
                            <LuX className="w-3 h-3" />
                          </button>
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={clearFilters}
                      className="text-muted-foreground"
                    >
                      清除筛选
                    </Button>
                  </>
                )}
              </div>

              {/* 批量操作 */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    已选 {selectedIds.size} 项
                  </span>
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={handleBatchDelete}
                  >
                    <LuTrash2 className="w-3 h-3" />
                    批量删除
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 全选栏 */}
        {filteredProjects.length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAllSelected}
                ref={(el) => {
                  if (el) el.indeterminate = isIndeterminate;
                }}
                onChange={(e) => handleSelectAll(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-primary"
              />
              <span className="text-xs text-muted-foreground">全选</span>
            </label>
            <span className="text-xs text-muted-foreground">
              共 {filteredProjects.length} 条记录
            </span>
          </div>
        )}

        {/* 历史记录列表 */}
        {filteredProjects.length === 0 ? (
          <Card className="border-border/50 border-dashed">
            <CardContent className="p-12 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <LuFilm className="w-8 h-8 text-muted-foreground/50" />
              </div>
              {hasActiveFilters ? (
                <>
                  <h3 className="text-base font-medium text-muted-foreground mb-1">
                    没有找到匹配的记录
                  </h3>
                  <p className="text-sm text-muted-foreground/70 mb-4">
                    尝试调整筛选条件或清除搜索关键词
                  </p>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    清除筛选
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-base font-medium text-muted-foreground mb-1">
                    暂无生成历史
                  </h3>
                  <p className="text-sm text-muted-foreground/70 mb-4">
                    创建项目并生成视频后，历史记录将显示在这里
                  </p>
                  <Link href="/">
                    <Button size="sm">
                      <LuSparkles className="w-4 h-4 mr-1" />
                      开始创作
                    </Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        ) : viewMode === "list" ? (
          /* 列表视图 */
          <div className="space-y-3">
            {filteredProjects.map((project) => (
              <HistoryCard
                key={project.id}
                project={project}
                isSelected={selectedIds.has(project.id)}
                onSelect={(checked) => handleSelect(project.id, checked)}
                onRegenerate={() => handleRegenerate(project)}
                onExport={() => handleExport(project)}
                onDelete={() => handleDeleteSingle(project.id)}
                onView={() => handleView(project)}
              />
            ))}
          </div>
        ) : (
          /* 网格视图 */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => {
              const status = statusMap[project.status];
              const duration = estimateDuration(project);
              return (
                <Card
                  key={project.id}
                  className={`group border-border/50 hover:border-border hover:shadow-md transition-all overflow-hidden ${
                    selectedIds.has(project.id)
                      ? "ring-2 ring-primary/50 border-primary/50"
                      : ""
                  }`}
                >
                  {/* 网格卡片顶部 - 预览 */}
                  <div
                    className="relative w-full h-48 bg-muted/50 cursor-pointer"
                    onClick={() => handleView(project)}
                  >
                    {project.productImages.length > 0 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={project.productImages[0]}
                        alt={project.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/50">
                        <LuFilm className="w-8 h-8" />
                        <span className="text-xs">暂无预览</span>
                      </div>
                    )}
                    {/* 播放按钮 */}
                    {project.status === "done" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                          <LuPlay className="w-6 h-6 text-foreground ml-0.5" />
                        </div>
                      </div>
                    )}
                    {/* 时长标签 */}
                    {duration > 0 && (
                      <span className="absolute bottom-2 right-2 text-xs text-white bg-black/70 px-2 py-0.5 rounded">
                        {formatDuration(duration)}
                      </span>
                    )}
                    {/* 状态标签 */}
                    <span className="absolute top-2 left-2">
                      <Badge className={`${status.color} flex items-center gap-1`}>
                        {status.icon}
                        {status.label}
                      </Badge>
                    </span>
                    {/* 选择框 */}
                    <span className="absolute top-2 right-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(project.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleSelect(project.id, e.target.checked);
                        }}
                        className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                      />
                    </span>
                  </div>

                  {/* 网格卡片底部 - 信息 */}
                  <CardContent className="p-3 space-y-2">
                    <div>
                      <h3
                        className="font-medium text-sm truncate cursor-pointer hover:text-primary transition-colors"
                        onClick={() => handleView(project)}
                      >
                        {project.name}
                      </h3>
                      {project.productName && (
                        <p className="text-xs text-muted-foreground truncate">
                          {project.productName}
                          {project.productCategory && ` · ${project.productCategory}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground/60">
                        {formatRelativeTime(project.createdAt)}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {canRegenerate(project.status) && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleRegenerate(project)}
                            title="重新生成"
                          >
                            <LuRefreshCw className="w-3 h-3" />
                          </Button>
                        )}
                        {canExport(project.status) && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleExport(project)}
                            title="导出"
                          >
                            <LuDownload className="w-3 h-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDeleteSingle(project.id)}
                          title="删除"
                          className="text-destructive/70 hover:text-destructive"
                        >
                          <LuTrash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* 单个删除确认弹窗 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除「{projects.find((p) => p.id === deleteTargetId)?.name ?? "该项目"}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除确认弹窗 */}
      <Dialog open={batchDeleteDialogOpen} onOpenChange={setBatchDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LuTriangleAlert className="w-5 h-5 text-destructive" />
              批量删除
            </DialogTitle>
            <DialogDescription>
              确定要删除选中的 {selectedIds.size} 个项目吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmBatchDelete}>
              确认删除 {selectedIds.size} 项
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
