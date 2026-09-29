import { z } from 'zod';

// Expo inlines EXPO_PUBLIC_* at build time only when accessed as literal
// `process.env.EXPO_PUBLIC_X` expressions, so each key is read explicitly.
const raw = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_AUTH_MODE: process.env.EXPO_PUBLIC_AUTH_MODE,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

const schema = z
  .object({
    EXPO_PUBLIC_APP_ENV: z.enum(['development', 'preview', 'production']).default('development'),
    EXPO_PUBLIC_AUTH_MODE: z.enum(['mock', 'supabase']).default('mock'),
    EXPO_PUBLIC_SUPABASE_URL: z.url().optional().or(z.literal('')),
    EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.EXPO_PUBLIC_AUTH_MODE === 'supabase') {
      if (!v.EXPO_PUBLIC_SUPABASE_URL) {
        ctx.addIssue({ code: 'custom', path: ['EXPO_PUBLIC_SUPABASE_URL'], message: 'required when AUTH_MODE=supabase' });
      }
      if (!v.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
        ctx.addIssue({ code: 'custom', path: ['EXPO_PUBLIC_SUPABASE_ANON_KEY'], message: 'required when AUTH_MODE=supabase' });
      }
    }
    if (v.EXPO_PUBLIC_APP_ENV === 'production' && v.EXPO_PUBLIC_AUTH_MODE === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['EXPO_PUBLIC_AUTH_MODE'], message: 'mock auth is not allowed in production' });
    }
  });

const parsed = schema.safeParse(raw);

if (!parsed.success) {
  // Fail fast and loudly — no silent fallbacks (lesson from fix-my-day).
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = {
  appEnv: parsed.data.EXPO_PUBLIC_APP_ENV,
  authMode: parsed.data.EXPO_PUBLIC_AUTH_MODE,
  supabaseUrl: parsed.data.EXPO_PUBLIC_SUPABASE_URL || undefined,
  supabaseAnonKey: parsed.data.EXPO_PUBLIC_SUPABASE_ANON_KEY || undefined,
  isDev: parsed.data.EXPO_PUBLIC_APP_ENV === 'development',
} as const;
