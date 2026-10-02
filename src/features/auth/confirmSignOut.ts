import { Alert } from 'react-native';

import { pendingWrites } from '@/data/outbox';
import i18n from '@/lib/i18n';

/**
 * Sign-out deletes writes this phone has not sent yet (they may not be sent under another login). With any waiting,
 * ask first; otherwise sign out at once. Every sign-out button goes through this.
 */
export function confirmSignOut(signOut: () => void) {
  const n = pendingWrites();
  if (n === 0) return signOut();
  Alert.alert(
    i18n.t('signOutUnsent.title', { defaultValue: 'Changes not sent yet' }),
    i18n.t('signOutUnsent.body', {
      count: n,
      defaultValue_one: '1 change made on this phone has not reached the server yet. Signing out now deletes it. Connect to the internet and wait for it to send first.',
      defaultValue_other: '{{count}} changes made on this phone have not reached the server yet. Signing out now deletes them. Connect to the internet and wait for them to send first.',
    }),
    [
      { text: i18n.t('signOutUnsent.stay', { defaultValue: 'Stay signed in' }), style: 'cancel' },
      { text: i18n.t('signOutUnsent.signOut', { defaultValue: 'Sign out and delete' }), style: 'destructive', onPress: signOut },
    ],
  );
}
