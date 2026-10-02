import { create } from 'zustand';

import { env } from './env';

/**
 * Connectivity + outbox state (PRD F-61). Records created while offline are marked
 * pending and shown with ⏳; when the device is back online they sync and show ✓.
 * Mock mode simulates the sync locally; in Supabase mode the outbox (src/data/outbox.ts) sets
 * `pending` / `justSynced` from the intents it actually sends.
 */
const simulated = env.authMode === 'mock';
type NetState = {
  online: boolean;
  /** Dev tool: force offline to demo the banner and sync badges. */
  simulateOffline: boolean;
  pending: string[];
  justSynced: string[];
  setOnline: (online: boolean) => void;
  setSimulateOffline: (on: boolean) => void;
  markPending: (id: string) => void;
};

let syncTimer: ReturnType<typeof setTimeout> | undefined;

export const useNetwork = create<NetState>()((set, get) => {
  const flush = () => {
    if (!simulated || !isOnline(get())) return;
    const done = get().pending;
    if (!done.length) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      set({ pending: [], justSynced: done });
      setTimeout(() => set({ justSynced: [] }), 4000);
    }, 1500);
  };
  return {
    online: true,
    simulateOffline: false,
    pending: [],
    justSynced: [],
    setOnline: (online) => {
      set({ online });
      flush();
    },
    setSimulateOffline: (on) => {
      set({ simulateOffline: on });
      flush();
    },
    markPending: (id) => {
      if (!simulated || isOnline(get())) return;
      set((s) => ({ pending: [...s.pending, id] }));
    },
  };
});

export const isOnline = (s: Pick<NetState, 'online' | 'simulateOffline'>) => s.online && !s.simulateOffline;

export function useOnline() {
  return useNetwork((s) => isOnline(s));
}

/** 'pending' | 'synced' | undefined for a record id. */
export function useSyncState(id: string | undefined) {
  return useNetwork((s) => (!id ? undefined : s.pending.includes(id) ? 'pending' : s.justSynced.includes(id) ? 'synced' : undefined));
}
