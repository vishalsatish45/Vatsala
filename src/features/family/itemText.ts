import type { TFunction } from 'i18next';

import { localeFor } from '@/lib/i18n';

import type { FamilyItem } from './useFamily';

export const itemTitle = (t: TFunction, i: FamilyItem) => t(i.titleKey, i.titleParams);

export function itemStatus(t: TFunction, i: FamilyItem) {
  return t(`family.status.${i.status}`);
}

export const fmtDay = (d: Date, lang: string) => d.toLocaleDateString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = (d: Date, lang: string) => d.toLocaleTimeString(localeFor(lang), { hour: 'numeric', minute: '2-digit' });
export const fmtShort = (d: Date, lang: string) => d.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short' });
export const fmtWeekday = (d: Date, lang: string) => d.toLocaleDateString(localeFor(lang), { weekday: 'long' });

/** English ordinal suffix; other languages show the bare number. */
export function ordinalSuffix(n: number, lang: string): string {
  if (!lang.startsWith('en')) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0]!;
}

/** Line under a schedule item: date (+ time for visits) or the test window. */
export function itemWhen(t: TFunction, i: FamilyItem, lang: string) {
  if (i.kind === 'test' && i.dueBy) return t('family.before', { date: fmtShort(i.dueBy, lang) });
  return i.kind === 'visit' ? `${fmtDay(i.date, lang)} · ${fmtTime(i.date, lang)}` : fmtDay(i.date, lang);
}
