import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BellRing, Pill } from 'lucide-react-native';
import { addDays, localDay } from '@domain/gestation';

import { useDb, type DbState } from '@/data/store';
import { dosesToday, familyMedsFrom } from '@/features/family/meds';
import { replaceReminders, reminderSet } from '@/features/family/reminders';
import { todayIso } from '@/features/family/stage';
import { useFamily, type FamilyContext } from '@/features/family/useFamily';
import { useNow } from '@/lib/clock';
import { isRemote } from '@/lib/supabase';
import { localeFor } from '@/lib/i18n';
import { AppText, Button, Card, Chip, GlassSurface, palette, space } from '@/ui';

const SLOT_HOUR = { morning: 8, afternoon: 14, night: 20 } as const;
/** A domain date (UTC midnight) as its `YYYY-MM-DD`. */
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Her prescribed medicines as Home, My Profile and this view list them (meds.ts), in this app's mode. */
export const familyMeds = (db: Pick<DbState, 'prescriptions'>, ctx: Pick<FamilyContext, 'mother' | 'pregnancy' | 'scopes'>) => familyMedsFrom(db, ctx, isRemote);
export { dosesToday };

/**
 * Medicines body shared by /family/medicines and My Profile —
 * ONLY clinician-prescribed medicines. Taken/Skipped is family-reported.
 */
export function MedicinesView() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [reminders, setReminders] = useState(false);
  const mother = ctx.mother;
  if (!mother) return <AppText>—</AppText>;
  if (!ctx.scopes.logs) return <AppText tone="secondary">{t('family.me.limited', { name: mother.name })}</AppText>;
  const meds = familyMeds(db, ctx);

  // The phone's calendar day: a dose marked at 00:30 IST belongs to today, not to yesterday (the UTC day).
  const today = todayIso(now);
  const doseFor = (med: string, date: string, slot: string) => db.medDoses.find((d) => d.motherId === mother.id && d.med === med && d.date === date && d.slot === slot);
  const days = Array.from({ length: 7 }, (_, i) => addDays(localDay(now), i - 6));

  async function remind() {
    // One reminder per time of day, replacing any set before (no duplicates on a second tap).
    const slots = [...new Set(meds.flatMap((m) => m.slots))];
    const result = await replaceReminders(
      'meds',
      slots.map((s) => ({ key: s, title: t('family.meds.notifTitle'), body: t('family.meds.notifBody'), hour: SLOT_HOUR[s], minute: 0 })),
    );
    if (reminderSet(t, result)) setReminders(true);
  }

  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="caption" tone="secondary">
        {t('family.meds.note')}
      </AppText>

      <AppText variant="title">{t('family.meds.today')}</AppText>
      {meds.map((med) =>
        med.slots.map((slot) => {
          const d = doseFor(med.name, today, slot);
          const mark = (status: 'taken' | 'skipped') => db.logDose({ motherId: mother.id, med: med.name, medicationId: med.id, date: today, slot, status, at: now });
          return (
            <GlassSurface key={med.name + slot} strong radius={22} elevation="card" style={styles.row}>
              <View style={styles.icon}>
                <Pill size={20} color={palette.rose600} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{med.name}</AppText>
                <AppText variant="caption" tone="secondary">
                  {t(`family.meds.${slot}`)}{med.note ? ` · ${med.note}` : ''}
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
          <View key={med.name} style={styles.week}>
            <AppText variant="label" style={{ width: 72 }}>
              {med.name}
            </AppText>
            {days.map((day) => {
              const ds = med.slots.map((s) => doseFor(med.name, iso(day), s)?.status);
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
    </View>
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
