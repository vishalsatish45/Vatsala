import { create } from 'zustand';

export type FamilyFocus = 'mother' | 'baby';

/**
 * Which person the shared Family screens (Home, Schedule, My health / My baby, Learn) are
 * showing after delivery. Before delivery there is only the mother, so this is ignored.
 */
export const useFamilyFocusStore = create<{ focus: FamilyFocus; setFocus: (f: FamilyFocus) => void }>()((set) => ({
  focus: 'baby',
  setFocus: (focus) => set({ focus }),
}));
