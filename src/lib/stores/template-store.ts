import { createPersistentStorage } from "./persistent-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Shot } from "@/lib/db/schema";

/** Script template */
export interface ScriptTemplate {
  id: string;
  /** Template name */
  name: string;
  /** Template description */
  description?: string;
  /** Applicable category */
  category?: string;
  /** Applicable video mode */
  videoMode?: string;
  /** Script style */
  styleType?: string;
  /** Script structure */
  shots: Shot[];
  /** Total duration */
  totalDuration?: number;
  /** Source project ID */
  sourceProjectId?: string;
  /** Usage count */
  useCount: number;
  /** Creation time */
  createdAt: Date;
}

interface TemplateState {
  /** List of saved templates */
  templates: ScriptTemplate[];
  /** Add a template */
  addTemplate: (template: ScriptTemplate) => void;
  /** Remove a template */
  removeTemplate: (id: string) => void;
  /** Increment the usage count */
  incrementUseCount: (id: string) => void;
}

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set) => ({
      templates: [],

      addTemplate: (template) =>
        set((state) => ({
          templates: [...state.templates, template],
        })),

      removeTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        })),

      incrementUseCount: (id) =>
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, useCount: t.useCount + 1 } : t
          ),
        })),
    }),
    {
      name: "daihuo-jianshou-templates",
      storage: createPersistentStorage<TemplateState>(),
    }
  )
);
