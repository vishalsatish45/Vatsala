import type { Href } from 'expo-router';

import { motherOf, taskState } from '@/data/selectors';
import type { DbState } from '@/data/store';

export type InboxItem = { id: string; at: Date; title: string; body: string; kind: 'callback' | 'referral' | 'result' | 'missed'; href: Href };

const DAY = 86_400_000;

/** Care Team notifications (PRD F-04) — operational events only. Specialists see their department's referrals. */
export function careInbox(db: DbState, now: Date, opts: { department?: string; specialist: boolean }): InboxItem[] {
  const out: InboxItem[] = [];
  const recent = (d: Date) => now.getTime() - d.getTime() < 3 * DAY;
  const name = (pregnancyId: string) => {
    const p = db.pregnancies.find((x) => x.id === pregnancyId);
    return p ? motherOf(db, p.motherId).name : '';
  };

  for (const r of db.referrals) {
    if (opts.specialist && r.department !== opts.department) continue;
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
