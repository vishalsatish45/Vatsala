import { z } from 'zod';

import { asTeamId } from '@/data/ids';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

import { DEMO_OTP, findDemoAccount } from './demoAccounts';
import type { Account, AuthService, CareRole } from './types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** On-device demo auth — same contract as the Supabase implementation. */
const mockAuth: AuthService = {
  async requestOtp(phone) {
    await wait(400);
    return findDemoAccount(phone) ? { ok: true } : { ok: false, reason: 'not_registered' };
  },
  async verifyOtp(phone, code) {
    await wait(400);
    const account = findDemoAccount(phone);
    if (!account || code !== DEMO_OTP) return { ok: false, reason: 'wrong_code' };
    return { ok: true, account };
  },
  async signOut() {},
};

// ── Supabase ──────────────────────────────────────────────────────────────────────

const id = z.guid();
const scopes = z.strictObject({ schedule: z.boolean(), baby: z.boolean(), logs: z.boolean(), tests: z.boolean() });
const team = z.strictObject({ id, name: z.string(), kind: z.enum(['department', 'unit']), specialty: z.string() });

/** `public.whoami()` (supabase/migrations/20261005000810_whoami_family.sql), parsed strictly. */
const WhoAmI = z.strictObject({
  user_id: id,
  staff: z
    .strictObject({ id, name: z.string(), role: z.string(), hospital_id: id, hospital: z.string(), teams: z.array(team) })
    .nullable(),
  mother: z
    .strictObject({ mother_id: id, name: z.string(), lang: z.string(), consented: z.boolean(), purposes: z.array(z.string()).nullable() })
    .nullable(),
  caregiving: z.array(
    z.strictObject({
      caregiver_id: id, name: z.string(), mother_id: id, mother_name: z.string(), relation: z.string(), scopes,
      consented: z.boolean(), purposes: z.array(z.string()).nullable(),
    }),
  ),
});

const CARE_ROLES: readonly string[] = ['obstetrician', 'paediatrician', 'specialist'];

/** whoami → the app's Account. Only roles the Care Team face is built for open it. */
export function accountFrom(who: z.infer<typeof WhoAmI>, phone: string): Account | undefined {
  const staff = who.staff && CARE_ROLES.includes(who.staff.role) ? who.staff : null;
  const caring = who.caregiving[0];
  const faces: Account['faces'] = [...(staff ? (['care'] as const) : []), ...(who.mother || caring ? (['family'] as const) : [])];
  if (!faces.length) return undefined;
  const department = staff?.teams.find((t) => t.kind === 'department')?.name ?? staff?.teams[0]?.name ?? '';
  return {
    id: who.user_id,
    phone,
    name: staff?.name ?? who.mother?.name ?? caring?.name ?? '',
    faces,
    care: staff ? { role: staff.role as CareRole, department, hospital: staff.hospital, staffId: staff.id, teams: staff.teams.map((t) => ({ ...t, id: asTeamId(t.id) })) } : undefined,
    family: who.mother
      ? { role: 'mother', motherName: who.mother.name, hospital: '', motherId: who.mother.mother_id, consentPurposes: who.mother.purposes ?? undefined }
      : caring
        ? { role: 'caregiver', motherName: caring.mother_name, hospital: '', motherId: caring.mother_id, consentPurposes: caring.purposes ?? undefined }
        : undefined,
  };
}

const offline = (message: string) => /network|fetch|timeout/i.test(message);

const supabaseAuth: AuthService = {
  async requestOtp(phone) {
    try {
      const { error } = await supabase().auth.signInWithOtp({ phone: `+91${phone}` });
      if (!error) return { ok: true };
      if (error.status === 429) return { ok: false, reason: 'rate_limited' };
      if (offline(error.message) || !error.status) return { ok: false, reason: 'network' };
      // The before-user-created hook refuses numbers the hospital has not provisioned.
      return { ok: false, reason: 'not_registered' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  },
  async verifyOtp(phone, code) {
    try {
      const { error } = await supabase().auth.verifyOtp({ phone: `+91${phone}`, token: code, type: 'sms' });
      if (error) {
        if (offline(error.message) || !error.status) return { ok: false, reason: 'network' };
        return { ok: false, reason: /expired/i.test(error.message) ? 'expired' : 'wrong_code' };
      }
      const { data, error: whoError } = await supabase().rpc('whoami');
      if (whoError) return { ok: false, reason: 'network' };
      const parsed = WhoAmI.safeParse(data);
      const account = parsed.success ? accountFrom(parsed.data, phone) : undefined;
      if (!account) {
        await supabase().auth.signOut();
        return { ok: false, reason: 'no_access' };
      }
      return { ok: true, account };
    } catch {
      return { ok: false, reason: 'network' };
    }
  },
  async signOut() {
    try {
      await supabase().auth.signOut();
    } catch {
      /* offline: the local session is cleared by the client regardless */
    }
  },
};

export const authService: AuthService = env.authMode === 'mock' ? mockAuth : supabaseAuth;
export const isMockAuth = env.authMode === 'mock';
