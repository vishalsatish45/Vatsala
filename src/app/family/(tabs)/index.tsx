import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Bell, PhoneCall, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { daysBetween, formatGA, gestationalAge, pregnancyProgress, trimester } from '@domain/gestation';

import { useDb } from '@/data/store';
import { familyItems, useFamily, type FamilyItem } from '@/features/family/useFamily';
import { fmtShort, fmtWeekday, itemStatus, itemTitle, itemWhen, ordinalSuffix } from '@/features/family/itemText';
import { useNow } from '@/lib/clock';
import {
  AppText,
  Avatar,
  GlassIconButton,
  GlassSurface,
  HeroNumber,
  ListRow,
  NextStepCard,
  PressableScale,
  ProgressBar,
  Screen,
  StatTile,
  StatusBadge,
  TopBar,
  palette,
  space,
} from '@/ui';

function QuickTile({ icon: Icon, label, tint, onPress }: { icon: LucideIcon; label: string; tint: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={label}>
      <GlassSurface strong style={styles.tile}>
        <View style={[styles.tileIcon, { backgroundColor: tint + '22' }]}>
          <Icon size={22} color={tint} strokeWidth={1.9} />
        </View>
        <AppText variant="bodyMedium">{label}</AppText>
      </GlassSurface>
    </PressableScale>
  );
}

const openItem = (i: FamilyItem) => router.push({ pathname: '/family/item/[id]', params: { id: i.id } });

/** FH-01 / FH-02 Home: one hero, one next step (DESIGN.md §6.2). */
export default function FamilyHome() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const { mother, pregnancy: p, babies, isCaregiver, accountName } = ctx;
  const items = familyItems(db, ctx, now);
  const next = items[0];
  const delivered = p?.status === 'delivered' && babies.length > 0;
  const baby = babies[0];

  const header = (
    <TopBar
      left={<Avatar name={accountName || '?'} onPress={() => router.push('/family/profile')} />}
      right={<GlassIconButton icon={Bell} accessibilityLabel="Notifications" onPress={() => router.push('/family/schedule')} />}
    />
  );

  if (!p || !mother) {
    return (
      <Screen withNav header={header}>
        <AppText variant="display">{t('family.noUpcoming')}</AppText>
      </Screen>
    );
  }

  const ga = gestationalAge(p.edd, now);
  const loss = p.status === 'delivered' && babies.length === 0;
  const nextMother = items.find((i) => i.subject === 'mother');
  const nextBaby = items.find((i) => i.subject === 'baby');
  const card = (i: FamilyItem, eyebrow: string) => (
    <NextStepCard
      key={i.id}
      eyebrow={i.status === 'missed' ? t('family.missedUs') : eyebrow}
      title={itemTitle(t, i)}
      lines={[itemWhen(t, i, lang), i.place ?? '', ...i.bring.map((b) => t(b)), ...i.prep.map((x) => t(x))].filter(Boolean)}
      actionLabel={t('family.seeDetails')}
      onAction={() => openItem(i)}
    />
  );
  const nextCard = next && (
    <NextStepCard
      eyebrow={next.status === 'missed' ? t('family.missedUs') : t('family.nextStep')}
      title={itemTitle(t, next)}
      lines={[itemWhen(t, next, lang), next.place ?? '', ...next.bring.map((b) => t(b)), ...next.prep.map((x) => t(x))].filter(Boolean)}
      actionLabel={t('family.seeDetails')}
      onAction={() => openItem(next)}
    />
  );

  return (
    <Screen withNav blobCenterY={200} header={header}>
      {loss ? (
        <GlassSurface strong style={{ padding: space.lg, gap: space.sm, marginTop: space.xl }}>
          <AppText variant="display">{t('family.loss.title')}</AppText>
          <AppText tone="secondary">{t('family.loss.body')}</AppText>
          <AppText variant="bodyMedium" tone="accent">
            {t('family.loss.support')} · 080-2222-0000
          </AppText>
        </GlassSurface>
      ) : delivered && baby ? (
        <HeroNumber
          caption={isCaregiver ? `${mother.name} · ${t('family.babyAge')}` : t('family.babyAge')}
          value={String(daysBetween(baby.dob, now) < 14 ? daysBetween(baby.dob, now) : Math.floor(daysBetween(baby.dob, now) / 7))}
          suffix={` ${daysBetween(baby.dob, now) < 14 ? t('family.days') : t('family.weeksUnit')}`}
          chips={[baby.sex === 'F' ? '♀' : '♂', `${(baby.birthWeightG / 1000).toFixed(2)} kg`, fmtShort(baby.dob, lang)]}
        />
      ) : (
        <>
          <HeroNumber
            caption={isCaregiver ? `${mother.name} · ${t('family.pregnancyWeek')}` : t('family.pregnancyWeek')}
            value={String(ga.weeks)}
            suffix={ordinalSuffix(ga.weeks, lang)}
            chips={[t('family.trimester', { n: trimester(ga) }), fmtWeekday(now, lang), fmtShort(now, lang)]}
          />
          <GlassSurface style={{ padding: space.md }}>
            <ProgressBar progress={pregnancyProgress(ga)} leftCaption={t('family.weeksOf40', { weeks: formatGA(ga) })} rightCaption={`${Math.round(pregnancyProgress(ga) * 100)}%`} />
          </GlassSurface>
          <View style={styles.tiles}>
            <StatTile label={t('family.weeksToGo')} value={String(Math.max(0, Math.ceil(daysBetween(now, p.edd) / 7)))} unit={t('family.wks')} />
            <StatTile label={t('family.dueDate')} value={String(p.edd.getUTCDate())} unit={p.edd.toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { month: 'short', timeZone: 'UTC' })} />
          </View>
        </>
      )}

      {p.intensity !== 'routine' && !delivered && (
        <GlassSurface strong radius={20} style={styles.note}>
          <AppText variant="bodyMedium">{t('family.seeMoreOften')}</AppText>
        </GlassSurface>
      )}

      {delivered ? (
        <>
          {nextMother && card(nextMother, t('family.forYou'))}
          {nextBaby && card(nextBaby, t('family.forBaby'))}
        </>
      ) : (
        nextCard ?? (
          <GlassSurface strong style={{ padding: space.lg }}>
            <AppText tone="secondary">{t('family.noUpcoming')}</AppText>
          </GlassSurface>
        )
      )}

      {items.length > 1 && (
        <>
          <AppText variant="title">{t('family.comingUp')}</AppText>
          <View style={{ gap: space.sm }}>
            {items.filter((i) => i.id !== next?.id && i.id !== nextMother?.id && i.id !== nextBaby?.id).slice(0, 3).map((i) => (
              <ListRow key={i.id} title={itemTitle(t, i)} subtitle={`${itemWhen(t, i, lang)}${i.place ? ` · ${i.place}` : ''}`} meta={<StatusBadge status={i.status} label={itemStatus(t, i)} />} onPress={() => openItem(i)} />
            ))}
          </View>
        </>
      )}

      <View style={styles.tiles}>
        <QuickTile icon={PhoneCall} label={t('family.askCall')} tint={palette.rose500} onPress={() => router.push('/family/callback')} />
        <QuickTile icon={TriangleAlert} label={t('family.warningSigns')} tint={palette.amber} onPress={() => router.push('/family/signs')} />
      </View>

      {isCaregiver && (
        <AppText variant="caption" tone="secondary" align="center">
          {t('family.viewingAs', { name: accountName })}
        </AppText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { padding: space.md, gap: space.sm, minHeight: 120 },
  tileIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  note: { paddingHorizontal: space.lg, paddingVertical: space.md },
});
