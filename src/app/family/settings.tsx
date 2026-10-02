import { useState } from 'react';
import { Linking, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ambulance, BellRing, Building2, Phone, UserPlus } from 'lucide-react-native';
import { addDays } from '@domain/gestation';

import { useDb } from '@/data/store';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { canUseDeviceLock, scheduleAt } from '@/lib/device';
import { fmtShort } from '@/features/family/itemText';
import { useNow } from '@/lib/clock';
import { LANGUAGES } from '@/lib/i18n';
import { useSession } from '@/state/session';
import { AppText, Avatar, Button, Card, Chip, ListRow, Screen, Section, TopBar, palette, space } from '@/ui';

/** Settings: everything that used to live in Me except card + medicines. */
export default function FamilySettings() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const account = useSession((s) => s.account);
  const lang = useSession((s) => s.lang);
  const setLang = useSession((s) => s.setLang);
  const signOut = useSession((s) => s.signOut);
  const chooseFace = useSession((s) => s.chooseFace);
  const prefs = useSession((s) => s.familyPrefs[ctx.accountId]);
  const setChannels = useSession((s) => s.setChannels);
  const caregivers = ctx.mother ? db.caregivers.filter((c) => c.motherId === ctx.mother!.id && !c.revokedAt) : [];
  const channels = prefs?.channels ?? [];
  const setLock = useSession((s) => s.setLock);
  const [remMsg, setRemMsg] = useState<string>();

  async function setVisitReminders() {
    try {
      const upcoming = familyItems(db, ctx, now).filter((i) => i.status === 'upcoming' || i.status === 'due');
      let n = 0;
      for (const i of upcoming) {
        const at = addDays(i.date, -1);
        at.setHours(9, 0, 0, 0);
        if (at.getTime() > Date.now()) {
          await scheduleAt(t('family.rem.notifTitle'), t('family.rem.notifBody'), at);
          n++;
        }
      }
      setRemMsg(t('family.rem.done', { n }));
    } catch {
      /* alert already shown */
    }
  }

  async function testReminder() {
    try {
      await scheduleAt(t('family.rem.notifTitle'), t('family.rem.notifBody'), new Date(Date.now() + 10_000));
      setRemMsg(t('family.rem.testDone'));
    } catch {
      /* alert already shown */
    }
  }

  async function toggleLock(on: boolean) {
    try {
      if (on && !(await canUseDeviceLock())) return setRemMsg(t('family.lock.none'));
      setLock(ctx.accountId, on);
    } catch {
      /* alert already shown */
    }
  }

  return (
    <Screen header={<TopBar back title={t('family.settingsTitle')} />}>
      {!ctx.isCaregiver && (
        <Section title={t('family.me.caregivers')}>
          {caregivers.length === 0 && <AppText tone="secondary">{t('family.me.noCaregivers')}</AppText>}
          {caregivers.map((c) => (
            <ListRow
              key={c.id}
              leading={<Avatar name={c.name} size={40} tint="lavender" />}
              title={`${c.name} · ${c.relation}`}
              subtitle={c.phone}
              meta={
                <>
                  {(Object.keys(c.scopes) as (keyof typeof c.scopes)[])
                    .filter((k) => c.scopes[k])
                    .map((k) => (
                      <Chip key={k} label={t(`family.me.scope.${k}`)} variant="soft" />
                    ))}
                </>
              }
              trailing={<Chip label={t('family.me.remove')} onPress={() => db.revokeCaregiver(c.id, ctx.accountName, now)} />}
            />
          ))}
          <Button variant="secondary" icon={UserPlus} label={t('family.me.add')} onPress={() => router.push('/family/caregiver')} />
          <AppText variant="caption" tone="faint">
            {t('family.me.never')}
          </AppText>
        </Section>
      )}

      <Section title={t('family.me.reminders')}>
        <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['app', 'whatsapp', 'sms'].map((c) => (
            <Chip key={c} label={t(`on.${c}`)} variant={channels.includes(c) ? 'selected' : 'soft'} onPress={() => setChannels(ctx.accountId, channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c])} />
          ))}
        </Card>
      </Section>

      <Section title={t('family.rem.title')}>
        <Card style={{ gap: space.sm }}>
          <Button variant="secondary" icon={BellRing} label={t('family.rem.set')} onPress={setVisitReminders} />
          <Chip label={t('family.rem.test')} onPress={testReminder} />
          {!!remMsg && <AppText variant="bodyMedium">{remMsg}</AppText>}
          <AppText variant="caption" tone="faint">
            {t('family.rem.privacy')}
          </AppText>
        </Card>
      </Section>

      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          <AppText variant="headline">{t('family.lock.title')}</AppText>
          <Switch value={!!prefs?.lock} onValueChange={toggleLock} trackColor={{ true: palette.rose300, false: palette.divider }} thumbColor={prefs?.lock ? palette.rose500 : palette.white} />
        </View>
        <AppText variant="caption" tone="secondary">
          {t('family.lock.sub')}
        </AppText>
      </Card>

      <Section title={t('common.language')}>
        <Card style={{ flexDirection: 'row', gap: 8 }}>
          {LANGUAGES.map((l) => (
            <Chip key={l.code} label={l.label} variant={l.code === lang ? 'selected' : 'soft'} onPress={() => setLang(l.code)} />
          ))}
        </Card>
      </Section>

      <Section title={t('family.me.contact')}>
        <Card style={{ gap: space.sm }}>
          <ListRow leading={<Building2 size={20} />} title={t('family.me.labourRoom')} subtitle="080-2222-0000" onPress={() => Linking.openURL('tel:08022220000')} />
          <ListRow leading={<Phone size={20} />} title={t('family.me.opd')} subtitle="080-2222-0001" onPress={() => Linking.openURL('tel:08022220001')} />
          <ListRow leading={<Ambulance size={20} />} title={t('family.me.ambulance')} subtitle="108 · 102" onPress={() => Linking.openURL('tel:108')} />
        </Card>
      </Section>

      <ListRow title={t('family.me.consent')} subtitle={prefs ? t('family.me.consentGiven', { date: fmtShort(new Date(prefs.consentAt), i18n.language) }) : '—'} onPress={() => router.push('/family/consent')} />

      {account?.faces.includes('care') && <Button variant="secondary" label="Switch to Care Team" onPress={() => chooseFace('care')} />}
      <Button variant="secondary" label={t('common.signOut')} onPress={signOut} />
    </Screen>
  );
}
