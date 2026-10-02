import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Bell, Pill, Salad } from 'lucide-react-native';
import { daysBetween, gestationalAge, localDay, trimester } from '@domain/gestation';

import { useDb } from '@/data/store';
import { FocusSwitch, useFamilyFocus } from '@/features/family/FocusSwitch';
import { MedicinesView, dosesToday, familyMeds } from '@/features/family/MedicinesView';
import { cancelReminders } from '@/features/family/reminders';
import { familyNotificationRows } from '@/features/family/serverNotifications';
import { localDaysBetween } from '@/features/family/stage';
import { familyItems, homeNextItems, useFamily, type FamilyItem } from '@/features/family/useFamily';
import { fmtShort, itemPlace, itemTitle, itemWhen } from '@/features/family/itemText';
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
  LinkCard,
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
  const { mother, pregnancy: p, babies, isCaregiver, accountName, stage } = ctx;
  const { focus } = useFamilyFocus();
  const items = familyItems(db, ctx, now);
  // Today by the phone's calendar (the UTC day is a day behind between 00:00 and 05:30 IST).
  const today = localDay(now);
  // A living baby this account may see — also after the hospital closes the delivered episode (stage.ts).
  const delivered = stage === 'baby';
  // No living baby after a birth, or a pregnancy that ended without one: no week counter, no cheerful content.
  const loss = stage === 'loss';
  // A birth, but the mother has not shared the baby with this caregiver: nothing assumed either way.
  const notShared = stage === 'notShared';
  // After delivery Home follows the Me / Baby switch; before it, everything is the mother's.
  const focusItems = delivered ? items.filter((i) => i.subject === focus) : items;
  const next = focusItems[0];
  const baby = babies[0];
  const weekNow = p?.edd && stage === 'pregnant' ? gestationalAge(p.edd, today).weeks : undefined;
  const babyAge = baby && delivered ? age(localDaysBetween(baby.dob, now)) : undefined;

  // After a loss, visit reminders set earlier on this phone are cancelled (her own check-ups stay on Home).
  useEffect(() => {
    if (loss) void cancelReminders('visits');
  }, [loss]);
  // What the speaker button on Home says: where she (or the baby) is, then the next step.
  const readAloud = [
    weekNow !== undefined
      ? `${t('family.pregnancyWeek')}: ${weekNow}`
      : babyAge
        ? focus === 'baby'
          ? `${t('family.babyAge')}: ${babyAge.value} ${t(babyAge.suffixKey)}`
          : `${t('family.sinceBirth')}: ${babyAge.value} ${t(babyAge.unitKey)}`
        : '',
    next ? `${t('family.nextStep')}: ${itemTitle(t, next)}, ${itemWhen(t, next, lang)}${itemPlace(t, next) ? `, ${itemPlace(t, next)}` : ''}` : t('family.noUpcoming'),
  ]
    .filter(Boolean)
    .join('. ');

  const header = (
    <TopBar
      below={<FocusSwitch />}
      left={<Avatar name={accountName || '?'} onPress={() => router.push('/family/profile')} />}
      right={
        <>
          <ReadAloudButton text={readAloud} />
          <GlassIconButton icon={Bell} accessibilityLabel={t('family.notif.title')} badge={items.filter((i) => i.status === 'missed' || i.status === 'due').length + familyNotificationRows(db.notifications, babies).filter((n) => n.unread).length} onPress={() => router.push('/family/notifications')} />
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

  // Undated until her first check-up: no week counter or due date yet.
  const ga = p.edd ? gestationalAge(p.edd, today) : undefined;
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
      title={babyDay.length > 1 ? `${itemTitle(t, nextBaby)} ${t('family.more', { n: babyDay.length - 1 })}` : itemTitle(t, nextBaby)}
      lines={[
        itemWhen(t, nextBaby, lang),
        [...new Set(babyDay.map((x) => itemPlace(t, x)).filter(Boolean))].join(' · '),
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
      bigFirstLine
      lines={[itemWhen(t, i, lang), itemPlace(t, i), ...i.bring.map((b) => t(b)), ...i.prep.map((x) => t(x))].filter(Boolean)}
      actionLabel={t('family.seeDetails')}
      onAction={() => openItem(i)}
    />
  );
  // The same prescriptions (and times of day) as the medicines screen, so the two never disagree.
  const { taken: takenSlots, total: totalSlots } = dosesToday(db, mother.id, familyMeds(db, ctx), now);

  const medsSubtitle =
    totalSlots === 0 ? t('family.meds.subEmpty') : takenSlots === totalSlots ? t('family.meds.subAll') : t('family.meds.subCount', { taken: takenSlots, total: totalSlots });

  const medsBadge =
    totalSlots > 0 ? (
      <Chip label={takenSlots === totalSlots ? t('family.status.done') : t('family.meds.chipDue', { n: totalSlots - takenSlots })} variant="soft" />
    ) : undefined;

  // A caregiver sees her medicines only with the readings scope (as `family_medicines`).
  const medicinesDropdown = ctx.scopes.logs && (
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

  // Diet, exercise and the Learn library (no scope needed: general education, nothing from her record).
  const wellbeingCard = (
    <LinkCard
      title={t('family.wellbeing.title')}
      subtitle={t('family.wellbeing.sub')}
      icon={Salad}
      iconColor={palette.amber}
      iconBg={palette.beige}
      onPress={() => router.push('/family/wellbeing')}
    />
  );

  // Before the birth: the next step, and her next test and next ANC visit as cards of their own (earliest first).
  const nextCards = homeNextItems(focusItems).map((i) => (
    <NextStepCard
      key={i.id}
      eyebrow={i.status === 'missed' ? t('family.missedUs') : i === next ? t('family.nextStep') : i.kind === 'test' ? t('family.nextTest') : t('family.nextVisit')}
      title={itemTitle(t, i)}
      bigFirstLine
      lines={[itemWhen(t, i, lang), itemPlace(t, i), ...i.bring.map((b) => t(b)), ...i.prep.map((x) => t(x))].filter(Boolean)}
      actionLabel={t('family.seeDetails')}
      onAction={() => openItem(i)}
    />
  ));

  return (
    <Screen withNav blobCenterY={200} header={header}>
      {loss ? (
        <GlassSurface strong style={{ padding: space.lg, gap: space.sm, marginTop: space.xl }}>
          <AppText variant="display">{t('family.loss.title')}</AppText>
          <AppText tone="secondary">{t('family.loss.body')}</AppText>
          <AppText variant="bodyMedium" tone="accent">
            {t('family.loss.support')}
            {db.hospital?.phoneOpd ? ` · ${db.hospital.phoneOpd}` : ''}
          </AppText>
        </GlassSurface>
      ) : notShared ? (
        <GlassSurface strong style={{ padding: space.lg, gap: space.sm, marginTop: space.xl }}>
          <AppText variant="title">{t('family.notShared.title')}</AppText>
          <AppText tone="secondary">{t('family.me.limited', { name: mother.name })}</AppText>
        </GlassSurface>
      ) : delivered && baby && babyAge && focus === 'baby' ? (
        <HeroNumber
          caption={isCaregiver ? `${mother.name} · ${t('family.babyAge')}` : t('family.babyAge')}
          value={String(babyAge.value)}
          suffix={` ${t(babyAge.suffixKey)}`}
          chips={[baby.sex === 'F' ? t('family.baby.girl') : baby.sex === 'M' ? t('family.baby.boy') : t('family.baby.undetermined'), ...(baby.birthWeightG != null ? [`${(baby.birthWeightG / 1000).toFixed(2)} kg`] : []), fmtShort(baby.dob, lang)]}
        />
      ) : delivered && baby && babyAge ? (
        <HeroNumber
          caption={isCaregiver ? `${mother.name} · ${t('family.sinceBirth')}` : t('family.sinceBirth')}
          value={String(babyAge.value)}
          suffix={` ${t(babyAge.unitKey)}`}
          chips={[fmtShort(baby.dob, lang), `🩺 ${doctorLabel}`]}
        />
      ) : !ga || !p.edd ? (
        <GlassSurface strong style={{ padding: space.lg, gap: space.sm, marginTop: space.xl }}>
          <AppText variant="title">{t('family.dueDateLater')}</AppText>
          <AppText tone="secondary">🩺 {doctorLabel}</AppText>
        </GlassSurface>
      ) : (
        <>
          <HeroNumber
            caption={isCaregiver ? `${mother.name} · ${t('family.pregnancyWeek')}` : t('family.pregnancyWeek')}
            value={String(ga.weeks)}
            suffix={` ${t('family.weeksUnit')}`}
            subtitle={t('family.weeksDays', { w: ga.weeks, d: ga.days })}
            chips={[t('family.trimester', { n: trimester(ga) }), `🩺 ${doctorLabel}`]}
          />
          <View style={styles.tiles}>
            <StatTile label={t('family.weeksToGo')} value={String(Math.max(0, Math.ceil(daysBetween(today, p.edd) / 7)))} unit={t('family.wks')} />
            <StatTile label={t('family.dueDate')} value={String(p.edd.getUTCDate())} unit={p.edd.toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { month: 'short', timeZone: 'UTC' })} />
          </View>
        </>
      )}

      {p.intensity !== 'routine' && stage === 'pregnant' && (
        <GlassSurface strong radius={20} style={styles.note}>
          <AppText variant="bodyMedium">{t('family.seeMoreOften')}</AppText>
        </GlassSurface>
      )}

      {delivered ? (
        focus === 'baby' ? (
          babyCard ?? (
            <GlassSurface strong style={{ padding: space.lg }}>
              <AppText tone="secondary">{t('family.noUpcoming')}</AppText>
            </GlassSurface>
          )
        ) : (
          <>
            {nextMother && card(nextMother, isCaregiver ? t('family.forMother') : t('family.forYou'))}
            {medicinesDropdown}
            {wellbeingCard}
          </>
        )
      ) : (
        <>
          {medicinesDropdown}
          {wellbeingCard}
          {nextCards.length ? (
            nextCards
          ) : (
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

/** Under two weeks in days, then whole weeks — same rule for the baby's age and time since delivery. */
function age(days: number) {
  if (days < 14) return { value: days, suffixKey: days === 1 ? 'family.dayOld' : 'family.daysOld', unitKey: days === 1 ? 'family.day' : 'family.days' };
  return { value: Math.floor(days / 7), suffixKey: 'family.weeksOld', unitKey: 'family.weeksUnit' };
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.sm },
  note: { paddingHorizontal: space.md, paddingVertical: space.sm },
});
