import { AppState } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from './env';
import { secureStorage } from './secureStorage';

/**
 * Supabase client (EXPO_PUBLIC_AUTH_MODE=supabase only). The auth session (access + refresh token) is kept
 * encrypted in the OS keystore (./secureStorage), never in plain app storage.
 */
let client: SupabaseClient | undefined;

export const isRemote = env.authMode === 'supabase';

/** The app's Supabase client. Only valid in Supabase mode — mock mode never touches the network. */
export function supabase(): SupabaseClient {
  if (!isRemote || !env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error('Supabase is not configured (EXPO_PUBLIC_AUTH_MODE is not "supabase")');
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
    // Refresh tokens only while the app is in the foreground (Expo's Supabase guide).
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void client!.auth.startAutoRefresh();
      else void client!.auth.stopAutoRefresh();
    });
  }
  return client;
}
