import type { TFunction } from 'i18next';

import { continuityEvents, type TimelineEvent } from '@/data/selectors';
import type { DbState } from '@/data/store';
import type { TLEvent } from '@/ui';

import type { FamilyContext } from './useFamily';

function title(t: TFunction, e: TimelineEvent) {
  switch (e.kind) {
    case 'registered':
      return t('family.journey.registered');
    case 'visit':
      return t('family.journey.visit');
    case 'planned_visit':
      return t('family.task.anc');
    case 'delivery':
      return t('family.journey.delivery');
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
  return continuityEvents(db, ctx.pregnancy.id, now, 'family')
    .filter((e) => (e.lane === 'baby' ? ctx.scopes.baby : ctx.scopes.schedule || e.kind === 'delivery'))
    .map((e) => ({
      id: e.id,
      at: e.at,
      lane: e.lane,
      state: e.state,
      title: title(t, e),
      anc: e.kind === 'visit' || e.kind === 'planned_visit',
      sub: e.kind === 'visit' ? e.sub : e.kind === 'vaccine' ? e.sub : e.state === 'planned' ? t('family.journey.planned') : e.state === 'missed' ? t('family.status.missed') : undefined,
    }));
}
