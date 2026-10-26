import { createPersistentStorage } from "./persistent-storage";
import { randomUUID } from "@/lib/uuid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// brand configuration
export interface BrandConfig {
  id: string;
  name: string; // brand / store name
  logoUrl?: string; // logo image URL
  primaryColor: string; // primary color (hex)
  secondaryColor: string; // secondary color (hex)
  fontFamily: string; // font family
  watermark: {
    enabled: boolean;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    opacity: number; // 0.1–1.0
    scale: number; // 0.1–0.5
  };
  introEnabled: boolean; // whether to show an intro card
  outroEnabled: boolean; // whether to show an outro card
  outroText?: string; // outro text (e.g. "关注我们获取更多好物推荐")
}

interface BrandState {
  brand: BrandConfig;
  updateBrand: (updates: Partial<BrandConfig>) => void;
  updateWatermark: (updates: Partial<BrandConfig["watermark"]>) => void;
}

export const useBrandStore = create<BrandState>()(
  persist(
    (set) => ({
      brand: {
        id: randomUUID(),
        name: "我的店铺",
        primaryColor: "#6366f1",
        secondaryColor: "#8b5cf6",
        fontFamily: "默认字体",
        watermark: {
          enabled: false,
          position: "bottom-right",
          opacity: 0.3,
          scale: 0.15,
        },
        introEnabled: false,
        outroEnabled: false,
      },
      // update brand config (shallow merge)
      updateBrand: (updates) =>
        set((state) => ({
          brand: { ...state.brand, ...updates },
        })),
      // update watermark config (shallow merge)
      updateWatermark: (updates) =>
        set((state) => ({
          brand: {
            ...state.brand,
            watermark: { ...state.brand.watermark, ...updates },
          },
        })),
    }),
    {
      storage: createPersistentStorage<BrandState>(),
      name: "daihuo-jianshou-brand",
    }
  )
);
