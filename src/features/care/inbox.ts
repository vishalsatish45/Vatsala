import type { Href } from 'expo-router';

import { motherOf, taskState } from '@/data/selectors';
import type { DbState } from '@/data/store';

export type InboxItem = { id: string; at: Date; title: string; body: string; kind: 'callback' | 'referral' | 'result' | 'missed'; href: Href };

const DAY = 86_400_000;

/**
 * Care Team notifications (PRD F-04) — operational events only. Specialists see the referrals addressed to their
 * department(s): by team id (`teamIds`), or by the department's name when a referral has no team id.
 */
export function careInbox(db: DbState, now: Date, opts: { department?: string; specialist: boolean; teamIds?: readonly string[] }): InboxItem[] {
  const out: InboxItem[] = [];
  const recent = (d: Date) => now.getTime() - d.getTime() < 3 * DAY;
  const name = (pregnancyId: string) => {
    const p = db.pregnancies.find((x) => x.id === pregnancyId);
    return p ? motherOf(db, p.motherId).name : '';
  };

  for (const r of db.referrals) {
    if (opts.specialist && !(r.toTeamId ? !!opts.teamIds?.includes(r.toTeamId) : r.department === opts.department)) continue;
    for (const e of r.events) {
      if (!recent(e.at)) continue;
      out.push({ id: `${r.id}-${e.status}`, at: e.at, kind: 'referral', title: `${r.department} referral · ${e.status}`, body: `${name(r.pregnancyId)} · by ${e.by}`, href: { pathname: '/care/referral/[id]', params: { id: r.id } } });
    }
  }
  if (opts.specialist) return out.sort((a, b) => b.at.getTime() - a.at.getTime());

  for (const c of db.callbacks.filter((x) => !x.closedAt)) {
    out.push({ id: c.id, at: c.at, kind: 'callback', title: 'Call-back requested', body: `${motherOf(db, c.motherId).name}${c.signs.length ? ' · family reported a warning sign' : ''}`, href: { pathname: '/care/callback/[id]', params: { id: c.id } } });
  }
  for (const i of db.investigations.filter((x) => x.status === 'resulted' && x.result && recent(x.result.at))) {
    out.push({ id: i.id, at: i.result!.at, kind: 'result', title: `Result entered · ${i.label}`, body: `${name(i.subjectId)} · awaiting review`, href: { pathname: '/care/test/[id]', params: { id: i.id } } });
  }
  for (const t of db.tasks.filter((x) => !x.completedAt && !x.cancelledAt && x.subjectType === 'pregnancy')) {
    if (taskState(db, t, now) !== 'missed') continue;
    out.push({ id: t.id, at: t.dueBy, kind: 'missed', title: `Missed · ${t.title}`, body: name(t.subjectId), href: { pathname: '/care/task/[id]', params: { id: t.id } } });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export type ServerInboxItem = { id: string; at: Date; title: string; body: string; unread: boolean; href?: Href };

const REFERRAL_STEP: Record<string, string> = {
  accepted: 'accepted', scheduled: 'scheduled', seen: 'patient seen', recommendations: 'recommendations documented', closed: 'closed',
  declined: 'declined', cancelled: 'cancelled',
};

/** Server notification rows (Supabase mode) → inbox rows. Text is chosen here from the kind; tapping opens the target. */
export function serverInbox(db: DbState): ServerInboxItem[] {
  const pregnancyName = (id: string) => {
    const p = db.pregnancies.find((x) => x.id === id);
    return p ? (db.mothers.find((m) => m.id === p.motherId)?.name ?? '') : '';
  };
  return db.notifications.map((n): ServerInboxItem => {
    let title = 'Update';
    let body = '';
    let href: Href | undefined;
    const id = n.targetId;
    if (n.targetType === 'callback' && id) {
      const c = db.callbacks.find((x) => x.id === id);
      body = c ? (db.mothers.find((m) => m.id === c.motherId)?.name ?? '') : '';
      href = { pathname: '/care/callback/[id]', params: { id } };
    } else if (n.targetType === 'referral' && id) {
      const r = db.referrals.find((x) => x.id === id);
      body = r ? `${r.department} · ${pregnancyName(r.pregnancyId)}` : '';
      href = { pathname: '/care/referral/[id]', params: { id } };
    } else if (n.targetType === 'baby' && id) {
      const b = db.babies.find((x) => x.id === id);
      body = b ? `${b.childId} · baby of ${db.mothers.find((m) => m.id === b.motherId)?.name ?? ''}` : '';
      href = { pathname: '/care/b/[id]', params: { id } };
    } else if (n.targetType === 'pregnancy' && id) {
      body = pregnancyName(id);
      href = { pathname: '/care/p/[id]', params: { id } };
    } else if (n.targetType === 'investigation' && id) {
      href = { pathname: '/care/test/[id]', params: { id } };
    } else if (n.targetType === 'task' && id) {
      href = { pathname: '/care/task/[id]', params: { id } };
    }
    if (n.kind === 'callback_requested') title = 'Call-back requested';
    else if (n.kind === 'referral_requested') title = 'New referral to your department';
    else if (n.kind.startsWith('referral_')) title = `Referral ${REFERRAL_STEP[n.kind.slice('referral_'.length)] ?? 'updated'}`;
    else if (n.kind === 'baby_born') title = 'Baby born · now with your team';
    else if (n.kind === 'appointment_booked') title = 'Appointment booked';
    // A target this clinician can no longer open (episode closed, access ended) is listed without a link.
    const visible = !href || !id || [db.callbacks, db.referrals, db.babies, db.pregnancies, db.investigations, db.tasks].some((rows) => rows.some((x) => x.id === id));
    return { id: n.id, at: n.at, title, body, unread: !n.readAt, href: visible ? href : undefined };
  });
}
