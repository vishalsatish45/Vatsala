import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
          <Icon size={20} color={palette.rose600} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="headline" style={styles.doorTitle}>
            {title}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {sub}
          </AppText>
        </View>
      </GlassSurface>
    </PressableScale>
  );
}

const BACKDROP = require('../../../assets/images/welcome-backdrop.png');
const LOCKUP = require('../../../assets/images/vatsala-lockup.png');

/** AU-01: the brand artwork (floral frame, logo, tagline) and two doors. The door is a UX hint only — the face is decided server-side. */
export default function Welcome() {
  const { t } = useTranslation();
  const lang = useSession((s) => s.lang);
  const setLang = useSession((s) => s.setLang);
  const insets = useSafeAreaInsets();

  return (
    <Screen scroll={false} backdrop={<Image source={BACKDROP} contentFit="cover" style={styles.backdrop} />}>
      <View style={styles.langs}>
        {LANGUAGES.map((l) => (
          <Chip key={l.code} label={l.label} variant={l.code === lang ? 'brand' : 'glass'} onPress={() => setLang(l.code)} />
        ))}
      </View>

      <View style={styles.hero}>
        <Image source={LOCKUP} contentFit="contain" style={styles.lockup} accessible accessibilityRole="image" accessibilityLabel="Vatsala" />
        {/* The artwork's tagline, as text so it follows the chosen language */}
        <AppText variant="headline" align="center" style={styles.tagline}>
          {t('auth.tagline').replace(/\.$/, '')}
        </AppText>
      </View>

      <View style={[styles.doors, { paddingBottom: insets.bottom + 88 }]}>
        <Door icon={HeartHandshake} title={t('auth.familyDoor')} sub={t('auth.familyDoorSub')} onPress={() => router.push({ pathname: '/phone', params: { door: 'family' } })} />
        <Door icon={Stethoscope} title={t('auth.careDoor')} sub={t('auth.careDoorSub')} onPress={() => router.push({ pathname: '/phone', params: { door: 'care' } })} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  langs: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: space.md },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.brandPaper },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.lg },
  lockup: { width: '100%', flexShrink: 1, maxHeight: 238, aspectRatio: 452 / 596 },
  tagline: { color: palette.brandBlush, textTransform: 'uppercase', letterSpacing: 0.6 },
  // Clear of the artwork's bottom florals, and inset from the screen edges
  doors: { gap: space.xs, paddingHorizontal: space.md },
  door: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md },
  doorTitle: { fontSize: 16, lineHeight: 22 },
  doorIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' },
});
