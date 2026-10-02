/**
 * Emergency access ("break the glass"): a clinician opens a record outside her assignments for
 * 24 hours, with a reason, and it is audited. Sent at once, not queued — the record can only open after the
 * server has granted access. The caller reloads (src/data/sync.ts `refresh`) and then opens the record.
 */
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';

import { reasonOk } from './payloads';
import { useDb } from './store';
import { isRemote, supabase } from '@/lib/supabase';

export type EmergencyResult = { ok: true; motherId: string; pregnancyId?: string; expiresAt: Date } | { ok: false; message: string };

/** `grant_override` response, strictly. */
const Granted = z.strictObject({
  override_id: z.guid(),
  expires_at: z.string(),
  mother_id: z.guid(),
  pregnancy_id: z.guid().nullable().optional(),
});

export async function requestEmergencyAccess(mchId: string, reason: string, now = new Date()): Promise<EmergencyResult> {
  if (!reasonOk(reason)) return { ok: false, message: 'A reason is required (at least 3 characters).' };
  if (!isRemote) {
    const r = useDb.getState().grantOverrideLocal(mchId, reason, now);
    return r ? { ok: true, ...r, expiresAt: new Date(now.getTime() + 24 * 3_600_000) } : { ok: false, message: 'No patient with this MCH ID.' };
  }
  const { data, error } = await supabase().rpc('grant_override', { p: { idempotency_key: randomUUID(), mch_id: mchId, reason: reason.trim() } });
  if (error) {
    if (error.code === 'PT404') return { ok: false, message: 'No patient with this MCH ID at your hospital.' };
    if (error.code === 'PT403') return { ok: false, message: 'Your role cannot use emergency access.' };
    return { ok: false, message: error.message };
  }
  const r = Granted.safeParse(data);
  if (!r.success) return { ok: false, message: 'Access was granted, but the reply was not understood. Pull to refresh and search again.' };
  return { ok: true, motherId: r.data.mother_id, pregnancyId: r.data.pregnancy_id ?? undefined, expiresAt: new Date(r.data.expires_at) };
}
