import type { TFunction } from 'i18next';

import { continuityEvents, type TimelineEvent } from '@/data/selectors';
import type { DbState } from '@/data/store';
import type { TLEvent } from '@/ui';

import type { FamilyContext } from './useFamily';

function title(t: TFunction, e: TimelineEvent, livingBaby: boolean) {
  switch (e.kind) {
    case 'registered':
      return t('family.journey.registered');
    case 'visit':
      return t('family.journey.visit');
    case 'planned_visit':
      return t('family.task.anc');
    case 'delivery':
      // "Your baby was born" only with a living baby; otherwise a neutral word (stillbirth, a baby who has died).
      return livingBaby ? t('family.journey.delivery') : t('family.journey.deliveryNeutral');
    case 'pn_visit':
      return t('family.task.pn');
    case 'nb_visit':
      return t('family.task.nb');
    default:
      return e.label;
  }
}

/** Family version of the continuity timeline: plain words, no clinician-only items, scopes respected. */
export function familyTimeline(db: DbState, ctx: FamilyContext, now: Date, t: TFunction): TLEvent[] {
  if (!ctx.pregnancy) return [];
  const living = new Set<string>(ctx.babies.map((b) => b.id));
  // Baby-lane items only for a living baby the family may see (the selector lists every baby of the episode).
  const babyOf = (id: string) => db.immunizations.find((i) => i.id === id)?.babyId ?? db.tasks.find((x) => x.id === id)?.subjectId;
  return continuityEvents(db, ctx.pregnancy.id, now, 'family')
    .filter((e) => (e.lane === 'baby' ? ctx.scopes.baby && living.has(babyOf(e.id) ?? '') : ctx.scopes.schedule || e.kind === 'delivery'))
    .map((e) => ({
      id: e.id,
      at: e.at,
      lane: e.lane,
      state: e.state,
      title: title(t, e, ctx.stage === 'baby'),
      anc: e.kind === 'visit' || e.kind === 'planned_visit',
      sub: e.kind === 'visit' ? e.sub : e.kind === 'vaccine' ? e.sub : e.state === 'planned' ? t('family.journey.planned') : e.state === 'missed' ? t('family.status.missed') : undefined,
    }));
}
