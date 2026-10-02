/**
 * Remote push. After sign-in in Supabase mode the phone asks for notification permission and
 * registers its Expo push token with the server (`register_push_token`); the `push` Edge Function then delivers
 * privacy-safe text for new notifications (PRD F-04). On sign-out the token is removed again, so a shared phone
 * never receives the previous person's pushes.
 *
 * An Expo push token needs the EAS project id (app.json → expo.extra.eas.projectId, written by `eas init`).
 * Without one — or in mock mode, in a simulator, or without permission — registration is a silent no-op.
 * Nothing is logged.
 */
import { Platform } from 'react-native';

import { isRemote, supabase } from '@/lib/supabase';

let registered: string | undefined;

function projectId(constants: typeof import('expo-constants').default): string | undefined {
  const extra = constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? constants.easConfig?.projectId;
  return typeof id === 'string' && id ? id : undefined;
}

/** Ask for permission and register this phone for the signed-in user's pushes. Never throws. */
export async function registerPush(): Promise<void> {
  if (!isRemote || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return;
  try {
    const Constants = (await import('expo-constants')).default;
    const id = projectId(Constants);
    if (!id) return; // no EAS project yet: `eas init` is needed before remote push works
    const N = await import('expo-notifications');
    if (Platform.OS === 'android') {
      // Android needs a channel before the token is requested (and before 13+ shows the permission prompt).
      await N.setNotificationChannelAsync('default', { name: 'Updates', importance: N.AndroidImportance.DEFAULT });
    }
    let perm = await N.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await N.requestPermissionsAsync();
    if (!perm.granted) return;
    const token = (await N.getExpoPushTokenAsync({ projectId: id })).data;
    const { error } = await supabase().rpc('register_push_token', { p: { token, platform: Platform.OS } });
    if (!error) registered = token;
  } catch {
    /* no native module in this build, no network, or no Google services: pushes stay off; the app works without */
  }
}

/** Sign-out: stop this phone receiving the signed-out person's pushes. Best effort; never throws. */
export async function unregisterPush(): Promise<void> {
  const token = registered;
  registered = undefined;
  if (!isRemote || !token) return;
  try {
    await supabase().rpc('unregister_push_token', { p: { token } });
  } catch {
    /* offline: the server replaces the token's owner at the next sign-in on this phone */
  }
}
