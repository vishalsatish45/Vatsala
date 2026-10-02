/**
 * What the signed-in clinician may do — the server's rules, mirrored so the app never offers a button the server
 * refuses (and the typed work is lost). The server stays the authority: every RPC re-checks all of this.
 *
 *  - app.require_writer (supabase/migrations/20261005000300_rpc_care.sql): a pregnancy's record is written by an
 *    obstetrician, a baby's by a paediatrician (visits, tags, intensity, tests, referrals, prescriptions, captures,
 *    AI drafts via ai_quota, entered-in-error of the subject's rows).
 *  - mark_entered_in_error (…0990): the mother's documented history (conditions, allergies, previous pregnancies)
 *    and her own home readings are the obstetric team's; a baby's readings and doses the paediatric team's.
 *  - advance_referral: the receiving department's members accept / decline / schedule / see / answer; the referring
 *    team (obstetrician for a pregnancy, paediatrician for a baby, with care access beyond the referral) closes or
 *    cancels.
 */
import type { DbState } from '@/data/store';
import type { Referral, ReferralStatus, SubjectId } from '@/data/types';

import type { CareMe } from './CareTeam';

export type SubjectKind = 'pregnancy' | 'baby';

/** app.require_writer: the specialty that writes this kind of record. */
export const canWriteSubject = (me: Pick<CareMe, 'role'>, kind: SubjectKind) => me.role === (kind === 'baby' ? 'paediatrician' : 'obstetrician');

/** The self-log's owner team: a baby's reading → paediatrician; the mother's → obstetrician (mark_entered_in_error). */
export const canCorrectSelfLog = (me: Pick<CareMe, 'role'>, subject: 'mother' | 'baby') => canWriteSubject(me, subject === 'baby' ? 'baby' : 'pregnancy');

/**
 * Care access to a referral's subject that does not come from the referral itself (the server's `referring` test):
 * an assignment held by her or her team, the labour room (an open admission), or her emergency override.
 */
function hasCareAccess(db: Pick<DbState, 'assignments' | 'pregnancies' | 'overrides' | 'babies'>, me: CareMe, r: Pick<Referral, 'pregnancyId' | 'babyId'>): boolean {
  const subjects = new Set<SubjectId>([r.pregnancyId, ...(r.babyId ? [r.babyId] : [])]);
  const p = db.pregnancies.find((x) => x.id === r.pregnancyId);
  return (
    db.assignments.some((a) => subjects.has(a.subjectId) && ((!!me.staffId && a.staffId === me.staffId) || me.teamIds.includes(a.teamId))) ||
    p?.status === 'admitted' ||
    (!!p && db.overrides.some((o) => o.motherId === p.motherId && (!o.staffId || o.staffId === me.staffId)))
  );
}

export type ReferralSide = { receiving: boolean; referring: boolean };

/**
 * Which side of a referral the clinician is on. Receiving: a member of the department it is addressed to.
 * Referring: the subject's specialty (obstetrician / paediatrician) seeing the record through care, not through the
 * referral — a clinician who can see a referral without being on its receiving side has care access by definition.
 */
export function referralSide(db: Pick<DbState, 'assignments' | 'pregnancies' | 'overrides' | 'babies'>, me: CareMe, r: Pick<Referral, 'pregnancyId' | 'babyId' | 'toTeamId'>): ReferralSide {
  const receiving = !!r.toTeamId && me.teamIds.includes(r.toTeamId);
  const referring = canWriteSubject(me, r.babyId ? 'baby' : 'pregnancy') && (!receiving || hasCareAccess(db, me, r));
  return { receiving, referring };
}

/** The moves advance_referral allows this side from the referral's status, in the order the screen offers them. */
export function referralMoves(status: ReferralStatus, side: ReferralSide): ReferralStatus[] {
  const out: ReferralStatus[] = [];
  if (side.receiving) {
    if (status === 'requested') out.push('accepted', 'declined');
    if (status === 'accepted') out.push('scheduled');
    if (status === 'scheduled') out.push('seen', 'scheduled');
    if (status === 'seen') out.push('recommendations');
  }
  if (side.referring) {
    if (status === 'recommendations') out.push('closed');
    if (status === 'requested' || status === 'accepted' || status === 'scheduled') out.push('cancelled');
  }
  return out;
}

/** Worklist rows for this clinician: her specialty's items, and referral items only on the side whose move it is. */
export function onMyWorklist(
  item: { audience: 'ob' | 'paed' | 'both'; referral?: { side: 'receiving' | 'referring' | 'either'; toTeamId?: string; baby: boolean } },
  me: CareMe,
): boolean {
  if (item.referral) {
    const receiving = !!item.referral.toTeamId && me.teamIds.includes(item.referral.toTeamId);
    const referring = canWriteSubject(me, item.referral.baby ? 'baby' : 'pregnancy') && !receiving;
    if (item.referral.side === 'receiving') return receiving;
    if (item.referral.side === 'referring') return referring;
    return receiving || referring;
  }
  if (me.role === 'specialist') return false;
  return item.audience === 'both' || item.audience === (me.role === 'paediatrician' ? 'paed' : 'ob');
}
