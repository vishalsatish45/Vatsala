import { create } from 'zustand';

/** Care Team idle lock (PRD §15.1). Shared so dev tools can lock immediately. */
export const useCareLock = create<{ locked: boolean; lock: () => void; release: () => void }>()((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  release: () => set({ locked: false }),
}));
