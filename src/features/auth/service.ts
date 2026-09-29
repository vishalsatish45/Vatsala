import { env } from '@/lib/env';

import { DEMO_OTP, findDemoAccount } from './demoAccounts';
import type { AuthService } from './types';

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

function supabaseNotReady(): never {
  throw new Error('Supabase auth is not wired yet — set EXPO_PUBLIC_AUTH_MODE=mock (Phase 0 backend step pending).');
}

const supabaseAuth: AuthService = {
  requestOtp: async () => supabaseNotReady(),
  verifyOtp: async () => supabaseNotReady(),
  signOut: async () => supabaseNotReady(),
};

export const authService: AuthService = env.authMode === 'mock' ? mockAuth : supabaseAuth;
export const isMockAuth = env.authMode === 'mock';
