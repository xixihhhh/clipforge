"use client";

import { useToastStore, type ToastItem, type ToastType } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  图标映射                                                          */
/* ------------------------------------------------------------------ */
const iconMap: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

/* ------------------------------------------------------------------ */
/*  样式映射（兼容亮/暗色主题）                                        */
/* ------------------------------------------------------------------ */
const typeStyles: Record<ToastType, { container: string; icon: string; bar: string }> = {
  success: {
    container:
      "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950",
    icon: "text-emerald-500 dark:text-emerald-400",
    bar: "bg-emerald-500 dark:bg-emerald-400",
  },
  error: {
    container:
      "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
    icon: "text-red-500 dark:text-red-400",
    bar: "bg-red-500 dark:bg-red-400",
  },
  info: {
    container:
      "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
    icon: "text-blue-500 dark:text-blue-400",
    bar: "bg-blue-500 dark:bg-blue-400",
  },
  warning: {
    container:
      "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
    icon: "text-amber-500 dark:text-amber-400",
    bar: "bg-amber-500 dark:bg-amber-400",
  },
};

/* ------------------------------------------------------------------ */
/*  单条 Toast                                                        */
/* ------------------------------------------------------------------ */
function ToastItemView({ toast }: { toast: ToastItem }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const Icon = iconMap[toast.type];
  const styles = typeStyles[toast.type];

  return (
    <div
      role="alert"
      className={cn(
        // 布局
        "relative flex items-start gap-3 w-full max-w-sm overflow-hidden",
        "rounded-lg border p-4 pr-10 shadow-lg",
        // 动画
        "transition-all duration-300 ease-in-out",
        toast.exiting
          ? "translate-x-full opacity-0"
          : "animate-in slide-in-from-right-full fade-in",
        styles.container
      )}
    >
      {/* 图标 */}
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", styles.icon)} />

      {/* 文案 */}
      <p className="text-sm font-medium leading-relaxed text-foreground">
        {toast.message}
      </p>

      {/* 关闭按钮 */}
      <button
        onClick={() => removeToast(toast.id)}
        className={cn(
          "absolute right-2 top-3 p-0.5 rounded-md",
          "text-muted-foreground hover:text-foreground",
          "transition-colors"
        )}
        aria-label="关闭"
      >
        <X className="h-4 w-4" />
      </button>

      {/* 底部进度条（3 秒渐减） */}
      <div className="absolute bottom-0 left-0 h-[3px] w-full bg-transparent">
        <div
          className={cn("h-full rounded-full", styles.bar)}
          style={{
            animation: "toast-progress 3s linear forwards",
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ToastContainer —— 在 layout 全局挂载                               */
/* ------------------------------------------------------------------ */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <>
      {/* 内联 keyframes（仅此组件需要） */}
      <style>{`
        @keyframes toast-progress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>

      {/* 固定在右上角，堆叠 */}
      <div
        aria-live="polite"
        aria-label="通知"
        className={cn(
          "fixed top-4 right-4 z-[9999]",
          "flex flex-col items-end gap-2",
          "pointer-events-none"
        )}
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItemView toast={t} />
          </div>
        ))}
      </div>
    </>
  );
}

export default ToastContainer;
