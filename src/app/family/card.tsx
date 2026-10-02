import { useTranslation } from 'react-i18next';

import { EmergencyCardView } from '@/features/family/EmergencyCardView';
import { AppText, Screen, TopBar } from '@/ui';

/**
 * FA-30/31 Emergency card (PRD F-45). QR holds plain text so any phone camera can read it
 * offline. The mother chooses the fields; sensitive results are never offered.
 * Also embedded in My Profile — shared body lives in EmergencyCardView.
 */
export default function EmergencyCard() {
  const { t } = useTranslation();
  return (
    <Screen blobCenterY={260} header={<TopBar back title={t('family.card.title')} />}>
      <AppText tone="secondary" align="center">
        {t('family.card.sub')}
      </AppText>
      <EmergencyCardView />
    </Screen>
  );
}
