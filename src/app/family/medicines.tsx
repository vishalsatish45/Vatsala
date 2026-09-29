import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BellRing, Pill } from 'lucide-react-native';
import { addDays, toDateOnly } from '@domain/gestation';

import { medSlots } from '@/data/catalogue';
import { useDb } from '@/data/store';
import { useFamily } from '@/features/family/useFamily';
import { scheduleDaily } from '@/lib/device';
import { useNow } from '@/lib/clock';
import { localeFor } from '@/lib/i18n';
import { AppText, Button, Card, Chip, GlassSurface, Screen, TopBar, palette, space } from '@/ui';

const SLOT_HOUR = { morning: 8, afternoon: 14, night: 20 } as const;
const iso = (d: Date) => toDateOnly(d).toISOString().slice(0, 10);

/**
 * FH-24 / F-46 My medicines — ONLY clinician-prescribed medicines. Taken/Skipped is
 * family-reported adherence data the care team can see; the app never suggests medicines.
 */
export default function Medicines() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [reminders, setReminders] = useState(false);
  const meds = ctx.pregnancy?.history.medicines ?? [];
  const mother = ctx.mother;
  if (!mother) return <Screen header={<TopBar back />}><AppText>—</AppText></Screen>;

  const today = iso(now);
  const doseFor = (med: string, date: string, slot: string) => db.medDoses.find((d) => d.motherId === mother.id && d.med === med && d.date === date && d.slot === slot);
  const days = Array.from({ length: 7 }, (_, i) => addDays(toDateOnly(now), i - 6));

  async function remind() {
    try {
      const slots = new Set(meds.flatMap((m) => medSlots(m).slots));
      for (const s of slots) await scheduleDaily(t('family.meds.notifTitle'), t('family.meds.notifBody'), SLOT_HOUR[s], 0);
      setReminders(true);
    } catch {
      /* alert already shown */
    }
  }

  return (
    <Screen blob="none" header={<TopBar back title={t('family.meds.title')} />}>
      <AppText variant="display">{t('family.meds.title')}</AppText>
      <AppText variant="caption" tone="secondary">
        {t('family.meds.note')}
      </AppText>

      <AppText variant="title">{t('family.meds.today')}</AppText>
      {meds.map((med) =>
        medSlots(med).slots.map((slot) => {
          const d = doseFor(med, today, slot);
          const mark = (status: 'taken' | 'skipped') => db.logDose({ motherId: mother.id, med, date: today, slot, status, at: now });
          return (
            <GlassSurface key={med + slot} strong radius={22} elevation="card" style={styles.row}>
              <View style={styles.icon}>
                <Pill size={20} color={palette.rose600} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{med}</AppText>
                <AppText variant="caption" tone="secondary">
                  {t(`family.meds.${slot}`)} · {medSlots(med).note}
                </AppText>
              </View>
              {!ctx.isCaregiver && (
                <View style={{ gap: 6 }}>
                  <Chip label={t('family.meds.taken')} variant={d?.status === 'taken' ? 'selected' : 'soft'} onPress={() => mark('taken')} />
                  <Chip label={t('family.meds.skipped')} variant={d?.status === 'skipped' ? 'selected' : 'soft'} onPress={() => mark('skipped')} />
                </View>
              )}
            </GlassSurface>
          );
        }),
      )}

      <Card style={{ gap: space.sm }}>
        <AppText variant="headline">{t('family.meds.week')}</AppText>
        {meds.map((med) => (
          <View key={med} style={styles.week}>
            <AppText variant="label" style={{ width: 72 }}>
              {med}
            </AppText>
            {days.map((day) => {
              const ds = medSlots(med).slots.map((s) => doseFor(med, iso(day), s)?.status);
              const all = ds.every((x) => x === 'taken');
              const some = ds.some((x) => x === 'skipped');
              return (
                <View key={day.toISOString()} style={styles.dayCol}>
                  <View style={[styles.dot, all ? styles.dotTaken : some ? styles.dotSkipped : styles.dotNone]} />
                  <AppText variant="caption" tone="faint" style={{ fontSize: 10 }}>
                    {day.toLocaleDateString(localeFor(i18n.language), { weekday: 'narrow', timeZone: 'UTC' })}
                  </AppText>
                </View>
              );
            })}
          </View>
        ))}
      </Card>

      {!ctx.isCaregiver && (reminders ? <Chip label={`✓ ${t('family.meds.remindSet')}`} variant="selected" /> : <Button variant="secondary" icon={BellRing} label={t('family.meds.remind')} onPress={remind} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row', alignItems: 'center' },
  dayCol: { flex: 1, alignItems: 'center', gap: 2 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  dotTaken: { backgroundColor: palette.done },
  dotSkipped: { borderWidth: 2, borderColor: palette.due },
  dotNone: { borderWidth: 1, borderColor: palette.softBorder },
});
