import { create } from "zustand";

interface LoadingState {
  /** 全局加载是否可见 */
  isLoading: boolean;
  /** 加载提示文字 */
  loadingText: string;
  /** 显示全局加载 */
  show: (text?: string) => void;
  /** 隐藏全局加载 */
  hide: () => void;
}

export const useLoadingStore = create<LoadingState>((set) => ({
  isLoading: false,
  loadingText: "加载中…",
  show: (text = "加载中…") => set({ isLoading: true, loadingText: text }),
  hide: () => set({ isLoading: false }),
}));
