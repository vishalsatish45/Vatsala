import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { Account, Face } from '@/features/auth/types';
import { cancelReminders } from '@/features/family/reminders';
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
  /** PRD F-03: withdrawing consent stops app access; the hospital record is retained. */
  withdrawConsent: (accountId: string) => void;
  /** Supabase mode: the server already holds this person's consent (e.g. a new phone) — no onboarding again. */
  adoptServerConsent: (accountId: string, purposes: string[]) => void;
  /** Supabase mode: the server has no active consent (withdrawn elsewhere, caregiver removed) — onboarding again. */
  forgetConsent: (accountId: string) => void;
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
      withdrawConsent: (accountId) => {
        void cancelReminders();
        set((s) => {
          const { [accountId]: _removed, ...rest } = s.familyPrefs;
          return { familyPrefs: rest, account: null, face: null };
        });
      },
      adoptServerConsent: (accountId, purposes) =>
        set((s) => ({
          familyPrefs: {
            ...s.familyPrefs,
            [accountId]: {
              ...s.familyPrefs[accountId],
              consentAt: s.familyPrefs[accountId]?.consentAt ?? new Date().toISOString(),
              consentVersion: 'v1',
              channels: channelsOf(purposes),
            },
          },
        })),
      forgetConsent: (accountId) =>
        set((s) => {
          const { [accountId]: _removed, ...rest } = s.familyPrefs;
          return { familyPrefs: rest };
        }),
      signIn: (account) => set({ account, face: account.faces.length === 1 ? account.faces[0]! : null }),
      chooseFace: (face) => set((s) => (s.account?.faces.includes(face) ? { face } : s)),
      // Reminders scheduled on this phone belong to the person signing out (shared phones): cancel them all.
      signOut: () => {
        void cancelReminders();
        set({ account: null, face: null });
      },
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

/** Reminder channels are the accepted `reminders_*` consent purposes. */
export const channelsOf = (purposes: string[]) => purposes.filter((p) => p.startsWith('reminders_')).map((p) => p.slice('reminders_'.length));

/** The consent purposes for a set of reminder channels; caregiver sharing is the mother's alone to give. */
export const purposesFor = (channels: string[], role: 'mother' | 'caregiver') => [
  'app',
  ...channels.map((c) => `reminders_${c}`),
  ...(role === 'mother' ? ['caregiver_sharing'] : []),
];

/** Where the root index should send this session. */
export function homeHref(s: Pick<SessionState, 'account' | 'face'>) {
  if (!s.account) return '/welcome' as const;
  if (!s.face) return '/choose-face' as const;
  return s.face === 'care' ? ('/care' as const) : ('/family' as const);
}
