/**
 * Keeps the store in step with Supabase. Supabase mode only; imported once by the root layout.
 *
 *  - Loads what the signed-in person may see for the open face: Care Team → RLS-filtered tables, Family → read
 *    functions. Reloads when the outbox has sent everything, when a write is refused (undoing it on screen), when
 *    another phone changes something (Realtime), and when the app returns to the foreground.
 *  - Driven by session-store subscriptions, not screen effects.
 *  - Sign-out stops Realtime, drops unsent writes and clears every record from memory. A session the server
 *    ended does the same, except that unsent writes stay saved (encrypted) for the same account's next sign-in.
 *    A session that merely cannot be refreshed right now (offline) keeps the account signed in.
 */
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { emptyState, loadCareSnapshot, loadFamilySnapshot, NeedsConsent, RemoteError, type FamilyWho } from './remote';
import { clearOutbox, drain, enqueue, isSessionGone, restoreOutbox, setOutboxHooks, suspendOutbox, useOutbox, writeCount } from './outbox';
import { useDb } from './store';
import { authService } from '@/features/auth/service';
import { registerPush, unregisterPush } from '@/features/push/register';
import type { Account } from '@/features/auth/types';
import { isRemote, supabase } from '@/lib/supabase';
import { purposesFor, useSession } from '@/state/session';

type SyncState = {
  /** idle: nothing to load · loading: first load · ready: data on screen · error: first load failed */
  phase: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
};

export const useSync = create<SyncState>()(() => ({ phase: 'idle' }));

/** Tables whose changes the Care Team sees live (all in the supabase_realtime publication). */
const LIVE_TABLES = [
  'callbacks', 'tasks', 'referrals', 'referral_events', 'investigations', 'investigation_results', 'encounters', 'self_logs',
  'babies', 'immunizations', 'discharges', 'pregnancies', 'tags', 'admissions', 'care_assignments', 'notifications',
];
const FAMILY_POLL_MS = 60_000;
/** Backstop for a missed Realtime event (a cold channel, a dropped socket): the Care Team also reloads every 2 minutes. */
const CARE_POLL_MS = 120_000;

let loadedFor: string | undefined; // `${account id}:${face}` whose data is on screen
let refreshing = false;
let again = false;
let poll: ReturnType<typeof setInterval> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
/** Set just before signing out because the server ended the session (not the user): unsent writes are kept. */
let sessionEnded = false;

const keyOf = (a: Account | null, face: string | null) => (a && face ? `${a.id}:${face}` : undefined);

function familyWho(a: Account): FamilyWho {
  return { motherId: a.family?.motherId, phone: a.phone, name: a.name, role: a.family?.role ?? 'mother' };
}

/** Reload from the server. Skipped while writes are waiting (they would vanish from screen until sent). */
export async function refresh(): Promise<void> {
  if (!isRemote) return;
  const { account, face, familyPrefs } = useSession.getState();
  const key = keyOf(account, face);
  if (!account || !face || !key) return;
  if (face === 'family' && !familyPrefs[account.id]) return; // onboarding (consent) comes first
  if (refreshing) {
    again = true;
    return;
  }
  if (useOutbox.getState().queue.length && loadedFor === key) return; // the drained hook reloads afterwards
  refreshing = true;
  if (loadedFor !== key) useSync.setState({ phase: 'loading', error: undefined });
  const writesBefore = writeCount();
  try {
    const snap = face === 'care' ? await loadCareSnapshot(supabase()) : await loadFamilySnapshot(supabase(), familyWho(account));
    const now = useSession.getState();
    if (keyOf(now.account, now.face) !== key) return; // signed out or switched face meanwhile
    // A write made while the snapshot was loading (or still unsent) is not in it: showing it would undo that write on
    // screen and re-base its version check. Load again once the queue is empty (the drained hook) instead.
    if (loadedFor === key && (writeCount() !== writesBefore || useOutbox.getState().queue.length)) {
      again = true;
      return;
    }
    useDb.getState().hydrate(snap.state);
    useOutbox.setState({ versions: snap.versions });
    loadedFor = key;
    useSync.setState({ phase: 'ready', error: undefined });
  } catch (e) {
    if (e instanceof NeedsConsent) {
      // Consent withdrawn elsewhere or caregiver removed: back to onboarding, which asks again.
      useSession.getState().forgetConsent(account.id);
      useDb.getState().hydrate(emptyState());
      loadedFor = undefined;
      useSync.setState({ phase: 'idle' });
    } else {
      const message = e instanceof RemoteError || e instanceof Error ? e.message : String(e);
      useSync.setState(loadedFor === key ? { phase: 'ready', error: message } : { phase: 'error', error: message });
    }
  } finally {
    refreshing = false;
    if (again) {
      again = false;
      void refresh();
    }
  }
}

function refreshSoon() {
  clearTimeout(debounce);
  debounce = setTimeout(() => void refresh(), 700);
}

function stopLive() {
  // Every channel this module opened, including any left by an earlier copy of it (Fast Refresh re-runs this file
  // while the Supabase client lives on). removeChannel is async; the next channel gets a fresh topic regardless.
  for (const ch of supabase().getChannels()) if (/^realtime:(care|family):/.test(ch.topic)) void supabase().removeChannel(ch);
  clearInterval(poll);
  poll = undefined;
}

function startLive(account: Account, face: 'care' | 'family') {
  stopLive();
  // A unique topic per subscription: supabase.channel() hands back an existing channel of the same name, and one
  // that is already subscribed refuses new listeners.
  const topic = `${face}:${account.id}:${randomUUID().slice(0, 8)}`;
  if (face === 'care') {
    // Row-level security applies to Realtime: each clinician hears only about rows she may read.
    let c = supabase().channel(topic);
    for (const table of LIVE_TABLES) c = c.on('postgres_changes', { event: '*', schema: 'public', table }, refreshSoon);
    c.subscribe();
    poll = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, CARE_POLL_MS);
  } else {
    // Families read no tables; their own notifications (appointment booked, baby arrived) are the live signal.
    supabase()
      .channel(topic)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${account.id}` }, refreshSoon)
      .subscribe();
    poll = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, FAMILY_POLL_MS);
  }
}

/** Open the face's data: clear what was on screen, load, and listen for changes. */
function open(account: Account, face: 'care' | 'family') {
  useDb.getState().hydrate(emptyState());
  loadedFor = undefined;
  startLive(account, face);
  void refresh();
}

/** Sign-out. `keepWrites`: the server ended the session — unsent writes stay saved for this account's next sign-in. */
function close(keepWrites: boolean) {
  stopLive();
  if (keepWrites) suspendOutbox();
  else clearOutbox();
  useDb.getState().hydrate(emptyState());
  loadedFor = undefined;
  useSync.setState({ phase: 'idle', error: undefined });
}

// ── Family consent (sent at once, not queued: the app opens only after the server has it) ──

/** Onboarding: record the notice she accepted and the reminder channels she chose. */
export async function recordConsent(channels: string[], lang: string): Promise<void> {
  if (!isRemote) return;
  const a = useSession.getState().account;
  if (!a?.family) return;
  const { error } = await supabase().rpc('record_consent', {
    p: {
      idempotency_key: randomUUID(),
      mother_id: a.family.motherId,
      notice_version: 'v1',
      lang,
      purposes: purposesFor(channels, a.family.role),
      decision: 'accepted',
    },
  });
  if (error) throw new RemoteError(error.message, error.code);
}

/** Settings: a new channel choice replaces her consent (same notice, new purposes). Queued like any write. */
export function changeChannels(channels: string[], lang: string) {
  const a = useSession.getState().account;
  if (!a?.family) return;
  enqueue('record_consent', { mother_id: a.family.motherId, notice_version: 'v1', lang, purposes: purposesFor(channels, a.family.role), decision: 'accepted' });
}

/** Withdrawal must reach the server before the phone signs out (sign-out drops anything unsent). */
export async function withdrawConsent(): Promise<void> {
  if (!isRemote) return;
  const a = useSession.getState().account;
  if (!a?.family) return;
  const { error } = await supabase().rpc('withdraw_consent', {
    p: { idempotency_key: randomUUID(), mother_id: a.family.motherId, reason: 'Withdrawn in the app' },
  });
  if (error) throw new RemoteError(error.message, error.code);
}

// ── wiring ────────────────────────────────────────────────────────────────────────

if (isRemote) {
  setOutboxHooks({
    drained: () => void refresh(),
    failed: () => void refresh(),
    sessionLost: endedByServer,
  });

  // Session changes: sign-in, face switch, sign-out.
  useSession.subscribe((s, prev) => {
    if (s.hydrated && !prev.hydrated) return void boot();
    if (s.account && s.account.id !== prev.account?.id && s.account.family?.consentPurposes) {
      s.adoptServerConsent(s.account.id, s.account.family.consentPurposes);
    }
    if (s.hydrated && prev.hydrated && s.account && s.account.id !== prev.account?.id) {
      // Signed in: writes this account left unsent when its session ended are sent now (another account's are deleted).
      void restoreOutbox(s.account.id).then(() => drain());
      void registerPush();
    }
    if (!s.account && prev.account) {
      close(sessionEnded);
      sessionEnded = false;
      // Remove this phone's push token while the session still exists, then end the session.
      void unregisterPush().finally(() => authService.signOut());
      return;
    }
    if (!s.hydrated || !s.account || !s.face) return;
    if (keyOf(s.account, s.face) !== keyOf(prev.account, prev.face)) open(s.account, s.face);
    else if (s.face === 'family' && s.familyPrefs[s.account.id] && !prev.familyPrefs[s.account.id]) void refresh(); // onboarding done
  });

  // Back in the foreground: catch up on anything missed while in the background.
  AppState.addEventListener('change', (st) => {
    if (st === 'active') {
      void drain();
      void refresh();
    }
  });

  supabase().auth.onAuthStateChange((event) => {
    // While an account is open, SIGNED_OUT comes from the client itself: the server refused the refresh token.
    if (event === 'SIGNED_OUT' && useSession.getState().account) endedByServer();
  });

  if (useSession.getState().hydrated) void boot();
}

/** The server ended the session: sign out, keeping unsent writes saved for this account's next sign-in. */
function endedByServer() {
  if (!useSession.getState().account) return;
  sessionEnded = true;
  useSession.getState().signOut();
}

/**
 * Cold start, once the saved session is read: restore unsent writes, and sign out only if the server has ended the
 * session. An expired token that cannot be refreshed for lack of network keeps the account signed in (it is
 * refreshed when the phone is back online).
 */
async function boot() {
  const { account, face } = useSession.getState();
  if (!account) return; // a queue left by a lost session waits, saved, for that account's sign-in
  await restoreOutbox(account.id);
  const { data, error } = await supabase().auth.getSession();
  if (useSession.getState().account?.id !== account.id) return; // signed out meanwhile
  if (!data.session && (!error || isSessionGone(error))) return endedByServer();
  if (face) open(account, face);
  void drain();
  void registerPush();
}
