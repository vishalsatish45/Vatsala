import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { HeartHandshake, Stethoscope, type LucideIcon } from 'lucide-react-native';

import { LANGUAGES } from '@/lib/i18n';
import { useSession } from '@/state/session';
import { AppText, Chip, GlassSurface, PressableScale, Screen, palette, space } from '@/ui';

function Door({ icon: Icon, title, sub, onPress }: { icon: LucideIcon; title: string; sub: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <GlassSurface strong style={styles.door}>
        <View style={styles.doorIcon}>
          <Icon size={26} color={palette.rose600} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="headline">{title}</AppText>
          <AppText variant="caption" tone="secondary">
            {sub}
          </AppText>
        </View>
      </GlassSurface>
    </PressableScale>
  );
}

/** AU-01: two doors. The door is a UX hint only — the face is decided server-side. */
export default function Welcome() {
  const { t } = useTranslation();
  const lang = useSession((s) => s.lang);
  const setLang = useSession((s) => s.setLang);

  return (
    <Screen blobCenterY={260}>
      <View style={styles.langs}>
        {LANGUAGES.map((l) => (
          <Chip key={l.code} label={l.label} variant={l.code === lang ? 'selected' : 'glass'} onPress={() => setLang(l.code)} />
        ))}
      </View>

      <View style={styles.hero}>
        <AppText variant="display" tone="accent" align="center">
          Vatsala
        </AppText>
        <AppText variant="title" align="center">
          {t('auth.tagline')}
        </AppText>
      </View>

      <View style={styles.doors}>
        <Door icon={HeartHandshake} title={t('auth.familyDoor')} sub={t('auth.familyDoorSub')} onPress={() => router.push({ pathname: '/phone', params: { door: 'family' } })} />
        <Door icon={Stethoscope} title={t('auth.careDoor')} sub={t('auth.careDoorSub')} onPress={() => router.push({ pathname: '/phone', params: { door: 'care' } })} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  langs: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: space.md },
  hero: { marginTop: 150, marginBottom: 120, gap: space.sm, paddingHorizontal: space.md },
  doors: { gap: space.sm },
  door: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  doorIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' },
});
