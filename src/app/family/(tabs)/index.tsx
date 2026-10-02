import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Bell, Pill } from 'lucide-react-native';
import { daysBetween, gestationalAge, toDateOnly, trimester } from '@domain/gestation';

import { medSlots } from '@/data/catalogue';
import { useDb } from '@/data/store';
import { MedicinesView } from '@/features/family/MedicinesView';
import { familyItems, useFamily, type FamilyItem } from '@/features/family/useFamily';
import { fmtShort, itemTitle, itemWhen } from '@/features/family/itemText';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { useNow } from '@/lib/clock';
import {
  AppText,
  Avatar,
  Chip,
  DropdownSection,
  GlassIconButton,
  GlassSurface,
  HeroNumber,
  NextStepCard,
  Screen,
  StatTile,
  TopBar,
  palette,
  space,
} from '@/ui';

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
  const weekNow = p ? gestationalAge(p.edd, now).weeks : undefined;
  // What the speaker button on Home says: where she is in the pregnancy, then the next step.
  const readAloud = [
    weekNow !== undefined && !delivered ? `${t('family.pregnancyWeek')}: ${weekNow}` : '',
    next ? `${t('family.nextStep')}: ${itemTitle(t, next)}, ${itemWhen(t, next, lang)}${next.place ? `, ${next.place}` : ''}` : t('family.noUpcoming'),
  ]
    .filter(Boolean)
    .join('. ');

  const header = (
    <TopBar
      left={<Avatar name={accountName || '?'} onPress={() => router.push('/family/profile')} />}
      right={
        <>
          <ReadAloudButton text={readAloud} />
          <GlassIconButton icon={Bell} accessibilityLabel="Notifications" badge={items.filter((i) => i.status === 'missed' || i.status === 'due').length} onPress={() => router.push('/family/notifications')} />
        </>
      }
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
  const doctorName = p.assignedDoctor?.name;
  const doctorLabel = doctorName ?? t('family.noDoctor');
  const nextMother = items.find((i) => i.subject === 'mother');
  const nextBaby = items.find((i) => i.subject === 'baby');
  // All baby items due on the same day as the next baby visit — one visit, one card.
  const babyDay = nextBaby ? items.filter((i) => i.subject === 'baby' && daysBetween(i.date, nextBaby.date) === 0) : [];
  const babyCard = nextBaby && (
    <NextStepCard
      key={babyDay.map((i) => i.id).join('+')}
      bigFirstLine
      eyebrow={nextBaby.status === 'missed' ? t('family.missedUs') : t('family.forBaby')}
      title={babyDay.length > 1 ? `${itemTitle(t, nextBaby)} +${babyDay.length - 1} more` : itemTitle(t, nextBaby)}
      lines={[
        itemWhen(t, nextBaby, lang),
        [...new Set(babyDay.map((x) => x.place ?? '').filter(Boolean))].join(' · '),
        ...[...new Set(babyDay.flatMap((x) => [...x.bring.map((b) => t(b)), ...x.prep.map((x) => t(x))]))],
      ].filter(Boolean)}
      actionLabel={t('family.seeDetails')}
      onAction={() => router.push({ pathname: '/family/day/[ids]' as any, params: { ids: babyDay.map((i) => i.id).join(',') } })}
    />
  );
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
  const meds = p.history.medicines ?? [];
  const todayIso = toDateOnly(now).toISOString().slice(0, 10);
  const totalSlots = meds.flatMap((m) => medSlots(m).slots).length;
  const takenSlots = meds.flatMap((m) =>
    medSlots(m).slots.filter((s) => {
      const d = db.medDoses.find((dose) => dose.motherId === mother.id && dose.med === m && dose.date === todayIso && dose.slot === s);
      return d?.status === 'taken';
    }),
  ).length;

  const medsSubtitle =
    totalSlots === 0
      ? "Today's schedule & tracking"
      : takenSlots === totalSlots
        ? 'All doses taken today ✓'
        : `${takenSlots}/${totalSlots} taken today`;

  const medsBadge =
    totalSlots > 0 ? (
      <Chip label={takenSlots === totalSlots ? 'Done' : `${totalSlots - takenSlots} due`} variant="soft" />
    ) : undefined;

  const medicinesDropdown = (
    <DropdownSection
      title={t('family.meds.title')}
      subtitle={medsSubtitle}
      icon={Pill}
      iconColor={palette.lav600}
      iconBg={palette.lav100}
      badge={medsBadge}
    >
      <MedicinesView />
    </DropdownSection>
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
          chips={[baby.sex === 'F' ? 'Girl' : 'Boy', `${(baby.birthWeightG / 1000).toFixed(2)} kg`, fmtShort(baby.dob, lang)]}
        />
      ) : (
        <>
          <HeroNumber
            caption={isCaregiver ? `${mother.name} · ${t('family.pregnancyWeek')}` : t('family.pregnancyWeek')}
            value={String(ga.weeks)}
            suffix={` weeks`}
            subtitle={t('family.weeksDays', { w: ga.weeks, d: ga.days })}
            chips={[t('family.trimester', { n: trimester(ga) }), `🩺 ${doctorLabel}`]}
          />
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
          {medicinesDropdown}
          {babyCard}
        </>
      ) : (
        <>
          {medicinesDropdown}
          {nextCard ?? (
            <GlassSurface strong style={{ padding: space.lg }}>
              <AppText tone="secondary">{t('family.noUpcoming')}</AppText>
            </GlassSurface>
          )}
        </>
      )}

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
  note: { paddingHorizontal: space.md, paddingVertical: space.sm },
});
