"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

/* ====================================================================
   Spinner - 旋转加载图标
   ==================================================================== */

const spinnerVariants = cva("animate-spin", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-4",
      md: "size-6",
      lg: "size-8",
      xl: "size-12",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export interface SpinnerProps
  extends React.HTMLAttributes<SVGSVGElement>,
    VariantProps<typeof spinnerVariants> {
  /** 自定义颜色 class，默认使用 text-primary */
  color?: string;
}

/**
 * Spinner 旋转加载图标
 * @example
 * <Spinner />
 * <Spinner size="lg" />
 * <Spinner size="sm" color="text-white" />
 */
export function Spinner({ size, color = "text-primary", className, ...props }: SpinnerProps) {
  return (
    <Loader2
      className={cn(spinnerVariants({ size }), color, className)}
      aria-label="加载中"
      {...props}
    />
  );
}

/* ====================================================================
   Skeleton - 骨架屏
   支持 card / list / table 三种预设样式
   ==================================================================== */

export type SkeletonVariant = "card" | "list" | "table";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 骨架屏预设样式 */
  variant?: SkeletonVariant;
  /** list 模式下的行数，默认 5 */
  rows?: number;
  /** table 模式的列数，默认 4 */
  cols?: number;
  /** table 模式的行数（含表头），默认 5 */
  tableRows?: number;
}

/** 单个骨架条 */
function SkeletonBar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted animate-pulse",
        className
      )}
      {...props}
    />
  );
}

/** 卡片骨架屏 */
function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5 space-y-4", className)}>
      {/* 头像 + 标题区 */}
      <div className="flex items-center gap-3">
        <SkeletonBar className="size-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <SkeletonBar className="h-4 w-3/5" />
          <SkeletonBar className="h-3 w-2/5" />
        </div>
      </div>
      {/* 封面图 */}
      <SkeletonBar className="h-40 w-full rounded-lg" />
      {/* 文本行 */}
      <div className="space-y-2">
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-4/5" />
        <SkeletonBar className="h-3 w-3/5" />
      </div>
      {/* 操作区 */}
      <div className="flex gap-3 pt-1">
        <SkeletonBar className="h-8 w-20 rounded-lg" />
        <SkeletonBar className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  );
}

/** 列表骨架屏 */
function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
        >
          <SkeletonBar className="size-10 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBar className="h-4 w-3/4" />
            <SkeletonBar className="h-3 w-1/2" />
          </div>
          <SkeletonBar className="h-6 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** 表格骨架屏 */
function TableSkeleton({
  cols = 4,
  tableRows = 5,
  className,
}: {
  cols?: number;
  tableRows?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      {/* 表头 */}
      <div className="flex gap-4 border-b border-border bg-muted/50 px-5 py-3">
        {Array.from({ length: cols }).map((_, j) => (
          <SkeletonBar
            key={j}
            className="h-4"
            style={{ width: `${100 / cols}%` }}
          />
        ))}
      </div>
      {/* 表体 */}
      {Array.from({ length: tableRows - 1 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 border-b border-border last:border-b-0 px-5 py-4"
        >
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonBar
              key={j}
              className="h-3.5"
              style={{ width: `${100 / cols}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton 骨架屏
 * @example
 * <Skeleton variant="card" />
 * <Skeleton variant="list" rows={8} />
 * <Skeleton variant="table" cols={5} tableRows={6} />
 */
export function Skeleton({
  variant = "card",
  rows = 5,
  cols = 4,
  tableRows = 5,
  className,
  ...props
}: SkeletonProps) {
  return (
    <div className={cn("w-full", className)} role="status" aria-label="内容加载中" {...props}>
      {variant === "card" && <CardSkeleton />}
      {variant === "list" && <ListSkeleton rows={rows} />}
      {variant === "table" && <TableSkeleton cols={cols} tableRows={tableRows} />}
      <span className="sr-only">加载中…</span>
    </div>
  );
}

/* ====================================================================
   ProgressBar - 进度条
   ==================================================================== */

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 当前进度 0-100 */
  percent: number;
  /** 是否显示百分比文字 */
  showLabel?: boolean;
  /** 条纹动画 */
  animated?: boolean;
  /** 尺寸 */
  size?: "sm" | "md" | "lg";
  /** 自定义颜色 (Tailwind class) */
  color?: string;
}

const progressBarHeight: Record<string, string> = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
};

/**
 * ProgressBar 进度条
 * @example
 * <ProgressBar percent={65} />
 * <ProgressBar percent={42} showLabel animated size="lg" />
 */
export function ProgressBar({
  percent,
  showLabel = false,
  animated = true,
  size = "md",
  color = "bg-primary",
  className,
  ...props
}: ProgressBarProps) {
  const clampedPercent = Math.max(0, Math.min(100, percent));

  return (
    <div className={cn("w-full", className)} {...props}>
      {showLabel && (
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">进度</span>
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {Math.round(clampedPercent)}%
          </span>
        </div>
      )}
      <div
        className={cn(
          "w-full rounded-full bg-muted overflow-hidden",
          progressBarHeight[size]
        )}
        role="progressbar"
        aria-valuenow={clampedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className={cn(
            "h-full rounded-full",
            color,
            animated && "bg-[length:1rem_1rem] bg-gradient-to-r from-transparent via-white/20 to-transparent"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${clampedPercent}%` }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        />
      </div>
    </div>
  );
}

/* ====================================================================
   FullPageLoading - 全屏加载（带品牌 logo 动画）
   ==================================================================== */

export interface FullPageLoadingProps {
  /** 是否显示 */
  show?: boolean;
  /** 提示文字 */
  text?: string;
  /** 背景模糊 */
  blur?: boolean;
  /** 自定义 logo 节点 */
  logo?: React.ReactNode;
  /** z-index */
  zIndex?: number;
}

/** 品牌 Logo 动画（默认内置） */
function BrandLogo() {
  return (
    <motion.div
      className="relative size-16"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
    >
      {/* 外圈 */}
      <motion.div
        className="absolute inset-0 rounded-full border-2 border-primary/30"
        animate={{ scale: [1, 1.15, 1] }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
      />
      {/* 中圈 */}
      <motion.div
        className="absolute inset-2 rounded-full border-2 border-t-primary border-r-transparent border-b-transparent border-l-primary"
        animate={{ rotate: -360 }}
        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
      />
      {/* 内核 */}
      <motion.div
        className="absolute inset-4 rounded-full bg-primary"
        animate={{ scale: [0.8, 1, 0.8], opacity: [0.6, 1, 0.6] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
      />
    </motion.div>
  );
}

/**
 * FullPageLoading 全屏加载遮罩
 * @example
 * <FullPageLoading show={isLoading} />
 * <FullPageLoading show={isLoading} text="正在同步数据…" />
 * <FullPageLoading show={isLoading} logo={<MyLogo />} blur />
 */
export function FullPageLoading({
  show = true,
  text = "加载中…",
  blur = true,
  logo,
  zIndex = 50,
}: FullPageLoadingProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className={cn(
            "fixed inset-0 flex flex-col items-center justify-center gap-6 bg-background/80",
            blur && "backdrop-blur-sm"
          )}
          style={{ zIndex }}
          role="dialog"
          aria-modal="true"
          aria-label="加载中"
        >
          {logo ?? <BrandLogo />}
          {text && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-sm font-medium text-muted-foreground tracking-wide"
            >
              {text}
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ====================================================================
   统一导出
   ==================================================================== */

export { spinnerVariants };
