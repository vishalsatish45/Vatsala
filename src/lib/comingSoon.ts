import { Alert } from 'react-native';

import i18n from './i18n';

/** Temporary handler for actions built in later phases. */
export function comingSoon(what?: string) {
  Alert.alert(i18n.t('common.comingSoon'), what ? `${what}\n\n${i18n.t('common.comingSoonBody')}` : i18n.t('common.comingSoonBody'));
}
