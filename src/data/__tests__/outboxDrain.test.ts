/* The outbox in Supabase mode: what it sends, what it keeps, and what it never loses. Server and keystore are fakes. */
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';

import { clearOutbox, drain, enqueue, isSessionGone, restoreOutbox, setOutboxHooks, suspendOutbox, useOutbox } from '../outbox';
import { useNetwork } from '@/lib/network';

type Res = { status: number; data?: unknown; error?: { message: string } | null };

// Hoisted above the imports by babel-jest; names starting with `mock` may be used inside the factories.
const mockRpc = jest.fn<Promise<Res>, [string, { p: Record<string, unknown> }]>();
const mockRefresh = jest.fn<Promise<{ error: unknown }>, []>();
const mockStore = new Map<string, string>();

jest.mock('@/lib/supabase', () => ({
  isRemote: true,
  supabase: () => ({ rpc: (name: string, args: { p: Record<string, unknown> }) => mockRpc(name, args), auth: { refreshSession: () => mockRefresh() } }),
}));
jest.mock('@/lib/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID() }));

const X = '00000000-0000-4000-8070-0000000000c1';
const T = '00000000-0000-4000-8030-0000000000a1';
const R = '00000000-0000-4000-8031-0000000000b1';
const ok = (data: unknown = {}): Res => ({ status: 200, data, error: null });
const sent = () => mockRpc.mock.calls.map(([rpc, { p }]) => ({ rpc, p }));
const offline = () => useNetwork.setState({ online: false });
const online = () => useNetwork.setState({ online: true });
/** Let queued promise callbacks (persist, the drain loop) run. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const saved = () => JSON.parse(mockStore.get('outbox.v1') ?? 'null') as { owner?: string; queue: { rpc: string }[] } | null;

const hooks = { drained: jest.fn(), failed: jest.fn(), sessionLost: jest.fn() };

beforeEach(async () => {
  jest.useFakeTimers();
  clearOutbox();
  await settle();
  mockStore.clear();
  mockRpc.mockReset();
  mockRefresh.mockReset();
  Object.values(hooks).forEach((h) => h.mockReset());
  setOutboxHooks(hooks);
  online();
  await restoreOutbox('user-1');
});

afterEach(() => {
  clearOutbox();
  jest.useRealTimers();
});

describe('payloads', () => {
  it('sends reset_demo without an idempotency key (its RPC allows only "confirm")', async () => {
    mockRpc.mockResolvedValue(ok());
    enqueue('reset_demo', { confirm: 'RESET DEMO DATA' });
    await settle();
    expect(sent()).toEqual([{ rpc: 'reset_demo', p: { confirm: 'RESET DEMO DATA' } }]);
  });

  it('freezes the version an offline edit was based on: a reload before sending does not re-base it', async () => {
    useOutbox.setState({ versions: { [T]: 3 } });
    offline();
    enqueue('override_task', { id: T, action: 'cancel', reason: 'Moved' }, { entityId: T, withVersion: true });
    expect(useOutbox.getState().queue[0]).toMatchObject({ stamped: true, payload: { version: 3 } });
    useOutbox.setState({ versions: { [T]: 7 } }); // someone else's change, loaded meanwhile
    mockRpc.mockResolvedValue(ok({ version: 4 }));
    online();
    await settle();
    expect(sent()[0]!.p).toMatchObject({ id: T, version: 3 });
  });

  it('resends exactly the same payload on a retry, whatever was reloaded in between', async () => {
    useOutbox.setState({ versions: { [T]: 3 } });
    mockRpc.mockResolvedValueOnce({ status: 0, error: { message: 'Network request failed' } });
    enqueue('override_task', { id: T, action: 'cancel', reason: 'Moved' }, { entityId: T, withVersion: true });
    await settle();
    expect(useOutbox.getState().queue[0]!.attempts).toBe(1);
    useOutbox.setState({ versions: { [T]: 9 } });
    mockRpc.mockResolvedValueOnce(ok({ version: 4 }));
    await drain();
    await settle();
    const [first, second] = sent();
    expect(second!.p).toEqual(first!.p);
    expect(useOutbox.getState().queue).toHaveLength(0);
  });

  it("checks a follow-up of the phone's own queued write against the version that write came back with", async () => {
    useOutbox.setState({ versions: { [T]: 3 } });
    offline();
    enqueue('override_task', { id: T, action: 'reschedule', due_by: '2026-10-09' }, { entityId: T, withVersion: true });
    enqueue('override_task', { id: T, action: 'cancel', reason: 'Moved' }, { entityId: T, withVersion: true });
    expect(useOutbox.getState().queue[1]!.stamped).toBeUndefined();
    mockRpc.mockResolvedValueOnce(ok({ version: 4 })).mockResolvedValueOnce(ok({ version: 5 }));
    online();
    await settle();
    expect(sent().map((c) => c.p.version)).toEqual([3, 4]);
    expect(useOutbox.getState().versions[T]).toBe(5);
  });

  it('forgets the version of a row a correction also changed (the test of a withdrawn result)', async () => {
    useOutbox.setState({ versions: { [X]: 2, [R]: 1 } });
    mockRpc.mockResolvedValue(ok());
    enqueue('mark_entered_in_error', { kind: 'investigation_result', id: R, reason: 'Wrong patient' }, { entityId: R, alsoInvalidate: [X] });
    await settle();
    expect(useOutbox.getState().versions).toEqual({});
  });
});

describe('sign-out while a request is out', () => {
  it("removes the answered intent by id and never drops the next account's first write", async () => {
    let answerA!: (r: Res) => void;
    let answerB!: (r: Res) => void;
    mockRpc.mockImplementationOnce(() => new Promise((r) => (answerA = r))).mockImplementationOnce(() => new Promise((r) => (answerB = r)));
    enqueue('add_note', { id: X, body: 'first user' }, { entityId: X });
    await settle();
    clearOutbox(); // user 1 signs out; the request hangs
    await restoreOutbox('user-2');
    enqueue('add_note', { id: T, body: 'second user' }, { entityId: T });
    await settle();
    expect(sent().map((c) => c.p.body)).toEqual(['first user', 'second user']); // not blocked by the hung request
    answerA(ok());
    await settle();
    expect(useOutbox.getState().queue.map((i) => i.entityId)).toEqual([T]);
    answerB(ok());
    await settle();
    expect(useOutbox.getState().queue).toHaveLength(0);
  });
});

describe('lost or unreachable session', () => {
  it('tells a definitive end of session from a network failure', () => {
    expect(isSessionGone(new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'))).toBe(true);
    expect(isSessionGone(new AuthSessionMissingError())).toBe(true);
    expect(isSessionGone(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(false);
    expect(isSessionGone(new AuthRetryableFetchError('Service unavailable', 503))).toBe(false);
    expect(isSessionGone(new AuthApiError('Too many requests', 429, 'over_request_rate_limit'))).toBe(false);
    expect(isSessionGone(new Error('Network request failed'))).toBe(false);
    expect(isSessionGone(null)).toBe(false);
  });

  it('keeps the account and the write when the token cannot be refreshed for lack of network', async () => {
    mockRpc.mockResolvedValue({ status: 401, error: { message: 'JWT expired' } });
    mockRefresh.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });
    enqueue('add_note', { id: X, body: 'offline note' }, { entityId: X });
    await settle();
    expect(hooks.sessionLost).not.toHaveBeenCalled();
    expect(useOutbox.getState().queue).toHaveLength(1);
    expect(useOutbox.getState().queue[0]!.attempts).toBe(1);
    expect(saved()?.queue).toHaveLength(1);
  });

  it('reports a session the server ended', async () => {
    mockRpc.mockResolvedValue({ status: 401, error: { message: 'JWT expired' } });
    mockRefresh.mockResolvedValue({ error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') });
    enqueue('add_note', { id: X, body: 'note' }, { entityId: X });
    await settle();
    expect(hooks.sessionLost).toHaveBeenCalledTimes(1);
  });

  it("keeps a lost session's writes saved for the same account, and deletes them for another", async () => {
    offline();
    enqueue('add_note', { id: X, body: 'unsent' }, { entityId: X });
    await settle();
    suspendOutbox(); // the server ended the session
    await settle();
    expect(useOutbox.getState().queue).toHaveLength(0);
    expect(saved()).toMatchObject({ owner: 'user-1', queue: [{ rpc: 'add_note' }] });

    await restoreOutbox('user-1');
    expect(useOutbox.getState().queue.map((i) => i.payload.body)).toEqual(['unsent']);

    suspendOutbox();
    await restoreOutbox('user-2');
    expect(useOutbox.getState().queue).toHaveLength(0);
    expect(saved()).toBeNull();
  });

  it('an explicit sign-out deletes unsent writes from the phone', async () => {
    offline();
    enqueue('add_note', { id: X, body: 'unsent' }, { entityId: X });
    await settle();
    clearOutbox();
    await settle();
    expect(saved()).toBeNull();
  });
});
