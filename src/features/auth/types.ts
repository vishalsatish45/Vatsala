export type Face = 'care' | 'family';

export type CareRole = 'obstetrician' | 'paediatrician' | 'specialist';
export type FamilyRole = 'mother' | 'caregiver';

/** The signed-in person. Faces are resolved server-side (Supabase) or by the demo directory. */
export type Account = {
  id: string;
  phone: string;
  name: string;
  faces: Face[];
  care?: { role: CareRole; department: string; hospital: string };
  family?: { role: FamilyRole; motherName: string; hospital: string };
};

export type OtpRequestResult = { ok: true } | { ok: false; reason: 'not_registered' | 'rate_limited' | 'network' };
export type OtpVerifyResult = { ok: true; account: Account } | { ok: false; reason: 'wrong_code' | 'expired' | 'network' };

export interface AuthService {
  requestOtp(phone: string): Promise<OtpRequestResult>;
  verifyOtp(phone: string, code: string): Promise<OtpVerifyResult>;
  signOut(): Promise<void>;
}
