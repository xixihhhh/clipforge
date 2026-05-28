"use client";

import { useEffect, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { FullPageLoading } from "@/components/Loading";
import { useLoadingStore } from "@/lib/stores/loading-store";

/* ------------------------------------------------------------------ */
/*  RouteLoadingDetector - 监听路由变化，自动触发全局 loading             */
/* ------------------------------------------------------------------ */
function RouteLoadingDetector() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { show, hide } = useLoadingStore();
  const isFirst = useRef(true);

  useEffect(() => {
    // 首次渲染不触发
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    hide();
  }, [pathname, searchParams, hide]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  GlobalLoadingOverlay - 读取 loading store 渲染全屏遮罩              */
/* ------------------------------------------------------------------ */
function GlobalLoadingOverlay() {
  const isLoading = useLoadingStore((s) => s.isLoading);
  const loadingText = useLoadingStore((s) => s.loadingText);

  return <FullPageLoading show={isLoading} text={loadingText} />;
}

/* ------------------------------------------------------------------ */
/*  GlobalProviders - 全局 Provider 组合                                */
/* ------------------------------------------------------------------ */
export default function GlobalProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <RouteLoadingDetector />
      </Suspense>
      {children}
      <GlobalLoadingOverlay />
      <ToastContainer />
    </ErrorBoundary>
  );
}
