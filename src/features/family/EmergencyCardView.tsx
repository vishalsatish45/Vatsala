import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { formatGA, gestationalAge, localDay } from '@domain/gestation';

import { CARD_DEFAULT, CARD_FIELDS, type CardField } from '@/data/catalogue';
import { useDb } from '@/data/store';
import { useFamily } from '@/features/family/useFamily';
import { fmtShort } from '@/features/family/itemText';
import { isPregnant } from '@/features/family/stage';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, GlassSurface, InfoRow, PressableScale, palette, space } from '@/ui';

/**
 * Emergency-card body shared by /family/card and My Profile —
 * QR + chosen fields + edit toggle. Sensitive results never offered.
 * The card is the mother's: the server never sends its facts to a caregiver, so a caregiver sees a plain
 * "on her phone" note — never an empty card that would read "Allergies: None".
 */
export function EmergencyCardView({ qrSize = 190, onOpen }: { qrSize?: number; onOpen?: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [editing, setEditing] = useState(false);
  const { mother, pregnancy: p } = ctx;
  if (!mother || !p) return <AppText>—</AppText>;
  if (ctx.isCaregiver) {
    return (
      <GlassSurface strong style={styles.card}>
        <AppText tone="secondary" align="center">
          {t('family.card.notShared', { name: mother.name })}
        </AppText>
      </GlassSurface>
    );
  }

  const fields: CardField[] = db.cardFields[mother.id] ?? CARD_DEFAULT;
  const values: Record<CardField, string> = {
    name: mother.name,
    age: `${mother.age}`,
    blood: p.history.bloodGroup ?? '—',
    // Weeks and due date only while she is pregnant (not after a birth, a closed episode or a loss).
    weeks: !isPregnant(p) ? '—' : p.edd ? `${formatGA(gestationalAge(p.edd, localDay(now)))} · ${t('family.card.edd')} ${fmtShort(p.edd, 'en')}` : t('family.dueDateLater'),
    allergies: p.history.allergies.join(', ') || t('family.card.none'),
    conditions: p.history.conditions.join(', ') || t('family.card.none'),
    hospital: [db.hospital?.name, db.hospital?.phoneLabour ?? db.hospital?.phoneOpd].filter(Boolean).join(' · ') || '—',
    emergency: `${mother.emergencyContact.name} ${mother.emergencyContact.phone}`,
  };
  const qrValue = (f: CardField) =>
    f === 'allergies' ? p.history.allergies.join(', ') || 'None' : f === 'conditions' ? p.history.conditions.join(', ') || 'None' : values[f];
  const qr = ['EMERGENCY CARD', p.mchId, ...fields.map((f) => `${f.toUpperCase()}: ${qrValue(f)}`)].join('\n');
  const toggle = (f: CardField) => db.setCardFields(mother.id, fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f]);

  const cardBody = (
    <GlassSurface strong style={styles.card}>
      <View style={styles.qr}>
        <QRCode value={qr} size={qrSize} color={palette.ink} backgroundColor="transparent" />
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
  );

  return (
    <View style={{ gap: space.sm }}>
      {onOpen ? (
        <PressableScale onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('family.card.title')}>
          {cardBody}
        </PressableScale>
      ) : (
        cardBody
      )}
      <Button variant="secondary" label={t('family.card.edit')} onPress={() => setEditing((e) => !e)} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, alignItems: 'center', gap: space.sm },
  qr: { padding: space.md, backgroundColor: palette.white, borderRadius: 20 },
});
