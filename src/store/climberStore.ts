import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_FLEX, DEFAULT_HEIGHT, type ClimberTemplate } from "@/lib/bodyModel";

/**
 * Named climbers used by the editor's body overlay. Switching template swaps
 * the height and ape index, and each climber has their own set of saved poses.
 */
interface ClimberState {
  templates: ClimberTemplate[];
  activeId: string;
  addTemplate: (name: string, height?: number, ape?: number) => string;  updateTemplate: (id: string, patch: Partial<Omit<ClimberTemplate, "id">>) => void;
  removeTemplate: (id: string) => void;
  setActive: (id: string) => void;
}

export const DEFAULT_CLIMBER: ClimberTemplate = {
  id: "me",
  name: "Me",
  height: DEFAULT_HEIGHT,
  ape: 0,
  flex: DEFAULT_FLEX,
};

export const useClimberStore = create<ClimberState>()(
  persist(
    (set, get) => ({
      templates: [DEFAULT_CLIMBER],
      activeId: DEFAULT_CLIMBER.id,

      addTemplate: (name, height = DEFAULT_HEIGHT, ape = 0) => {
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        set((s) => ({
          templates: [
            ...s.templates,
            { id, name: name.trim() || "Climber", height, ape, flex: DEFAULT_FLEX },
          ],
          activeId: id,
        }));
        return id;
      },

      updateTemplate: (id, patch) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      removeTemplate: (id) => {
        const { templates, activeId } = get();
        if (templates.length <= 1) return; // always keep one
        const next = templates.filter((t) => t.id !== id);
        set({ templates: next, activeId: activeId === id ? next[0].id : activeId });
      },

      setActive: (id) => {
        if (get().templates.some((t) => t.id === id)) set({ activeId: id });
      },
    }),
    {
      name: "kilter-climbers",
      version: 1,
      // Climbers saved before flexibility existed have no `flex`; default it so
      // they do not come back as `undefined` and blow up the ROM lookup.
      migrate: (persisted, version) => {
        const state = persisted as { templates?: ClimberTemplate[] } | undefined;
        if (version < 1 && state?.templates) {
          state.templates = state.templates.map((t) => ({
            ...t,
            flex: t.flex ?? DEFAULT_FLEX,
          }));
        }
        return persisted;
      },
    }
  )
);

export function useActiveClimber(): ClimberTemplate {
  return useClimberStore(
    (s) => s.templates.find((t) => t.id === s.activeId) ?? s.templates[0] ?? DEFAULT_CLIMBER
  );
}
