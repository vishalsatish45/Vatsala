import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { formatGA, gestationalAge } from '@domain/gestation';

import { CARD_DEFAULT, CARD_FIELDS, type CardField } from '@/data/catalogue';
import { useDb } from '@/data/store';
import { useFamily } from '@/features/family/useFamily';
import { fmtShort } from '@/features/family/itemText';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, GlassSurface, InfoRow, Screen, TopBar, palette, space } from '@/ui';

/**
 * FA-30/31 Emergency card (PRD F-45). QR holds plain text so any phone camera can read it
 * offline. The mother chooses the fields; sensitive results are never offered.
 */
export default function EmergencyCard() {
  const { t } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [editing, setEditing] = useState(false);
  const { mother, pregnancy: p } = ctx;
  if (!mother || !p) return <Screen header={<TopBar back />}><AppText>—</AppText></Screen>;

  const fields: CardField[] = db.cardFields[mother.id] ?? CARD_DEFAULT;
  const values: Record<CardField, string> = {
    name: mother.name,
    age: `${mother.age}`,
    blood: p.history.bloodGroup ?? '—',
    weeks: p.status === 'delivered' ? '—' : `${formatGA(gestationalAge(p.edd, now))} · EDD ${fmtShort(p.edd, 'en')}`,
    allergies: p.history.allergies.join(', ') || t('family.card.none'),
    conditions: p.history.conditions.join(', ') || t('family.card.none'),
    hospital: 'Demo District Hospital · 080-2222-0000',
    emergency: `${mother.emergencyContact.name} ${mother.emergencyContact.phone}`,
  };
  // QR text is always English so any responder can read it.
  const qrValue = (f: CardField) =>
    f === 'allergies' ? p.history.allergies.join(', ') || 'None' : f === 'conditions' ? p.history.conditions.join(', ') || 'None' : values[f];
  const qr = ['EMERGENCY CARD', p.mchId, ...fields.map((f) => `${f.toUpperCase()}: ${qrValue(f)}`)].join('\n');
  const toggle = (f: CardField) => db.setCardFields(mother.id, fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f]);
  const readOnly = ctx.isCaregiver;

  return (
    <Screen blobCenterY={260} header={<TopBar back title={t('family.card.title')} />}>
      <AppText tone="secondary" align="center">
        {t('family.card.sub')}
      </AppText>
      <GlassSurface strong style={styles.card}>
        <View style={styles.qr}>
          <QRCode value={qr} size={190} color={palette.ink} backgroundColor="transparent" />
        </View>
        <AppText variant="caption" tone="secondary" align="center">
          {p.mchId}
        </AppText>
        <View style={{ alignSelf: 'stretch' }}>
          {fields.map((f) => (
            <InfoRow key={f} label={t(`family.card.f.${f}`)} value={values[f]} />
          ))}
        </View>
      </GlassSurface>

      {!readOnly && <Button variant="secondary" label={t('family.card.edit')} onPress={() => setEditing((e) => !e)} />}
      {editing && (
        <Card style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CARD_FIELDS.map((f) => (
              <Chip key={f} label={t(`family.card.f.${f}`)} variant={fields.includes(f) ? 'selected' : 'soft'} onPress={() => toggle(f)} />
            ))}
          </View>
          <AppText variant="caption" tone="faint">
            {t('family.me.never')}
          </AppText>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, alignItems: 'center', gap: space.sm },
  qr: { padding: space.md, backgroundColor: palette.white, borderRadius: 20 },
});
