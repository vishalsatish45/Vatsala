/**
 * Local reminders on this phone (PRD F-04): medicine times and visit days. Each reminder has a fixed identifier per
 * kind, so setting them again replaces the old ones instead of adding duplicates; they are cancelled on sign-out
 * (src/state/session.ts), on consent withdrawal and after a loss. Text is generic — never a name or clinical detail.
 *
 * expo-notifications is imported at call time, so a build without it keeps running (as src/lib/device.ts).
 */
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';

export type ReminderKind = 'meds' | 'visits' | 'test';

/** 'denied': notifications are off for the app. 'unavailable': this build has no notifications module. */
export type ReminderResult = 'ok' | 'denied' | 'unavailable';

export type Reminder = { key: string; title: string; body: string } & ({ at: Date } | { hour: number; minute: number });

const PREFIX = 'vatsala:';
const idFor = (kind: ReminderKind, key: string) => `${PREFIX}${kind}:${key}`;

async function load() {
  try {
    return await import('expo-notifications');
  } catch {
    return undefined;
  }
}

/** Cancels this app's reminders of one kind, or every scheduled reminder on sign-out. Never throws. */
export async function cancelReminders(kind?: ReminderKind): Promise<void> {
  const N = await load();
  if (!N) return;
  try {
    if (!kind) return await N.cancelAllScheduledNotificationsAsync();
    const scheduled = await N.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter((r) => r.identifier.startsWith(`${PREFIX}${kind}:`)).map((r) => N.cancelScheduledNotificationAsync(r.identifier)));
  } catch {
    /* nothing scheduled, or the module is unavailable */
  }
}

/** Replaces every reminder of `kind` with `list` (cancel first, then schedule). */
export async function replaceReminders(kind: ReminderKind, list: Reminder[]): Promise<ReminderResult> {
  const N = await load();
  if (!N) return 'unavailable';
  try {
    const perm = await N.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
    await N.setNotificationChannelAsync('reminders', { name: 'Reminders', importance: N.AndroidImportance.DEFAULT });
    await cancelReminders(kind);
    for (const r of list) {
      const trigger =
        'at' in r
          ? { type: N.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: 'reminders' } as const
          : { type: N.SchedulableTriggerInputTypes.DAILY, hour: r.hour, minute: r.minute, channelId: 'reminders' } as const;
      await N.scheduleNotificationAsync({ identifier: idFor(kind, r.key), content: { title: r.title, body: r.body }, trigger });
    }
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

/** Tells her why nothing was set (permission off, or an older app build). Returns true when the reminders were set. */
export function reminderSet(t: TFunction, result: ReminderResult): boolean {
  if (result === 'denied') Alert.alert(t('family.rem.deniedTitle'), t('family.rem.denied'));
  if (result === 'unavailable') Alert.alert(t('family.rem.deniedTitle'), t('family.rem.unavailable'));
  return result === 'ok';
}
