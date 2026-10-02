import { useTranslation } from 'react-i18next';

import { MedicinesView } from '@/features/family/MedicinesView';
import { AppText, Screen, TopBar } from '@/ui';

/**
 * FH-24 / F-46 My medicines — ONLY clinician-prescribed medicines. Taken/Skipped is
 * family-reported adherence data the care team can see; the app never suggests medicines.
 * Also embedded in My Profile — shared body lives in MedicinesView.
 */
export default function Medicines() {
  const { t } = useTranslation();
  return (
    <Screen blob="none" header={<TopBar back title={t('family.meds.title')} />}>
      <AppText variant="display">{t('family.meds.title')}</AppText>
      <MedicinesView />
    </Screen>
  );
}
