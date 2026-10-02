import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pill, Settings, ShieldAlert } from 'lucide-react-native';

import { useFamily } from '@/features/family/useFamily';
import { EmergencyCardView } from '@/features/family/EmergencyCardView';
import { MedicinesView } from '@/features/family/MedicinesView';
import { AppText, Avatar, Chip, DropdownSection, GlassIconButton, Screen, TopBar, palette, space } from '@/ui';

/** My Profile: emergency card and medicines presented as collapsible dropdowns. */
export default function FamilyProfile() {
  const { t } = useTranslation();
  const ctx = useFamily();
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [medsOpen, setMedsOpen] = useState(false);

  const bloodGroup = ctx.pregnancy?.history.bloodGroup;
  const meds = ctx.pregnancy?.history.medicines ?? [];

  return (
    <Screen header={<TopBar back title={t('family.profileTitle')} right={<GlassIconButton icon={Settings} accessibilityLabel={t('family.settingsTitle')} onPress={() => router.push('/family/settings' as any)} />} />}>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Avatar name={ctx.accountName || '?'} size={64} />
        <AppText variant="title">{ctx.accountName}</AppText>
        <AppText tone="secondary">
          {ctx.pregnancy?.mchId} · Demo District Hospital
        </AppText>
        {!!ctx.pregnancy?.assignedDoctor && (
          <AppText tone="secondary">🩺 {ctx.pregnancy.assignedDoctor.name}</AppText>
        )}
        {ctx.isCaregiver && <Chip label={t('family.viewingAs', { name: ctx.accountName })} variant="tag" />}
      </View>

      <DropdownSection
        title={t('family.myCard', 'My Card')}
        subtitle={bloodGroup ? `${bloodGroup} · QR code & contacts` : 'QR code & contacts'}
        icon={ShieldAlert}
        iconColor={palette.rose600}
        iconBg={palette.rose50}
        badge={bloodGroup ? <Chip label={bloodGroup} variant="soft" /> : undefined}
        isOpen={emergencyOpen}
        onToggle={setEmergencyOpen}
      >
        <EmergencyCardView qrSize={160} onOpen={() => router.push('/family/card')} />
      </DropdownSection>

      <DropdownSection
        title={t('family.meds.title')}
        subtitle={meds.length > 0 ? `${meds.length} prescribed · Today's schedule` : "Today's schedule & tracking"}
        icon={Pill}
        iconColor={palette.lav600}
        iconBg={palette.lav100}
        badge={meds.length > 0 ? <Chip label={`${meds.length}`} variant="soft" /> : undefined}
        isOpen={medsOpen}
        onToggle={setMedsOpen}
      >
        <MedicinesView />
      </DropdownSection>
    </Screen>
  );
}
