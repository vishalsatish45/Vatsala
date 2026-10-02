// Edge Function `push`: delivers new notifications to phones through the Expo Push API.
//
// Triggered by a Database Webhook on INSERT into public.notifications (set up in the dashboard),
// which POSTs {type, table, schema, record, old_record} with the shared secret header `x-webhook-secret`.
// A POST with body {"sweep": true} (same header) instead delivers any notifications of the last day still unpushed
// (e.g. from a pg_cron + pg_net call, or by hand after an outage).
//
// Privacy (PRD F-04): the push text is generic and never carries names, clinical detail or ids
// beyond the notification's own id; the app opens and shows details only after sign-in. The webhook payload is not
// trusted: the notification is re-read from the database by id. Logs carry counts and ids only.
//
// Secrets (supabase secrets set …): PUSH_WEBHOOK_SECRET (required), EXPO_ACCESS_TOKEN (optional, if push security
// is enabled for the Expo project). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
// Deploy with JWT verification off (supabase/config.toml [functions.push]); the shared secret is the check.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_SWEEP = 200;

function env(name: string, required = true): string | undefined {
  const v = Deno.env.get(name);
  if (required && !v) throw new Error(`Missing secret ${name}`);
  return v || undefined;
}

const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Only the notification id is taken from the webhook; everything else is re-read.
const Webhook = z.looseObject({
  type: z.literal('INSERT'),
  table: z.literal('notifications'),
  schema: z.literal('public'),
  record: z.looseObject({ id: z.guid() }),
});
const Sweep = z.strictObject({ sweep: z.literal(true) });

const Row = z.object({ id: z.guid(), user_id: z.guid(), kind: z.string(), pushed_at: z.string().nullable() });
type Row = z.infer<typeof Row>;

/** Generic, name-free text per kind group. Never derived from params or targets. */
function text(kind: string): { title: string; body: string } {
  const title = 'Vatsala';
  if (kind.endsWith('_reminder')) return { title, body: 'You have a reminder in Vatsala.' };
  if (kind.startsWith('callback_')) return { title, body: 'A call-back request is waiting in Vatsala.' };
  if (kind === 'daily_digest') return { title, body: 'Your day in Vatsala is ready.' };
  return { title, body: 'You have a new update in Vatsala.' };
}

/** Constant-time comparison of the shared secret. */
async function sameSecret(given: string | null, expected: string): Promise<boolean> {
  if (!given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

type Ticket = { status: 'ok' | 'error'; details?: { error?: string } };

async function deliver(rows: Row[]): Promise<{ sent: number; pushed: number }> {
  const pending = rows.filter((r) => r.pushed_at === null);
  if (!pending.length) return { sent: 0, pushed: 0 };

  const users = [...new Set(pending.map((r) => r.user_id))];
  const { data: tokens, error } = await db.from('push_tokens').select('token,user_id').in('user_id', users);
  if (error) throw new Error(`push_tokens: ${error.code}`);
  const byUser = new Map<string, string[]>();
  for (const t of tokens ?? []) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

  const messages = pending.flatMap((r) =>
    (byUser.get(r.user_id) ?? []).map((to) => ({
      to,
      ...text(r.kind),
      sound: 'default',
      channelId: 'default',
      data: { notification_id: r.id },
    })),
  );

  const dead: string[] = [];
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = env('EXPO_ACCESS_TOKEN', false);
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(batch) });
    if (!res.ok) throw new Error(`Expo push ${res.status}`); // the webhook / next sweep retries; nothing marked
    const out = (await res.json()) as { data?: Ticket[] };
    (out.data ?? []).forEach((t, j) => {
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(batch[j].to);
    });
  }
  if (dead.length) await db.from('push_tokens').delete().in('token', dead);

  // Marked pushed even when the person has no phone registered: the in-app list still shows it.
  const ids = pending.map((r) => r.id);
  const { error: markError } = await db.from('notifications').update({ pushed_at: new Date().toISOString() }).in('id', ids).is('pushed_at', null);
  if (markError) throw new Error(`notifications: ${markError.code}`);
  return { sent: messages.length, pushed: ids.length };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!(await sameSecret(req.headers.get('x-webhook-secret'), env('PUSH_WEBHOOK_SECRET')!))) {
    return new Response('Unauthorized', { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  try {
    let rows: Row[];
    const hook = Webhook.safeParse(body);
    if (hook.success) {
      const { data, error } = await db.from('notifications').select('id,user_id,kind,pushed_at').eq('id', hook.data.record.id).limit(1);
      if (error) throw new Error(`notifications: ${error.code}`);
      rows = z.array(Row).parse(data ?? []);
    } else if (Sweep.safeParse(body).success) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await db
        .from('notifications')
        .select('id,user_id,kind,pushed_at')
        .is('pushed_at', null)
        .gte('at', since)
        .order('at')
        .limit(MAX_SWEEP);
      if (error) throw new Error(`notifications: ${error.code}`);
      rows = z.array(Row).parse(data ?? []);
    } else {
      return new Response('Bad request', { status: 400 });
    }
    const result = await deliver(rows);
    console.log(JSON.stringify({ fn: 'push', notifications: rows.map((r) => r.id), ...result }));
    return Response.json(result);
  } catch (e) {
    console.error(JSON.stringify({ fn: 'push', error: e instanceof Error ? e.message : 'unknown' }));
    return new Response('Push failed', { status: 500 });
  }
});
