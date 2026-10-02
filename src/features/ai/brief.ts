/**
 * Consultation brief (PRD F-27). UI-first phase: generated on-device, deterministically,
 * from DOCUMENTED facts only — the same output contract the LLM gateway will return:
 * sentences, each citing source records. No interpretation, no clinical adjectives,
 * no recommendations. Shown as "AI draft · unverified" until a clinician verifies it.
 */
import { formatGA, gestationalAge } from '@domain/gestation';

import { tagLabel } from '@/data/catalogue';
import { activeTags, fmtDate, fmtDay, nextVisit, stillDue } from '@/data/selectors';
import type { DbState } from '@/data/store';

export type Source = { label: string; kind: 'visit' | 'test' | 'referral' | 'tag' | 'callback' | 'selflog' | 'task' | 'registration'; id: string };
export type BriefSentence = { text: string; sources: Source[] };
export type Brief = { sentences: BriefSentence[]; generatedAt: Date; engine: 'on-device demo' | 'llm' };

/** Words the brief must never contain unless quoting a clinician's note (PRD F-27). */
export const BANNED = /\b(abnormal|normal|high|low|concerning|risk|dangerous|severe|mild|elevated|critical)\b/i;

export function buildBrief(db: DbState, pregnancyId: string, now: Date): Brief {
  const p = db.pregnancies.find((x) => x.id === pregnancyId)!;
  const visits = db.visits.filter((v) => v.pregnancyId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime());
  const last = visits[0];
  const s: BriefSentence[] = [];

  s.push({
    text: p.edd
      ? `${p.status === 'delivered' ? 'Delivered' : `${formatGA(gestationalAge(p.edd, now))} weeks`}. G${p.gpla.g}P${p.gpla.p}L${p.gpla.l}A${p.gpla.a}. EDD ${fmtDay(p.edd)} (${(p.eddSource ?? 'lmp').toUpperCase()}).`
      : `${p.status === 'delivered' ? 'Delivered' : 'Dating not recorded'}. G${p.gpla.g}P${p.gpla.p}L${p.gpla.l}A${p.gpla.a}.`,
    sources: [{ label: 'Registration', kind: 'registration', id: p.id }],
  });

  const tags = activeTags(db, p.id);
  if (tags.length) {
    s.push({
      text: `Tags: ${tags.map((t) => `${tagLabel(t.code)} (set ${fmtDate(t.setAt)} by ${t.setBy})`).join('; ')}. Follow-up intensity: ${p.intensity}.`,
      sources: tags.map((t) => ({ label: tagLabel(t.code), kind: 'tag' as const, id: t.id })),
    });
  }

  if (p.previous.length) s.push({ text: `Previous (as documented): ${p.previous.map((x) => `${x.year} "${x.mode ?? x.outcome}"`).join(', ')}.`, sources: [{ label: 'History', kind: 'registration', id: p.id }] });

  if (last) {
    const v = last.vitals;
    const parts = [v.bpSys && `BP ${v.bpSys}/${v.bpDia}`, v.weightKg && `weight ${v.weightKg} kg`, v.fundalHeightCm && `fundal height ${v.fundalHeightCm} cm`, v.fhr && `FHR ${v.fhr}`].filter(Boolean);
    s.push({ text: `Last visit ${fmtDate(last.at)}: ${parts.join(', ') || 'no vitals recorded'} (as documented).${last.complaints.length ? ` Reported: ${last.complaints.join(', ')}.` : ''}`, sources: [{ label: `Visit ${fmtDate(last.at)}`, kind: 'visit', id: last.id }] });
  }

  const since = last?.at ?? p.registeredOn;
  const results = db.investigations.filter((i) => i.subjectId === p.id && i.result && i.result.at > since);
  if (results.length) s.push({ text: `Since last visit, results entered: ${results.map((i) => `${i.label} ${i.result!.value}`).join('; ')}.`, sources: results.map((i) => ({ label: i.label, kind: 'test' as const, id: i.id })) });

  for (const r of db.referrals.filter((x) => x.pregnancyId === p.id)) {
    const lastEv = r.events[r.events.length - 1]!;
    s.push({
      text: `${r.department} referral (${fmtDate(r.events[0]!.at)}): ${r.status}${r.recommendations ? ` — "${r.recommendations}"` : ''}.`,
      sources: [{ label: `${r.department} · ${fmtDate(lastEv.at)}`, kind: 'referral', id: r.id }],
    });
  }

  const logs = db.selfLogs.filter((l) => l.motherId === p.motherId && l.at > since);
  if (logs.length) s.push({ text: `Family-reported since last visit: ${logs.map((l) => `${l.kind.toUpperCase()} ${l.value} (${fmtDate(l.at)})`).join(', ')}.`, sources: logs.map((l) => ({ label: `Home ${l.kind}`, kind: 'selflog' as const, id: l.id })) });

  const cbs = db.callbacks.filter((c) => c.motherId === p.motherId && c.at > since);
  if (cbs.length) s.push({ text: `Call-backs: ${cbs.map((c) => `${fmtDate(c.at)}${c.signs.length ? ` (family ticked: ${c.signs.join(', ')})` : ''}${c.outcome ? ` — ${c.outcome}` : ' — open'}`).join('; ')}.`, sources: cbs.map((c) => ({ label: `Call-back ${fmtDate(c.at)}`, kind: 'callback' as const, id: c.id })) });

  const due = stillDue(db, p, now);
  if (due.length) s.push({ text: `Still due: ${due.map((d) => `${d.label} (${d.detail})`).join('; ')}.`, sources: due.map((d) => ({ label: d.label, kind: d.kind === 'referral' ? ('referral' as const) : d.kind === 'visit' ? ('task' as const) : ('test' as const), id: d.refId })) });

  const nv = nextVisit(db, p.id, now);
  if (nv) s.push({ text: `Next scheduled: ${nv.title} on ${fmtDay(nv.dueBy)}.`, sources: [{ label: nv.title, kind: 'task', id: nv.id }] });

  // Contract enforcement: drop anything without sources or with interpretive language outside quotes.
  const clean = s.filter((x) => x.sources.length > 0 && !BANNED.test(x.text.replace(/"[^"]*"/g, '')));
  return { sentences: clean, generatedAt: now, engine: 'on-device demo' };
}
