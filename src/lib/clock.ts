import { create } from 'zustand';

/**
 * App clock. Everything that depends on "today" reads from here so the dev-only
 * time-travel control (PRD §12.4) can shift it for demos.
 */
type ClockState = { offsetDays: number; shift: (days: number) => void; reset: () => void };

export const useClock = create<ClockState>()((set) => ({
  offsetDays: 0,
  shift: (days) => set((s) => ({ offsetDays: s.offsetDays + days })),
  reset: () => set({ offsetDays: 0 }),
}));

export function useNow(): Date {
  const offset = useClock((s) => s.offsetDays);
  // Deliberately read at render: every screen shows "today" as of its latest render (plus demo time travel).
  // eslint-disable-next-line react-hooks/purity
  return new Date(Date.now() + offset * 86_400_000);
}
