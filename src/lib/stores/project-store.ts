import { createPersistentStorage } from "./persistent-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Shot, CharacterVoiceProfile } from "@/lib/db/schema";

// ==================== Character ====================

export interface Character {
  id: string;
  name: string;
  description?: string;
  /** Appearance description (English, injected into AI prompts) */
  appearance?: string;
  /** List of reference image URLs */
  referenceImages: string[];
  /** Voice preference */
  voiceProfile?: CharacterVoiceProfile;
  /** Whether this is the default on-screen character */
  isDefault?: boolean;
}

// ==================== Project ====================

export type Step = "upload" | "script" | "assets" | "video" | "export";

export interface Project {
  id: string;
  name: string;
  status: string;
  productName?: string;
  productCategory?: string;
  productDescription?: string;
  productImages: string[];
  productAnalysis?: string;
  /** On-screen character bound to this project */
  characterId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Script {
  id: string;
  projectId: string;
  version: number;
  styleType: string;
  title?: string;
  totalDuration?: number;
  shots: Shot[];
  selected: boolean;
}

// ==================== Store ====================

interface ProjectState {
  currentProject: Project | null;
  projects: Project[];
  currentStep: Step;
  /** Character currently used by the project */
  currentCharacter: Character | null;

  setCurrentProject: (project: Project | null) => void;
  setProjects: (projects: Project[]) => void;
  setCurrentStep: (step: Step) => void;
  updateProject: (updates: Partial<Project>) => void;
  setCurrentCharacter: (character: Character | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  projects: [],
  currentStep: "upload",
  currentCharacter: null,

  setCurrentProject: (project) => set({ currentProject: project }),
  setProjects: (projects) => set({ projects }),
  setCurrentStep: (step) => set({ currentStep: step }),
  updateProject: (updates) =>
    set((state) => ({
      currentProject: state.currentProject
        ? { ...state.currentProject, ...updates }
        : null,
      // keep the corresponding entry in the projects array in sync
      projects: state.currentProject
        ? state.projects.map((p) =>
            p.id === state.currentProject!.id
              ? { ...p, ...updates }
              : p
          )
        : state.projects,
    })),
  setCurrentCharacter: (character) => set({ currentCharacter: character }),
}));

// ==================== Character Library Store (persisted) ====================

interface CharacterState {
  characters: Character[];
  addCharacter: (character: Character) => void;
  updateCharacter: (id: string, updates: Partial<Character>) => void;
  removeCharacter: (id: string) => void;
  getDefault: () => Character | undefined;
  /** Set the specified character as default and clear the default flag on all others */
  setDefault: (id: string) => void;
}

export const useCharacterStore = create<CharacterState>()(
  persist(
    (set, get) => ({
      characters: [],

      addCharacter: (character) =>
        set((state) => ({ characters: [...state.characters, character] })),

      updateCharacter: (id, updates) =>
        set((state) => ({
          characters: state.characters.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),

      removeCharacter: (id) =>
        set((state) => ({
          characters: state.characters.filter((c) => c.id !== id),
        })),

      getDefault: () => get().characters.find((c) => c.isDefault),

      setDefault: (id) =>
        set((state) => ({
          characters: state.characters.map((c) =>
            c.id === id
              ? { ...c, isDefault: true }
              : { ...c, isDefault: false }
          ),
        })),
    }),
    { name: "daihuo-jianshou-characters", storage: createPersistentStorage<CharacterState>() }
  )
);
