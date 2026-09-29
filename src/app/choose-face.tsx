import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HeartHandshake, Stethoscope } from 'lucide-react-native';

import { useSession } from '@/state/session';
import { AppText, GlassSurface, MoodProvider, PressableScale, Screen, palette, space } from '@/ui';

/** AU-04: for people who are both staff and a patient (e.g. a pregnant doctor). */
export default function ChooseFace() {
  const { t } = useTranslation();
  const chooseFace = useSession((s) => s.chooseFace);
  const signOut = useSession((s) => s.signOut);

  const options = [
    { face: 'care' as const, icon: Stethoscope, title: t('auth.careDoor'), sub: t('auth.careDoorSub') },
    { face: 'family' as const, icon: HeartHandshake, title: t('auth.familyDoor'), sub: t('auth.familyDoorSub') },
  ];

  return (
    <MoodProvider mood="family">
      <Screen>
        <View style={styles.head}>
          <AppText variant="display" align="center">
            {t('auth.chooseTitle')}
          </AppText>
          <AppText tone="secondary" align="center">
            {t('auth.chooseSub')}
          </AppText>
        </View>
        {options.map(({ face, icon: Icon, title, sub }) => (
          <PressableScale key={face} onPress={() => chooseFace(face)} accessibilityRole="button" accessibilityLabel={title}>
            <GlassSurface strong style={styles.card}>
              <Icon size={28} color={palette.rose600} strokeWidth={1.8} />
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{title}</AppText>
                <AppText variant="caption" tone="secondary">
                  {sub}
                </AppText>
              </View>
            </GlassSurface>
          </PressableScale>
        ))}
        <PressableScale onPress={signOut} accessibilityRole="button" style={{ alignSelf: 'center', padding: space.md }}>
          <AppText variant="label" tone="accent">
            {t('common.signOut')}
          </AppText>
        </PressableScale>
      </Screen>
    </MoodProvider>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 140, marginBottom: space.xl, gap: space.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
});
