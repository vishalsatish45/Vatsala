/**
 * Thin wrappers over native device modules (camera, files, notifications, biometrics).
 * Modules are imported lazily at call time, so a dev build that predates them keeps
 * running — the call fails with a clear message instead of crashing on startup.
 */
import { Alert } from 'react-native';

export class NativeUnavailable extends Error {}

async function load<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (e) {
    Alert.alert('Needs the new app build', 'This feature uses the camera, files, notifications or fingerprint. Install the latest build of the app to use it.');
    throw new NativeUnavailable(String(e));
  }
}

// ── Camera / photos ─────────────────────────────────────────────────────────────

export async function pickPhoto(source: 'camera' | 'library'): Promise<string | undefined> {
  const ImagePicker = await load(() => import('expo-image-picker'));
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return undefined;
  }
  const opts = { mediaTypes: ['images' as const], quality: 0.7 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  return res.canceled ? undefined : res.assets[0]?.uri;
}

// ── Files ───────────────────────────────────────────────────────────────────────

export async function pickTextFile(): Promise<{ name: string; text: string } | undefined> {
  const DocumentPicker = await load(() => import('expo-document-picker'));
  const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return undefined;
  const { File } = await load(() => import('expo-file-system'));
  const asset = res.assets[0];
  return { name: asset.name, text: await new File(asset.uri).text() };
}

// ── Local notifications ─────────────────────────────────────────────────────────

let notifReady = false;

async function notifications() {
  const N = await load(() => import('expo-notifications'));
  if (!notifReady) {
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
    });
    await N.setNotificationChannelAsync('reminders', { name: 'Reminders', importance: N.AndroidImportance.DEFAULT });
    notifReady = true;
  }
  const perm = await N.requestPermissionsAsync();
  if (!perm.granted) throw new NativeUnavailable('Notification permission denied');
  return N;
}

/** Privacy rule (PRD F-04): notification text never contains clinical details or names. */
export async function scheduleAt(title: string, body: string, date: Date) {
  const N = await notifications();
  return N.scheduleNotificationAsync({ content: { title, body }, trigger: { type: N.SchedulableTriggerInputTypes.DATE, date, channelId: 'reminders' } });
}

export async function scheduleDaily(title: string, body: string, hour: number, minute: number) {
  const N = await notifications();
  return N.scheduleNotificationAsync({ content: { title, body }, trigger: { type: N.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'reminders' } });
}

export async function cancelAllReminders() {
  const N = await load(() => import('expo-notifications'));
  await N.cancelAllScheduledNotificationsAsync();
}

// ── Biometric / device lock ─────────────────────────────────────────────────────

export async function canUseDeviceLock(): Promise<boolean> {
  const LA = await load(() => import('expo-local-authentication'));
  return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync());
}

export async function unlock(prompt: string): Promise<boolean> {
  const LA = await load(() => import('expo-local-authentication'));
  const res = await LA.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false });
  return res.success;
}
