import { createJSONStorage, type StateStorage } from "zustand/middleware";

declare global {
  interface Window {
    clipforgeStorage?: {
      getItem(name: string): string | null;
      setItem(name: string, value: string): void;
      removeItem(name: string): void;
    };
  }
}

/** Desktop writes through the preload bridge; web installs retain browser storage. */
export const persistentStorage: StateStorage = {
  getItem(name) {
    if (typeof window === "undefined") return null;
    const desktop = window.clipforgeStorage;
    if (!desktop) return window.localStorage.getItem(name);
    const saved = desktop.getItem(name);
    if (saved !== null) return saved;
    const legacy = window.localStorage.getItem(name);
    if (legacy !== null) desktop.setItem(name, legacy);
    return legacy;
  },
  setItem(name, value) {
    if (typeof window === "undefined") return;
    (window.clipforgeStorage ?? window.localStorage).setItem(name, value);
  },
  removeItem(name) {
    if (typeof window === "undefined") return;
    window.clipforgeStorage?.removeItem(name);
    window.localStorage.removeItem(name);
  },
};

export function createPersistentStorage<T>() {
  return createJSONStorage<T>(() => persistentStorage, {
    reviver: (key, value) => key === "createdAt" && typeof value === "string" ? new Date(value) : value,
  });
}
