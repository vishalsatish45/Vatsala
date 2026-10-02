import { create } from 'zustand';

import type { RegisterForm } from '@/features/care/forms';

/**
 * The last registration as typed, kept in memory until it is saved. If the server refuses it (the optimistic record
 * then disappears on reload), the Register screen offers to restore the form instead of losing what was typed.
 * Not persisted: it holds patient details, and a restart starts clean.
 */
type DraftState = {
  draft?: { values: RegisterForm; pregnancyId: string };
  keep: (values: RegisterForm, pregnancyId: string) => void;
  clear: () => void;
};

export const useRegisterDraft = create<DraftState>()((set) => ({
  keep: (values, pregnancyId) => set({ draft: { values, pregnancyId } }),
  clear: () => set({ draft: undefined }),
}));
