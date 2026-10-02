/**
 * Outbox. Every write the app makes in Supabase mode is an intent:
 * {rpc, payload}, carrying one idempotency key for its whole life. Intents are kept on the phone, sent in
 * order, and retried with backoff while offline or when the server is unreachable — a retry can never apply
 * twice, because the server replays the stored response for a key it has seen.
 *
 * A refused intent (role, not visible, stale version, invalid input) is dropped and reported; the store is
 * then reloaded from the server, which undoes the optimistic change on screen.
 *
 * A version-checked intent carries the version its edit was based on, frozen into its payload at enqueue (or, for a
 * follow-up of this phone's own queued write to the same record, at its first attempt) and resent unchanged on every
 * retry: the idempotency hash covers it, and a reload in between never re-bases an offline edit on someone else's
 * newer change.
 *
 * Unsent writes belong to the account that made them. A lost session (the server ended it) signs out but keeps
 * them saved for the same account's next sign-in; only an explicit sign-out — or another account signing in —
 * deletes them. A network failure never does.
 *
 * An intent may carry a follow-up upload (a voice note, a paper-record photo): once the RPC has answered with the
 * server-chosen storage path, the local file is uploaded there (private bucket, never overwriting). The intent
 * stays at the head of the queue — persisted, encrypted — until the upload is done, and is retried like an RPC.
 */
import { randomUUID } from 'expo-crypto';
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { create } from 'zustand';

import { isOnline, useNetwork } from '@/lib/network';
import { secureStorage } from '@/lib/secureStorage';
import { isRemote, supabase } from '@/lib/supabase';

/** A file to upload after the RPC succeeds, to the path the server named in its response. */
export type Upload = {
  bucket: 'voice-notes' | 'documents';
  /** Response field holding the server-chosen path ('<bucket>/<mother>/<id>.<ext>'); null → nothing to upload. */
  pathFrom: string;
  localUri: string;
  contentType: string;
  /** Set once the RPC has answered: the object name inside the bucket. */
  path?: string;
};

export type Intent = {
  id: string;
  rpc: string;
  payload: Record<string, unknown>;
  /** The record this intent creates or changes: drives ⏳/✓ and the version check. */
  entityId?: string;
  /** Send the record's last known version, so a write over someone else's newer change is refused. */
  withVersion?: boolean;
  /** True once the version check is frozen into `payload` (see above); every retry resends it unchanged. */
  stamped?: boolean;
  /** Other rows whose server version this write also bumps (e.g. the test of a withdrawn result): forgotten on success. */
  alsoInvalidate?: string[];
  upload?: Upload;
  /** The RPC has been applied; only the upload remains. */
  rpcDone?: boolean;
  attempts: number;
};

type Failure = { rpc: string; message: string };

type OutboxState = {
  queue: Intent[];
  /** Row versions as last seen from the server, by row id. */
  versions: Record<string, number>;
  failure?: Failure;
  dismissFailure: () => void;
};

export const useOutbox = create<OutboxState>()((set) => ({
  queue: [],
  versions: {},
  dismissFailure: () => set({ failure: undefined }),
}));

/** RPCs that take no idempotency key (they are naturally repeatable, or allow only their own keys). */
const NO_KEY = new Set(['log_access', 'register_push_token', 'unregister_push_token', 'mark_notifications_read', 'reset_demo']);

/** Unsent writes hold patient data, so they are kept encrypted. */
const STORE_KEY = 'outbox.v1';
type Stored = { owner?: string; queue: Intent[] };
let saving = Promise.resolve();
/** The account whose writes are queued (set by restoreOutbox when an account is signed in). */
let owner: string | undefined;
/** Bumped on every sign-out: a request still in flight from the previous session is ignored when it answers. */
let epoch = 0;
/** Bumped on every enqueue, so a reload that started before a write can tell its snapshot is stale. */
let writes = 0;

/** How many writes this phone has queued so far (a counter, compared before and after a reload). */
export const writeCount = () => writes;

/** Writes made on this phone that the server has not confirmed yet. */
export const pendingWrites = () => useOutbox.getState().queue.length;

function persist() {
  const { queue } = useOutbox.getState();
  const stored: Stored = { owner, queue };
  // Serialised: a later save never lands before an earlier one.
  saving = saving
    .then(() => (queue.length ? secureStorage.setItem(STORE_KEY, JSON.stringify(stored)) : secureStorage.removeItem(STORE_KEY)))
    .catch(() => {
      /* keystore unavailable: the queue still lives in memory for this session */
    });
}

function markPending() {
  const ids = useOutbox.getState().queue.flatMap((i) => (i.entityId ? [i.entityId] : []));
  useNetwork.setState({ pending: ids });
}

/** The payload with its version check frozen in: the known version, or none (an unchecked write). */
function stampVersion(payload: Record<string, unknown>, version: number | undefined): Record<string, unknown> {
  const { version: _old, ...rest } = payload;
  return typeof version === 'number' ? { ...rest, version } : rest;
}

const touches = (i: Intent, id: string) => i.entityId === id || !!i.alsoInvalidate?.includes(id);

/** Queue a write. In mock mode the on-device store is the backend, so nothing is sent. */
export function enqueue(
  rpc: string,
  payload: Record<string, unknown>,
  opts: { entityId?: string; withVersion?: boolean; upload?: Upload; alsoInvalidate?: string[] } = {},
) {
  if (!isRemote) return;
  const id = randomUUID();
  const { queue, versions } = useOutbox.getState();
  let body = NO_KEY.has(rpc) ? payload : { ...payload, idempotency_key: id };
  let stamped = false;
  // The version this edit was made against. A follow-up of this phone's own queued write to the same record is
  // stamped when it is first sent instead, with the version that earlier write comes back with.
  const entity = opts.entityId;
  if (opts.withVersion && entity && !queue.some((i) => touches(i, entity))) {
    body = stampVersion(body, versions[entity]);
    stamped = true;
  }
  const intent: Intent = { id, rpc, payload: body, attempts: 0, ...opts, ...(stamped ? { stamped } : {}) };
  writes++;
  useOutbox.setState((s) => ({ queue: [...s.queue, intent] }));
  persist();
  markPending();
  void drain();
}

/** The running drain loop, tagged with its session: a hung request of a previous session never blocks the next. */
let active: { epoch: number } | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let onDrained: (() => void) | undefined;
let onFailure: (() => void) | undefined;
let onSessionLost: (() => void) | undefined;

/** Wired by the sync layer: reload after the queue empties, after a refusal, or sign out when the session is gone. */
export function setOutboxHooks(h: { drained: () => void; failed: () => void; sessionLost: () => void }) {
  onDrained = h.drained;
  onFailure = h.failed;
  onSessionLost = h.sessionLost;
}

type Outcome = 'ok' | 'retry' | 'auth' | 'refused';

/**
 * The object name inside the bucket, from the RPC response: 'voice-notes/<m>/<id>.m4a' → '<m>/<id>.m4a'.
 * Undefined when the response names no file (e.g. a capture without a photo). Never shown on screen.
 */
export function uploadPath(upload: Pick<Upload, 'bucket' | 'pathFrom'>, response: unknown): string | undefined {
  const v = response && typeof response === 'object' ? (response as Record<string, unknown>)[upload.pathFrom] : undefined;
  if (typeof v !== 'string' || !v) return undefined;
  const prefix = `${upload.bucket}/`;
  return v.startsWith(prefix) ? v.slice(prefix.length) : v;
}

/** Upload the intent's file. 'ok' also when an earlier attempt already stored it (the response was lost). */
export async function sendUpload(u: Upload & { path: string }): Promise<{ status: number; message: string }> {
  try {
    const { File } = await import('expo-file-system');
    const file = new File(u.localUri);
    if (!file.exists) return { status: 422, message: 'The recording or photo is no longer on this phone.' };
    const bytes = await file.arrayBuffer();
    const { error } = await supabase().storage.from(u.bucket).upload(u.path, bytes, { contentType: u.contentType, upsert: false });
    if (!error) return { status: 200, message: '' };
    const e = error as { message: string; statusCode?: string | number; status?: number };
    const status = Number(e.statusCode ?? e.status ?? 0) || 0;
    if (status === 409 || /already exists|duplicate/i.test(e.message)) return { status: 200, message: '' };
    return { status: status || 400, message: e.message };
  } catch (e) {
    return { status: 0, message: String(e) };
  }
}

function classify(status: number, message: string): Exclude<Outcome, 'ok'> {
  if (status === 0 || status === 408 || status === 429 || status >= 500 || /network request failed|fetch failed|timeout/i.test(message)) return 'retry';
  if (status === 401) return 'auth';
  return 'refused';
}

/**
 * True only when the server has definitively ended the session (refresh token revoked, expired or unknown; no
 * session stored). A network failure, a timeout, a server error or a refresh raced by another caller is not: the
 * account and its unsent writes stay, and the refresh is tried again later.
 */
export function isSessionGone(error: unknown): boolean {
  if (!error) return false;
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthApiError(error)) return false;
  const status = error.status;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Remove one intent by id — never "whatever is first now": the queue may have changed while a request was out. */
function remove(id: string, after: (s: OutboxState) => Partial<OutboxState> = () => ({})) {
  useOutbox.setState((s) => ({ queue: s.queue.filter((i) => i.id !== id), ...after(s) }));
  persist();
  markPending();
}

function replace(next: Intent) {
  useOutbox.setState((s) => ({ queue: s.queue.map((i) => (i.id === next.id ? next : i)) }));
  persist();
}

function retryLater(head: Intent) {
  replace({ ...head, attempts: head.attempts + 1 });
  const wait = Math.min(60_000, 1000 * 2 ** Math.min(head.attempts, 6));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void drain(), wait);
}

export async function drain(): Promise<void> {
  if (!isRemote || (active && active.epoch === epoch)) return;
  const me = { epoch };
  active = me;
  clearTimeout(retryTimer);
  let stale = false;
  let refreshedFor: string | undefined;
  try {
    for (;;) {
      let head = useOutbox.getState().queue[0];
      if (!head || !isOnline(useNetwork.getState())) break;
      if (head.withVersion && head.entityId && !head.stamped && !head.rpcDone) {
        // First attempt of a follow-up write: freeze the version it is checked against, for every retry.
        head = { ...head, stamped: true, payload: stampVersion(head.payload, useOutbox.getState().versions[head.entityId]) };
        replace(head);
      }

      let status = 0;
      let message = '';
      let data: unknown;
      if (!head.rpcDone) {
        try {
          const res = await supabase().rpc(head.rpc, { p: head.payload });
          status = res.status;
          data = res.data;
          message = res.error?.message ?? '';
          if (!res.error) status = 200;
        } catch (e) {
          message = String(e);
        }
        if (me.epoch !== epoch) {
          stale = true;
          break;
        }
        // The write is applied; keep the intent (persisted) until its file is uploaded too.
        const path = status === 200 && head.upload ? uploadPath(head.upload, data) : undefined;
        if (path && head.upload) {
          replace({ ...head, rpcDone: true, attempts: 0, upload: { ...head.upload, path } });
          continue;
        }
      } else if (head.upload?.path) {
        ({ status, message } = await sendUpload({ ...head.upload, path: head.upload.path }));
        if (me.epoch !== epoch) {
          stale = true;
          break;
        }
      } else {
        status = 200;
      }

      if (status === 200) {
        const next = (data as { version?: number } | null)?.version;
        const done = head;
        remove(done.id, (s) => {
          if (!done.entityId && !done.alsoInvalidate?.length) return {};
          const v = { ...s.versions };
          // A response that names the new version keeps the check alive; otherwise the next write goes unchecked
          // (it is this phone's own follow-up) until the next reload brings fresh versions.
          if (done.entityId) {
            if (typeof next === 'number') v[done.entityId] = next;
            else delete v[done.entityId];
          }
          for (const other of done.alsoInvalidate ?? []) delete v[other];
          return { versions: v };
        });
        if (done.entityId) {
          const id = done.entityId;
          useNetwork.setState((s) => ({ justSynced: [...s.justSynced, id] }));
          setTimeout(() => useNetwork.setState((s) => ({ justSynced: s.justSynced.filter((x) => x !== id) })), 4000);
        }
        continue;
      }

      const outcome = classify(status, message);
      if (outcome === 'auth') {
        if (refreshedFor !== head.id) {
          refreshedFor = head.id;
          const { error } = await supabase().auth.refreshSession();
          if (me.epoch !== epoch) {
            stale = true;
            break;
          }
          if (!error) continue;
          if (isSessionGone(error)) {
            onSessionLost?.();
            break;
          }
        }
        // Offline, a timeout, or still refused with a fresh token: keep the write and try again later.
        retryLater(head);
        break;
      }
      if (outcome === 'retry') {
        retryLater(head);
        break;
      }
      const refused = head;
      remove(refused.id, () => ({ failure: { rpc: refused.rpc, message } }));
      onFailure?.();
    }
  } finally {
    if (active === me) active = undefined;
  }
  if (stale) {
    // Signed out while a request was out: its answer belongs to nobody. The next account's writes go now.
    if (useOutbox.getState().queue.length) void drain();
    return;
  }
  if (useOutbox.getState().queue.length === 0) onDrained?.();
}

/**
 * Restore the writes saved on this phone for the signed-in account (after a restart, or a sign-in after a lost
 * session). Writes saved by another account are deleted: nothing of one user is ever sent under another login.
 */
export async function restoreOutbox(accountId: string) {
  if (!isRemote) return;
  owner = accountId;
  try {
    const raw = await secureStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
    if (owner !== accountId) return; // signed out meanwhile
    // The first format stored a bare array (always the signed-in account's); now {owner, queue}.
    const stored: Stored | undefined = Array.isArray(parsed) ? { queue: parsed as Intent[] } : (parsed as Stored | undefined);
    if (stored?.owner && stored.owner !== accountId) {
      if (!useOutbox.getState().queue.length) await secureStorage.removeItem(STORE_KEY);
    } else if (Array.isArray(stored?.queue) && stored.queue.length) {
      const have = new Set(useOutbox.getState().queue.map((i) => i.id));
      const saved = stored.queue.filter((i) => !have.has(i.id));
      useOutbox.setState((s) => ({ queue: [...saved, ...s.queue] }));
      persist();
    }
  } catch {
    /* unreadable: start empty */
  }
  markPending();
}

function forget() {
  epoch++;
  owner = undefined;
  active = undefined;
  clearTimeout(retryTimer);
  useOutbox.setState({ queue: [], versions: {}, failure: undefined });
  useNetwork.setState({ pending: [], justSynced: [] });
}

/** Explicit sign-out: the unsent writes are deleted — nothing of this user may be sent later under another login. */
export function clearOutbox() {
  forget();
  persist();
}

/**
 * Lost session (the server ended it): stop sending and forget the writes in memory, but keep them saved on the phone
 * for this account's next sign-in (restoreOutbox). They are never sent without a session of the same account.
 */
export function suspendOutbox() {
  forget();
}

/** Resume sending when the phone is back online. */
useNetwork.subscribe((s, prev) => {
  if (isRemote && isOnline(s) && !isOnline(prev)) void drain();
});
