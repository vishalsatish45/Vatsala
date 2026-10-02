import type { TeamRef } from '@/data/types';

export type Face = 'care' | 'family';

export type CareRole = 'obstetrician' | 'paediatrician' | 'specialist';
export type FamilyRole = 'mother' | 'caregiver';

/** The signed-in person. Faces are resolved server-side (Supabase `whoami`) or by the demo directory. */
export type Account = {
  /** Auth user id (Supabase) or demo directory id. */
  id: string;
  phone: string;
  name: string;
  faces: Face[];
  care?: { role: CareRole; department: string; hospital: string; staffId?: string; teams?: TeamRef[] };
  family?: {
    role: FamilyRole;
    motherName: string;
    hospital: string;
    /** The mother this account acts for (Supabase mode). */
    motherId?: string;
    /** Purposes of this person's active consent, when the server already has one (skips onboarding). */
    consentPurposes?: string[];
  };
};

export type OtpRequestResult = { ok: true } | { ok: false; reason: 'not_registered' | 'rate_limited' | 'network' };
export type OtpVerifyResult = { ok: true; account: Account } | { ok: false; reason: 'wrong_code' | 'expired' | 'network' | 'no_access' };

export interface AuthService {
  requestOtp(phone: string): Promise<OtpRequestResult>;
  verifyOtp(phone: string, code: string): Promise<OtpVerifyResult>;
  signOut(): Promise<void>;
}
