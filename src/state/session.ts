import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { Account, Face } from '@/features/auth/types';
import i18n, { deviceLang, type Lang } from '@/lib/i18n';

const secureStorage: StateStorage = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
};

type SessionState = {
  account: Account | null;
  /** Which login face is open. Null while a dual-role user hasn't chosen. */
  face: Face | null;
  lang: Lang;
  hydrated: boolean;
  /** Per-account Family onboarding (consent + reminder channels), keyed by account id. */
  familyPrefs: Record<string, { consentAt: string; consentVersion: string; channels: string[]; lock?: boolean }>;
  completeOnboarding: (accountId: string, channels: string[]) => void;
  setChannels: (accountId: string, channels: string[]) => void;
  setLock: (accountId: string, on: boolean) => void;
  signIn: (account: Account) => void;
  chooseFace: (face: Face) => void;
  signOut: () => void;
  setLang: (lang: Lang) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      account: null,
      face: null,
      lang: deviceLang(),
      hydrated: false,
      familyPrefs: {},
      completeOnboarding: (accountId, channels) =>
        set((s) => ({ familyPrefs: { ...s.familyPrefs, [accountId]: { consentAt: new Date().toISOString(), consentVersion: 'v1', channels } } })),
      setChannels: (accountId, channels) =>
        set((s) => (s.familyPrefs[accountId] ? { familyPrefs: { ...s.familyPrefs, [accountId]: { ...s.familyPrefs[accountId]!, channels } } } : s)),
      setLock: (accountId, on) =>
        set((s) => (s.familyPrefs[accountId] ? { familyPrefs: { ...s.familyPrefs, [accountId]: { ...s.familyPrefs[accountId]!, lock: on } } } : s)),
      signIn: (account) => set({ account, face: account.faces.length === 1 ? account.faces[0]! : null }),
      chooseFace: (face) => set((s) => (s.account?.faces.includes(face) ? { face } : s)),
      signOut: () => set({ account: null, face: null }),
      setLang: (lang) => {
        void i18n.changeLanguage(lang);
        set({ lang });
      },
    }),
    {
      name: 'session.v1',
      storage: createJSONStorage(() => secureStorage),
      partialize: (s) => ({ account: s.account, face: s.face, lang: s.lang, familyPrefs: s.familyPrefs }),
      onRehydrateStorage: () => (state) => {
        // Resources are bundled, so this switches synchronously before first paint.
        void i18n.changeLanguage(state?.lang ?? deviceLang());
        useSession.setState({ hydrated: true });
      },
    },
  ),
);

/** Where the root index should send this session. */
export function homeHref(s: Pick<SessionState, 'account' | 'face'>) {
  if (!s.account) return '/welcome' as const;
  if (!s.face) return '/choose-face' as const;
  return s.face === 'care' ? ('/care' as const) : ('/family' as const);
}
