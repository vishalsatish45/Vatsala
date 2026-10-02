/**
 * The family's view of her tests (FH-22): which tests she (or a caregiver with the `tests` scope) may see, and the
 * operational status word for each. Status only — a result value is shown as documented, never judged.
 */
import { localDay } from '@domain/gestation';

import type { CaregiverScopes, Investigation, Pregnancy } from '@/data/types';
import type { TaskStatus } from '@/ui/tokens';

export const TEST_KEYS = ['ogtt', 'hb1', 'hb2', 'hb3', 'anomaly', 'dating', 'bg', 'urine', 'rbs', 'tsh', 'ict'];

type Who = { pregnancy?: Pick<Pregnancy, 'id'>; scopes: Pick<CaregiverScopes, 'tests'> };

/** Her pregnancy's tests, never a sensitive one, and only with the `tests` scope. The Journey list and the detail screen share it. */
export function familyTests(investigations: Investigation[], who: Who): Investigation[] {
  const p = who.pregnancy;
  if (!p || !who.scopes.tests) return [];
  return investigations.filter((i) => i.subjectId === p.id && !i.sensitive);
}

/**
 * Badge status + i18n label key. A test marked not done has its own word; "result ready — discuss" is the mother's
 * prompt only (a caregiver sees a finished test as done).
 */
export function familyTestStatus(i: Pick<Investigation, 'status' | 'dueFrom'>, now: Date, isCaregiver: boolean): { status: TaskStatus; labelKey: string } {
  switch (i.status) {
    case 'not_done':
      return { status: 'upcoming', labelKey: 'family.status.notDone' };
    case 'reviewed':
      return { status: 'done', labelKey: 'family.status.done' };
    case 'resulted':
      return isCaregiver ? { status: 'done', labelKey: 'family.status.done' } : { status: 'due', labelKey: 'family.status.discuss' };
    default:
      return localDay(now).getTime() < i.dueFrom.getTime() ? { status: 'upcoming', labelKey: 'family.status.upcoming' } : { status: 'due', labelKey: 'family.status.due' };
  }
}
