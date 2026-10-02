import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Info, MapPin, Package } from 'lucide-react-native';

import { useDb } from '@/data/store';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { itemStatus, itemTitle, itemWhen } from '@/features/family/itemText';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { useNow } from '@/lib/clock';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, EmergencyButtons, GlassSurface, Screen, StatusBadge, TopBar, palette, space } from '@/ui';

function Line({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
      <Icon size={20} color={palette.rose600} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <AppText variant="label" tone="secondary">
          {label}
        </AppText>
        <AppText variant="bodyMedium">{value}</AppText>
      </View>
    </View>
  );
}

/** FH-11 Schedule item: when, where, what to bring, how to prepare, "I can't come" (F-44). */
export default function FamilyItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const item = familyItems(db, ctx, now).find((i) => i.id === id);
  const [sent, setSent] = useState(false);
  const { busy, once } = useSubmitOnce();

  if (!item || !ctx.mother) return <Screen header={<TopBar back />}><AppText>—</AppText></Screen>;

  return (
    <Screen
      blob="top"
      blobCenterY={120}
      header={
        <TopBar
          back
          right={
            <ReadAloudButton
              text={[
                itemTitle(t, item),
                itemStatus(t, item),
                `${t('family.when')}: ${itemWhen(t, item, i18n.language)}`,
                item.place ? `${t('family.where')}: ${item.place}` : '',
                ...item.bring.map((b) => t(b)),
                ...item.prep.map((p) => t(p)),
              ]
                .filter(Boolean)
                .join('. ')}
            />
          }
        />
      }
    >
      <View style={{ gap: 6 }}>
        <AppText variant="display">{itemTitle(t, item)}</AppText>
        <StatusBadge status={item.status} label={itemStatus(t, item)} />
      </View>

      <Card style={{ gap: space.md }}>
        <Line icon={CalendarClock} label={t('family.when')} value={itemWhen(t, item, i18n.language)} />
        {!!item.place && <Line icon={MapPin} label={t('family.where')} value={item.place} />}
        {item.bring.length > 0 && <Line icon={Package} label={t('family.whatToBring')} value={item.bring.map((b) => t(b)).join(' · ')} />}
        {item.prep.length > 0 && <Line icon={Info} label={t('family.howToPrepare')} value={item.prep.map((p) => t(p)).join(' · ')} />}
      </Card>

      {item.status === 'missed' && (
        <GlassSurface strong radius={20} style={{ padding: space.lg }}>
          <AppText variant="bodyMedium">{t('family.missedUs')}</AppText>
        </GlassSurface>
      )}

      {sent ? (
        <GlassSurface strong radius={20} style={{ padding: space.lg }}>
          <AppText variant="bodyMedium">{t('family.cantComeDone')}</AppText>
        </GlassSurface>
      ) : (
        <Button
          variant="secondary"
          label={t('family.cantCome')}
          disabled={busy}
          onPress={once(() => {
            // The care team reads English (PRD F-62); the family sees their own language.
            const tEn = i18n.getFixedT('en');
            db.requestCallback(ctx.mother!.id, [], `${tEn('family.cb.cantCome')}: ${itemTitle(tEn, item)}`, ctx.isCaregiver ? `${ctx.accountName} (caregiver)` : `${ctx.mother!.name} (mother)`, 'app', now);
            setSent(true);
          })}
        />
      )}

      <EmergencyButtons call108={t('family.call108')} callHospital={t('family.callHospital')} />
    </Screen>
  );
}
