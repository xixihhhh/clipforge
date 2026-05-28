import { create } from "zustand";

// Toast 类型
export type ToastType = "success" | "error" | "info" | "warning";

// 单条 Toast 消息
export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** 是否正在退出动画中 */
  exiting?: boolean;
}

// 便捷选项
interface ToastOptions {
  /** 持续时间（毫秒），默认 3000 */
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string, options?: ToastOptions) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

let idCounter = 0;
const nextId = () => `toast-${++idCounter}-${Date.now()}`;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  addToast: (type, message, options) => {
    const id = nextId();
    const duration = options?.duration ?? 3000;

    // 追加到队列末尾
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }],
    }));

    // 自动移除：先触发退出动画，再真正删除
    setTimeout(() => {
      // 标记为 exiting
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === id ? { ...t, exiting: true } : t
        ),
      }));
      // 300ms 后真正删除（配合动画时长）
      setTimeout(() => {
        get().removeToast(id);
      }, 300);
    }, duration);

    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => set({ toasts: [] }),
}));

// ---- 快捷调用方法 ----
export const toast = {
  success: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast("success", message, options),
  error: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast("error", message, options),
  info: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast("info", message, options),
  warning: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast("warning", message, options),
};
