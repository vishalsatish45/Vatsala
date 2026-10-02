/**
 * Outbox. Every write the app makes in Supabase mode is an intent:
 * {rpc, payload}, carrying one idempotency key for its whole life. Intents are kept on the phone, sent in
 * order, and retried with backoff while offline or when the server is unreachable — a retry can never apply
 * twice, because the server replays the stored response for a key it has seen.
 *
 * A refused intent (role, not visible, stale version, invalid input) is dropped and reported; the store is
 * then reloaded from the server, which undoes the optimistic change on screen.
 *
 * An intent may carry a follow-up upload (a voice note, a paper-record photo): once the RPC has answered with the
 * server-chosen storage path, the local file is uploaded there (private bucket, never overwriting). The intent
 * stays at the head of the queue — persisted, encrypted — until the upload is done, and is retried like an RPC.
 */
import { randomUUID } from 'expo-crypto';
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

/** RPCs that take no idempotency key (they are naturally repeatable). */
const NO_KEY = new Set(['log_access', 'register_push_token', 'unregister_push_token', 'mark_notifications_read']);

/** Unsent writes hold patient data, so they are kept encrypted. */
const STORE_KEY = 'outbox.v1';
let saving = Promise.resolve();

function persist() {
  const queue = useOutbox.getState().queue;
  // Serialised: a later save never lands before an earlier one.
  saving = saving
    .then(() => (queue.length ? secureStorage.setItem(STORE_KEY, JSON.stringify(queue)) : secureStorage.removeItem(STORE_KEY)))
    .catch(() => {
      /* keystore unavailable: the queue still lives in memory for this session */
    });
}

function markPending() {
  const ids = useOutbox.getState().queue.flatMap((i) => (i.entityId ? [i.entityId] : []));
  useNetwork.setState({ pending: ids });
}

/** Queue a write. In mock mode the on-device store is the backend, so nothing is sent. */
export function enqueue(rpc: string, payload: Record<string, unknown>, opts: { entityId?: string; withVersion?: boolean; upload?: Upload } = {}) {
  if (!isRemote) return;
  const id = randomUUID();
  const intent: Intent = { id, rpc, payload: NO_KEY.has(rpc) ? payload : { ...payload, idempotency_key: id }, attempts: 0, ...opts };
  useOutbox.setState((s) => ({ queue: [...s.queue, intent] }));
  persist();
  markPending();
  void drain();
}

let draining = false;
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

function shift(after: (s: OutboxState) => Partial<OutboxState> = () => ({})) {
  useOutbox.setState((s) => ({ queue: s.queue.slice(1), ...after(s) }));
  persist();
  markPending();
}

export async function drain(): Promise<void> {
  if (!isRemote || draining) return;
  draining = true;
  clearTimeout(retryTimer);
  try {
    for (;;) {
      const head = useOutbox.getState().queue[0];
      if (!head || !isOnline(useNetwork.getState())) break;
      const { versions } = useOutbox.getState();
      const payload = head.withVersion && head.entityId && versions[head.entityId] != null ? { ...head.payload, version: versions[head.entityId] } : head.payload;

      let status = 0;
      let message = '';
      let data: unknown;
      if (!head.rpcDone) {
        try {
          const res = await supabase().rpc(head.rpc, { p: payload });
          status = res.status;
          data = res.data;
          message = res.error?.message ?? '';
          if (!res.error) status = 200;
        } catch (e) {
          message = String(e);
        }
        // The write is applied; keep the intent (persisted) until its file is uploaded too.
        const path = status === 200 && head.upload ? uploadPath(head.upload, data) : undefined;
        if (path && head.upload) {
          const next: Intent = { ...head, rpcDone: true, attempts: 0, upload: { ...head.upload, path } };
          useOutbox.setState((s) => ({ queue: [next, ...s.queue.slice(1)] }));
          persist();
          continue;
        }
      } else if (head.upload?.path) {
        ({ status, message } = await sendUpload({ ...head.upload, path: head.upload.path }));
      } else {
        status = 200;
      }

      if (status === 200) {
        const next = (data as { version?: number } | null)?.version;
        shift((s) => {
          if (!head.entityId) return {};
          const v = { ...s.versions };
          // A response that names the new version keeps the check alive; otherwise the next write goes unchecked
          // (it is this phone's own follow-up) until the next reload brings fresh versions.
          if (typeof next === 'number') v[head.entityId] = next;
          else delete v[head.entityId];
          return { versions: v };
        });
        if (head.entityId) {
          const id = head.entityId;
          useNetwork.setState((s) => ({ justSynced: [...s.justSynced, id] }));
          setTimeout(() => useNetwork.setState((s) => ({ justSynced: s.justSynced.filter((x) => x !== id) })), 4000);
        }
        continue;
      }

      const outcome = classify(status, message);
      if (outcome === 'auth') {
        const { error } = await supabase().auth.refreshSession();
        if (!error) continue;
        onSessionLost?.();
        break;
      }
      if (outcome === 'retry') {
        useOutbox.setState((s) => ({ queue: [{ ...head, attempts: head.attempts + 1 }, ...s.queue.slice(1)] }));
        const wait = Math.min(60_000, 1000 * 2 ** Math.min(head.attempts, 6));
        retryTimer = setTimeout(() => void drain(), wait);
        break;
      }
      shift(() => ({ failure: { rpc: head.rpc, message } }));
      onFailure?.();
    }
  } finally {
    draining = false;
  }
  if (useOutbox.getState().queue.length === 0) onDrained?.();
}

/** Restore intents saved before the app was closed. */
export async function restoreOutbox() {
  if (!isRemote) return;
  try {
    const raw = await secureStorage.getItem(STORE_KEY);
    const queue = raw ? (JSON.parse(raw) as Intent[]) : [];
    if (Array.isArray(queue) && queue.length) useOutbox.setState((s) => ({ queue: [...queue, ...s.queue] }));
  } catch {
    /* unreadable: start empty */
  }
  markPending();
}

/** Sign-out: nothing of the previous user may be sent later under another login. */
export function clearOutbox() {
  clearTimeout(retryTimer);
  useOutbox.setState({ queue: [], versions: {}, failure: undefined });
  persist();
  useNetwork.setState({ pending: [], justSynced: [] });
}

/** Resume sending when the phone is back online. */
useNetwork.subscribe((s, prev) => {
  if (isRemote && isOnline(s) && !isOnline(prev)) void drain();
});
