import { createPersistentStorage } from "./persistent-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// product entry
export interface ProductItem {
  id: string;
  name: string;
  category: "beauty" | "food" | "home" | "fashion" | "tech" | "other";
  description?: string;
  images: string[]; // local blob URLs or server URLs
  price?: string;
  targetAudience?: string;
  videoCount: number;
  createdAt: Date;
}

// product library state
interface ProductLibraryState {
  products: ProductItem[];
  addProduct: (product: ProductItem) => void;
  updateProduct: (id: string, updates: Partial<ProductItem>) => void;
  removeProduct: (id: string) => void;
  incrementVideoCount: (id: string) => void;
}

export const useProductLibraryStore = create<ProductLibraryState>()(
  persist(
    (set) => ({
      products: [],

      // add a product
      addProduct: (product) =>
        set((state) => ({ products: [...state.products, product] })),

      // update a product
      updateProduct: (id, updates) =>
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      // remove a product
      removeProduct: (id) =>
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
        })),

      // increment video generation count
      incrementVideoCount: (id) =>
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...p, videoCount: p.videoCount + 1 } : p
          ),
        })),
    }),
    {
      name: "daihuo-jianshou-products",
      storage: createPersistentStorage<ProductLibraryState>(),
    }
  )
);
