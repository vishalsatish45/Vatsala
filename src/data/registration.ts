/**
 * Registration calls that need the server's answer before the screen moves on (like src/data/emergency.ts), so they
 * are sent at once instead of through the outbox:
 *
 *  - findMother(phone): a returning mother of this hospital, to prefill the form (find_mother). The clinician then
 *    confirms it is the same woman; register_pregnancy reuses her record only then (or when the name matches).
 *  - importRows(rows): a register import (confirm_import). The server answers row by row — created with its MCH id,
 *    or rejected with its reason — and the screen shows both. Nothing is added on the phone first, so a refused row
 *    can never appear and then vanish.
 *
 * In demo mode (no server) both run against the on-device store with the same rules.
 */
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';

import { asMotherId } from './ids';
import { day, e164 } from './remote';
import { planRegistration, useDb, type RegisterInput } from './store';
import type { MaritalStatus, Mother, MotherId } from './types';
import { isRemote, supabase } from '@/lib/supabase';

export type MotherMatch = {
  motherId: MotherId;
  name: string;
  age?: number;
  dob?: Date;
  dobEstimated?: boolean;
  lang: Mother['lang'];
  maritalStatus?: MaritalStatus;
  addressLine?: string;
  village?: string;
  district?: string;
  state?: string;
  pincode?: string;
  husbandName?: string;
  /** She already has an ongoing pregnancy (a second one cannot be registered). */
  activePregnancy: boolean;
  /** Pregnancies on record here. */
  pregnancies: number;
};

const nstr = z.string().nullable();
/** `find_mother` response, strictly. */
const Found = z
  .strictObject({
    mother_id: z.guid(),
    version: z.number(),
    name: z.string(),
    age: z.number().nullable(),
    dob: nstr,
    dob_estimated: z.boolean(),
    lang: z.enum(['en', 'kn', 'hi']),
    marital_status: z.enum(['married', 'unmarried', 'widowed', 'separated_divorced']).nullable(),
    address_line: nstr,
    village: nstr,
    district: nstr,
    state: nstr,
    pincode: nstr,
    husband_name: nstr,
    active_pregnancy: z.boolean(),
    pregnancies: z.number(),
  })
  .nullable();

/** An RPC call; a thrown network error comes back as a message instead. */
async function call(fn: string, p: Record<string, unknown>) {
  try {
    return await supabase().rpc(fn, { p });
  } catch (e) {
    return { message: String(e) };
  }
}

export type LookupResult ={ ok: true; match?: MotherMatch } | { ok: false; message: string };

/** Looks a 10-digit mobile number up among this hospital's mothers. */
export async function findMother(phone: string): Promise<LookupResult> {
  if (!isRemote) {
    const s = useDb.getState();
    const m = s.mothers.find((x) => x.phone === phone);
    if (!m) return { ok: true };
    const pregs = s.pregnancies.filter((g) => g.motherId === m.id);
    return {
      ok: true,
      match: {
        motherId: m.id, name: m.name, age: m.age, dob: m.dob, dobEstimated: m.dobEstimated, lang: m.lang, maritalStatus: m.maritalStatus, addressLine: m.addressLine, village: m.village || undefined,
        district: m.district, state: m.state, pincode: m.pincode, husbandName: m.husbandName,
        activePregnancy: pregs.some((g) => g.status === 'active' || g.status === 'admitted'), pregnancies: pregs.length,
      },
    };
  }
  const res = await call('find_mother', { phone: e164(phone) });
  if ('message' in res) return { ok: false, message: res.message };
  const { data, error } = res;
  if (error) return { ok: false, message: error.message };
  const r = Found.safeParse(data);
  if (!r.success) return { ok: false, message: 'The lookup reply was not understood.' };
  const f = r.data;
  if (!f) return { ok: true };
  const opt = (v: string | null) => v ?? undefined;
  return {
    ok: true,
    match: {
      motherId: asMotherId(f.mother_id), name: f.name, age: f.age ?? undefined, dob: f.dob ? day(f.dob) : undefined, dobEstimated: f.dob_estimated,
      lang: f.lang, maritalStatus: f.marital_status ?? undefined, addressLine: opt(f.address_line), village: opt(f.village), district: opt(f.district), state: opt(f.state), pincode: opt(f.pincode), husbandName: opt(f.husband_name),
      activePregnancy: f.active_pregnancy, pregnancies: f.pregnancies,
    },
  };
}

/** `confirm_import` response, strictly. Rows are numbered from 1 in the order sent. */
const Imported = z.strictObject({
  created: z.array(z.strictObject({ row: z.number(), pregnancy_id: z.guid(), mch_id: z.string() })),
  rejected: z.array(z.strictObject({ row: z.number(), reason: z.string() })),
});

export type ImportOutcome =
  | { ok: true; created: { index: number; mchId?: string }[]; rejected: { index: number; reason: string }[] }
  | { ok: false; message: string };

/** Sends the checked rows; `index` in the outcome is the position in `rows` (0-based). */
export async function importRows(rows: RegisterInput[], fileName: string, by: string, now: Date): Promise<ImportOutcome> {
  if (!rows.length) return { ok: false, message: 'Nothing to import.' };
  if (!isRemote) {
    const ids = useDb.getState().importRegister(rows, by, now);
    const mch = new Map(useDb.getState().pregnancies.map((p) => [p.id, p.mchId]));
    return { ok: true, created: ids.map((id, index) => ({ index, mchId: mch.get(id) })), rejected: [] };
  }
  const payload = { idempotency_key: randomUUID(), file_name: fileName, rows: rows.map((r) => planRegistration(r, now).payload) };
  const res = await call('confirm_import', payload);
  if ('message' in res) return { ok: false, message: 'You need to be online to import a register.' };
  const { data, error } = res;
  if (error) {
    if (/network request failed|fetch failed|timeout/i.test(error.message)) return { ok: false, message: 'You need to be online to import a register.' };
    return { ok: false, message: error.message };
  }
  const r = Imported.safeParse(data);
  if (!r.success) return { ok: false, message: 'The import was sent, but the reply was not understood. Pull to refresh to see what was created.' };
  return {
    ok: true,
    created: r.data.created.map((c) => ({ index: c.row - 1, mchId: c.mch_id })),
    rejected: r.data.rejected.map((x) => ({ index: x.row - 1, reason: x.reason })),
  };
}
