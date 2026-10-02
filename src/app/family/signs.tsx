import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Baby,
  Droplet,
  Droplets,
  Eye,
  Flame,
  HeartCrack,
  Moon,
  Snowflake,
  Thermometer,
  TriangleAlert,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';

import { WARNING_SIGNS, type SignStage } from '@/data/catalogue';
import { infoSignStages } from '@/features/family/stage';
import { useFamily } from '@/features/family/useFamily';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { AppText, Button, EmergencyButtons, GlassSurface, Screen, SegmentedPills, TopBar, palette, space } from '@/ui';

const ICONS: Record<string, LucideIcon> = {
  bleeding: Droplet,
  headache_vision: Eye,
  fits: Zap,
  leaking: Droplets,
  movements: Baby,
  belly_pain: Flame,
  fever: Thermometer,
  breathless: Wind,
  heavy_bleeding: Droplet,
  pn_fever: Thermometer,
  pn_headache: Eye,
  wound: Flame,
  breast: HeartCrack,
  low_mood: Moon,
  not_feeding: Baby,
  baby_fits: Zap,
  fast_breathing: Wind,
  chest_indrawing: Wind,
  baby_fever: Thermometer,
  cold: Snowflake,
  sleepy: Moon,
  yellow: Eye,
  cord: Flame,
};

/**
 * FA-20 Warning signs (PRD F-42, §10.6). Static, educational, identical for everyone —
 * no logic ever chooses a message based on input.
 */
export default function WarningSigns() {
  const { t } = useTranslation();
  const ctx = useFamily();
  // After a birth (also once the episode is closed) her own signs come first; after a loss only hers (stage.ts).
  const stages = infoSignStages(ctx.stage);
  const [picked, setStage] = useState<SignStage>();
  const stage = picked && stages.includes(picked) ? picked : ctx.stage === 'pregnant' || ctx.stage === 'none' ? 'pregnancy' : 'postnatal';

  return (
    <Screen
      blob="none"
      header={<TopBar back title={t('family.signs.title')} right={<ReadAloudButton text={[t('family.signs.banner'), ...Object.keys(WARNING_SIGNS[stage]).map((k) => t(`signs.${k}`))].join('. ')} />} />}
      footer={<EmergencyButtons call108={t('family.call108')} callHospital={t('family.callHospital')} />}
    >
      <GlassSurface strong radius={22} style={styles.banner}>
        <TriangleAlert size={26} color={palette.amber} />
        <AppText variant="headline" style={{ flex: 1 }}>
          {t('family.signs.banner')}
        </AppText>
      </GlassSurface>

      {stages.length > 1 && <SegmentedPills value={stage} onChange={setStage} options={stages.map((s) => ({ value: s, label: t(`family.signs.${s}`) }))} />}

      <View style={styles.grid}>
        {Object.keys(WARNING_SIGNS[stage]).map((k) => {
          const Icon = ICONS[k] ?? TriangleAlert;
          return (
            <GlassSurface key={k} strong radius={22} elevation="card" style={styles.tile}>
              <View style={styles.icon}>
                <Icon size={30} color={palette.rose600} strokeWidth={1.6} />
              </View>
              <AppText variant="bodyMedium" align="center">
                {t(`signs.${k}`)}
              </AppText>
            </GlassSurface>
          );
        })}
      </View>

      <Button variant="secondary" label={t('family.askCall')} onPress={() => router.push('/family/callback')} />
      <AppText variant="caption" tone="faint" align="center">
        {t('family.signs.reviewed')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexBasis: '47%', flexGrow: 1, padding: space.md, alignItems: 'center', gap: space.sm, minHeight: 130, justifyContent: 'center' },
  icon: { width: 60, height: 60, borderRadius: 30, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' },
});
