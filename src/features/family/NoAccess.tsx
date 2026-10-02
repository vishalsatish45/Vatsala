import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react-native';

import { useSession } from '@/state/session';
import { AppText, Button, GlassSurface, Screen, palette, space } from '@/ui';

/**
 * Shown instead of every Family screen when this account may no longer see her record: a caregiver the mother removed,
 * or a consent the server refuses as "not visible". Nothing of hers is shown; the only way on is to sign out
 * (which also cancels this phone's reminders).
 */
export function NoAccess({ caregiver, motherName }: { caregiver: boolean; motherName?: string }) {
  const { t } = useTranslation();
  const signOut = useSession((s) => s.signOut);
  return (
    <Screen blobCenterY={200} footer={<Button label={t('common.signOut')} onPress={signOut} />}>
      <GlassSurface strong style={{ padding: space.lg, gap: space.sm, marginTop: space.xl, alignItems: 'center' }}>
        <Lock size={40} color={palette.rose600} strokeWidth={1.6} />
        <AppText variant="display" align="center">
          {t('family.noAccess.title')}
        </AppText>
        <AppText tone="secondary" align="center">
          {caregiver ? t('family.noAccess.caregiver', { name: motherName || t('family.focus.mother') }) : t('auth.noAccess')}
        </AppText>
      </GlassSurface>
    </Screen>
  );
}
