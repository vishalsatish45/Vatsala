import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CalendarClock, FlaskConical, MapPin, Package } from 'lucide-react-native';

import { asInvestigationId } from '@/data/ids';
import { useDb } from '@/data/store';
import { TEST_KEYS, familyTestStatus, familyTests } from '@/features/family/tests';
import { testPlaceKey, useFamily } from '@/features/family/useFamily';
import { fmtShort } from '@/features/family/itemText';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { useNow } from '@/lib/clock';
import { AppText, Card, EmergencyButtons, Screen, StatusBadge, TopBar, palette, space } from '@/ui';

/**
 * Family test detail: what the test is, when/where, result status. No clinical interpretation. Only a test the Journey
 * tests tab lists (her pregnancy, not sensitive, `tests` scope) opens; any other id is simply not found.
 */
export default function FamilyTestDetail() {
  const id = asInvestigationId(useLocalSearchParams<{ id: string }>().id);
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const inv = familyTests(db.investigations, ctx).find((x) => x.id === id);
  if (!inv) {
    return (
      <Screen header={<TopBar back />}>
        <AppText tone="secondary">{t('family.notFound')}</AppText>
      </Screen>
    );
  }

  const title = TEST_KEYS.includes(inv.code) ? t(`family.tests.${inv.code}`) : inv.label;
  const { status, labelKey } = familyTestStatus(inv, now, ctx.isCaregiver);
  const label = t(labelKey);
  const place = t(testPlaceKey(inv.kind));

  return (
    <Screen
      blob="top"
      blobCenterY={120}
      header={<TopBar back right={<ReadAloudButton text={`${title}. ${label}`} />} />}
    >
      <View style={{ gap: 6 }}>
        <AppText variant="display">{title}</AppText>
        <StatusBadge status={status} label={label} />
      </View>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <CalendarClock size={20} color={palette.rose600} />
          <View style={{ flex: 1 }}>
            <AppText variant="label" tone="secondary">{t('family.when')}</AppText>
            <AppText variant="bodyMedium">{t('family.before', { date: fmtShort(inv.dueBy, i18n.language) })}</AppText>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <MapPin size={20} color={palette.rose600} />
          <View style={{ flex: 1 }}>
            <AppText variant="label" tone="secondary">{t('family.where')}</AppText>
            <AppText variant="bodyMedium">{place}</AppText>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Package size={20} color={palette.rose600} />
          <View style={{ flex: 1 }}>
            <AppText variant="label" tone="secondary">{t('family.whatToBring')}</AppText>
            <AppText variant="bodyMedium">{t('family.prep.bring')}</AppText>
          </View>
        </View>
        {inv.code === 'ogtt' && (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <FlaskConical size={20} color={palette.rose600} />
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="secondary">{t('family.howToPrepare')}</AppText>
              <AppText variant="bodyMedium">{t('family.prep.fasting')}</AppText>
            </View>
          </View>
        )}
        {!!inv.result && (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <FlaskConical size={20} color={palette.rose600} />
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="secondary">{t('family.test.tested')}</AppText>
              <AppText variant="bodyMedium">{fmtShort(inv.result.at, i18n.language)}</AppText>
            </View>
          </View>
        )}
        {!!inv.result && (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <FlaskConical size={20} color={palette.rose600} />
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="secondary">{t('family.test.result')}</AppText>
              <AppText variant="bodyMedium">{`${inv.result.value}${inv.result.unit ? ` ${inv.result.unit}` : ''}`}</AppText>
            </View>
          </View>
        )}
        {!!inv.result && !ctx.isCaregiver && (
          <AppText variant="bodyMedium" tone="secondary">
            {t('family.status.discuss')} · {fmtShort(inv.result.at, i18n.language)}
          </AppText>
        )}
      </Card>
      <EmergencyButtons call108={t('family.call108')} callHospital={t('family.callHospital')} />
    </Screen>
  );
}
