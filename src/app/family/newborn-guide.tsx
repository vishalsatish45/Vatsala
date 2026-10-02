import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { daysBetween } from '@domain/gestation';

import { NEWBORN_DAYS } from '@/features/family/learnI18n';
import { useFamily } from '@/features/family/useFamily';
import { useNow } from '@/lib/clock';
import { AppText, Button, GlassSurface, PressableScale, Screen, TopBar, palette, space } from '@/ui';

/** FH-52 Newborn day by day — general care per day; danger signs link to the warning-signs page. */
export default function NewbornGuide() {
  const { t, i18n } = useTranslation();
  const lang = (['kn', 'hi'].includes(i18n.language) ? i18n.language : 'en') as 'en' | 'kn' | 'hi';
  const now = useNow();
  const { babies } = useFamily();
  const age = babies[0] ? Math.max(1, daysBetween(babies[0].dob, now)) : 1;
  const current = [...NEWBORN_DAYS].reverse().find((d) => d.day <= age) ?? NEWBORN_DAYS[0]!;
  const [sel, setSel] = useState(current.day);
  const day = NEWBORN_DAYS.find((d) => d.day === sel)!;

  return (
    <Screen blobCenterY={150} header={<TopBar back title={t('family.guide.title')} />}>
      {babies[0] && (
        <AppText variant="bodyMedium" tone="secondary" align="center">
          {t('family.guide.today', { n: age })}
        </AppText>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
        {NEWBORN_DAYS.map((d) => {
          const on = d.day === sel;
          const isNow = d.day === current.day;
          return (
            <PressableScale key={d.day} onPress={() => setSel(d.day)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <View style={[styles.day, on && styles.dayOn, isNow && !on && styles.dayNow]}>
                <AppText variant="headline" style={{ color: on ? palette.white : palette.ink }}>
                  {d.day}
                </AppText>
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>
      <GlassSurface strong style={{ padding: space.lg, gap: space.sm }}>
        <AppText variant="title">{t('family.guide.day', { n: day.day })}</AppText>
        {day[lang].map((line, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
            <AppText tone="accent">•</AppText>
            <AppText style={{ flex: 1 }}>{line}</AppText>
          </View>
        ))}
      </GlassSurface>
      <Button variant="secondary" label={t('family.guide.signs')} onPress={() => router.push('/family/signs')} />
      <AppText variant="caption" tone="faint" align="center">
        {t('family.learn.reviewed')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: palette.white },
  dayOn: { backgroundColor: palette.rose500, borderColor: palette.rose500 },
  dayNow: { borderColor: palette.amber, borderWidth: 2 },
});
