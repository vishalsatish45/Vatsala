import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Baby, Camera, ClipboardPlus, FolderOpen, GitPullRequestArrow, HeartPulse, Pill, Ruler, Scale, Send, Tags } from 'lucide-react-native';
import { gestationalAge } from '@domain/gestation';

import { tagLabel } from '@/data/catalogue';
import { activeTags, ago, continuityEvents, fmtDate, fmtDay, fmtTime, invState, motherOf, nextVisit, patientIds, stillDue, type DueItem } from '@/data/selectors';
import { useDb } from '@/data/store';
import { REFERRAL_STEPS } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import {
  AncBadge,
  AppText,
  Button,
  Card,
  Chip,
  ChecklistRow,
  ContinuityTimeline,
  Field,
  GlassSurface,
  PressableScale,
  InfoRow,
  IntensityPill,
  ListRow,
  Screen,
  Section,
  StatTile,
  StatusBadge,
  SyncBadge,
  TopBar,
  UnderlineTabs,
  palette,
  space,
} from '@/ui';

type Tab = 'overview' | 'timeline' | 'tests' | 'referrals' | 'visits' | 'notes';

function dueAction(d: DueItem) {
  switch (d.kind) {
    case 'investigation':
    case 'result':
      return () => router.push({ pathname: '/care/test/[id]', params: { id: d.refId } });
    case 'referral':
      return () => router.push({ pathname: '/care/referral/[id]', params: { id: d.refId } });
    default:
      return () => router.push({ pathname: '/care/task/[id]', params: { id: d.refId } });
  }
}

/** CT-20 Consultation-ready patient view (PRD F-12): "still due" before "what happened". */
export default function PatientView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('overview');
  const [draft, setDraft] = useState('');
  const [doctorDraft, setDoctorDraft] = useState('');
  const by = useActor();

  const p = db.pregnancies.find((x) => x.id === id);
  const logAccess = useDb((s) => s.logAccess);
  useEffect(() => {
    if (id) logAccess(id, by, new Date());
  }, [id, by, logAccess]);
  if (!p) return <Screen header={<TopBar back title="Patient" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, p.motherId);
  const ga = gestationalAge(p.edd, now);
  const tags = activeTags(db, p.id);
  const due = stillDue(db, p, now);
  const visits = db.visits.filter((v) => v.pregnancyId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime());
  const last = visits[0];
  const invs = db.investigations.filter((i) => i.subjectId === p.id);
  const refs = db.referrals.filter((r) => r.pregnancyId === p.id);
  const logs = db.selfLogs.filter((l) => l.motherId === m.id).sort((a, b) => b.at.getTime() - a.at.getTime());
  const cbs = db.callbacks.filter((c) => c.motherId === m.id);
  const nv = nextVisit(db, p.id, now);
  const babies = db.babies.filter((b) => b.pregnancyId === p.id);
  const delivered = p.status === 'delivered';
  const since = last?.at ?? p.registeredOn;
  const notes = db.notes.filter((n) => n.subjectId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime());
  const doses = db.medDoses.filter((d) => d.motherId === m.id && now.getTime() - d.at.getTime() < 8 * 86_400_000);

  const sinceEvents = [
    ...invs.filter((i) => i.result && i.result.at > since).map((i) => ({ at: i.result!.at, text: `${i.label}: result entered` })),
    ...refs.flatMap((r) => r.events.filter((e) => e.at > since).map((e) => ({ at: e.at, text: `${r.department} referral: ${e.status}` }))),
    ...logs.filter((l) => l.at > since).map((l) => ({ at: l.at, text: `Home reading (family-reported): ${l.kind.toUpperCase()} ${l.value}` })),
    ...cbs.filter((c) => c.at > since).map((c) => ({ at: c.at, text: `Call-back ${c.closedAt ? `closed: ${c.outcome}` : 'requested'}${c.signs.length ? ` · ticked: ${c.signs.join(', ')}` : ''}` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <Screen
      blob="top"
      blobCenterY={150}
      header={<TopBar back title={m.name} right={<Chip label="Handoff" onPress={() => router.push({ pathname: '/care/p/[id]/handoff', params: { id: p.id } })} />} />}
      footer={
        !delivered && (
          <View style={styles.footer}>
            <View style={{ flex: 1 }}>
              <Button label="Record visit" icon={ClipboardPlus} onPress={() => router.push({ pathname: '/care/p/[id]/visit', params: { id: p.id } })} />
            </View>
          </View>
        )
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <AppText variant="caption" tone="secondary" align="center">
          {patientIds(db, m.id, p.id).ageObs}
        </AppText>
        <AppText variant="caption" tone="secondary" align="center">
          {[m.ipNo ? `IP ${m.ipNo}` : '', p.mchId].filter(Boolean).join(' · ')}
        </AppText>
        {delivered ? (
          <AppText variant="hero" align="center">
            Delivered
          </AppText>
        ) : (
          <View style={styles.gaRow}>
            <AppText variant="hero">{ga.weeks}</AppText>
            <AppText variant="stat" style={{ marginBottom: 12 }}>+{ga.days}</AppText>
            <AppText variant="headline" tone="secondary" style={{ marginBottom: 16, marginLeft: 6 }}>
              weeks
            </AppText>
          </View>
        )}
        <View style={styles.chips}>
          {!!p.lmp && <Chip label={`LMP: ${fmtDate(p.lmp)}`} variant="glass" />}
          <Chip label={`EDD: ${fmtDate(p.edd)}`} variant="glass" />
          {!!p.history.bloodGroup && <Chip label={p.history.bloodGroup} variant="glass" />}
          {p.history.allergies.map((a) => (
            <Chip key={a} label={`Allergy: ${a}`} variant="glass" />
          ))}
        </View>
        <View style={styles.chips}>
          {tags.map((t) => (
            <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />
          ))}
          <IntensityPill value={p.intensity} />
          <Chip label="Edit tags" icon={Tags} onPress={() => router.push({ pathname: '/care/p/[id]/tags', params: { id: p.id } })} />
        </View>
      </View>

      <UnderlineTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'visits', label: 'Visits', count: visits.length },
          { value: 'tests', label: 'Tests' },
          { value: 'referrals', label: 'Referrals', count: refs.length },
          { value: 'timeline', label: 'Timeline' },
          { value: 'notes', label: 'Notes', count: notes.length },
        ]}
      />

      {tab === 'overview' && (
        <>
          {babies.length > 0 && (
            <Section title="Baby">
              {babies.map((b) => (
                <ListRow key={b.id} leading={<Baby size={22} color={palette.lav600} />} title={b.childId} subtitle={`${b.sex === 'F' ? 'Girl' : 'Boy'} · ${b.birthWeightG} g at birth · born ${fmtDay(b.dob)}`} onPress={() => router.push({ pathname: '/care/b/[id]', params: { id: b.id } })} />
              ))}
            </Section>
          )}

          <PressableScale onPress={() => router.push({ pathname: '/care/p/[id]/brief', params: { id: p.id } })} accessibilityRole="button" accessibilityLabel="Case file">
            <GlassSurface strong radius={20} style={styles.aiRow}>
              <FolderOpen size={20} color={palette.rose600} />
              <View style={{ flex: 1 }}>
                <AppText variant="headline">Case File</AppText>
                <AppText variant="caption" tone="secondary">
                  Complete history, consultations, reports & notes
                </AppText>
              </View>
              <AppText variant="label" style={{ color: palette.rose600 }}>
                Open ›
              </AppText>
            </GlassSurface>
          </PressableScale>

          <Card style={{ gap: 4 }}>
            <View style={styles.cardHead}>
              <AppText variant="title">Still due</AppText>
              <AppText variant="label" tone="secondary">
                {due.length ? `${due.length} item${due.length > 1 ? 's' : ''}` : 'All clear'}
              </AppText>
            </View>
            {due.length === 0 && <AppText tone="secondary">Nothing pending for this pregnancy right now.</AppText>}
            {due.map((d) => (
              <ChecklistRow key={d.key} label={d.label} detail={d.detail} state={d.status === 'missed' || d.status === 'overdue' ? 'not_done' : undefined} actions={<Chip label="Open" onPress={dueAction(d)} />} />
            ))}
          </Card>

          <Section title="Latest documented">
            <View style={styles.tiles}>
              <StatTile icon={Scale} label="Weight" value={last?.vitals.weightKg ? String(last.vitals.weightKg) : '—'} unit="kg" caption={last ? fmtDate(last.at) : undefined} />
              <StatTile icon={HeartPulse} label="BP" value={last?.vitals.bpSys ? `${last.vitals.bpSys}/${last.vitals.bpDia}` : '—'} caption={last ? fmtDate(last.at) : undefined} />
            </View>
            <View style={styles.tiles}>
              <StatTile icon={Ruler} label="Fundal height" value={last?.vitals.fundalHeightCm ? String(last.vitals.fundalHeightCm) : '—'} unit="cm" caption={last ? fmtDate(last.at) : undefined} />
              <StatTile icon={HeartPulse} label="FHR" value={last?.vitals.fhr ? String(last.vitals.fhr) : '—'} unit="bpm" caption={last ? fmtDate(last.at) : undefined} />
            </View>
            {logs.slice(0, 2).map((l) => (
              <ListRow key={l.id} title={`${l.kind.toUpperCase()} ${l.value}`} subtitle={`Home reading · family-reported · ${fmtDay(l.at)} ${fmtTime(l.at)}`} />
            ))}
          </Section>

          {doses.length > 0 && (
            <Card style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pill size={16} color={palette.rose600} />
                <AppText variant="headline">Medicines · family-reported, last 7 days</AppText>
              </View>
              {[...new Set(doses.map((d) => d.med))].map((med) => {
                const mine = doses.filter((d) => d.med === med);
                return (
                  <AppText key={med} variant="caption" tone="secondary">
                    {med}: taken {mine.filter((d) => d.status === 'taken').length} of {mine.length} logged doses
                  </AppText>
                );
              })}
            </Card>
          )}

          <Section title={`Since last visit${last ? ` (${fmtDate(last.at)})` : ''}`}>
            <Card style={{ gap: 8 }}>
              {sinceEvents.length === 0 && <AppText tone="secondary">No new events.</AppText>}
              {sinceEvents.map((e, i) => (
                <View key={i} style={styles.event}>
                  <View style={styles.eventDot} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="body">{e.text}</AppText>
                    <AppText variant="caption" tone="faint">
                      {ago(e.at, now)} ago
                    </AppText>
                  </View>
                </View>
              ))}
            </Card>
          </Section>

          <Section title="Plan">
            <Card>
              <InfoRow label="Next visit" value={nv ? `${fmtDay(nv.dueBy)} · ${nv.title}` : undefined} />
              <InfoRow label="EDD" value={`${fmtDay(p.edd)} (${p.eddSource.toUpperCase()})`} />
              <InfoRow label="Doctor" value={p.assignedDoctor?.name} />
              <Field label="Assigned doctor" value={doctorDraft} onChangeText={setDoctorDraft} placeholder="e.g. Dr. Priya Rao" />
              <Button
                variant="secondary"
                label="Assign doctor"
                disabled={!doctorDraft.trim()}
                onPress={() => {
                  db.assignDoctor(p.id, { name: doctorDraft.trim() }, by, now);
                }}
              />
              <InfoRow label="Village" value={m.village} />
              <InfoRow label="Phone" value={m.phone} />
              <InfoRow label="Previous" value={p.previous.map((x) => `${x.year} ${x.mode ?? x.outcome}`).join(', ') || 'None'} />
            </Card>
            <View style={styles.actions}>
              <Chip label="Refer" icon={GitPullRequestArrow} onPress={() => router.push({ pathname: '/care/p/[id]/refer', params: { id: p.id } })} />
              <Chip label="Who viewed this record" onPress={() => router.push({ pathname: '/care/p/[id]/access', params: { id: p.id } })} />
              <Chip label="Capture paper record" icon={Camera} onPress={() => router.push({ pathname: '/care/capture', params: { id: p.id } })} />
              {!delivered && <Chip label="Admit / record delivery" icon={Baby} onPress={() => router.push({ pathname: '/care/p/[id]/deliver', params: { id: p.id } })} />}
              {delivered && <Chip label="Discharge checklist" onPress={() => router.push({ pathname: '/care/discharge/[id]', params: { id: p.id } })} />}
            </View>
          </Section>
        </>
      )}

      {tab === 'timeline' && (
        <ContinuityTimeline
          events={continuityEvents(db, p.id, now, 'care').map((e) => ({ ...e, title: e.kind === 'tag' ? `Tagged: ${tagLabel(e.sub ?? '')}` : e.label, sub: e.kind === 'tag' ? undefined : e.sub, anc: e.kind === 'visit' || e.kind === 'planned_visit' }))}
          now={now}
          fmt={fmtDay}
          motherLabel="Mother"
          babyLabel="Baby"
          todayLabel="Today"
          edd={delivered ? undefined : p.edd}
          eddLabel={`EDD · ${fmtDay(p.edd)}`}
        />
      )}

      {tab === 'tests' && (
        <View style={{ gap: space.sm }}>
          {invs.map((i) => {
            const s = invState(i, now);
            return (
              <ListRow
                key={i.id}
                title={i.label}
                subtitle={i.result ? `Tested ${fmtDay(i.result.at)} · ${i.result.value}${i.review ? ` · reviewed (${i.review.followUp})` : ''}` : i.kind === 'scan' ? 'Scan' : 'Lab'}
                meta={<StatusBadge status={s.status} label={s.label} />}
                onPress={() => router.push({ pathname: '/care/test/[id]', params: { id: i.id } })}
              />
            );
          })}
        </View>
      )}

      {tab === 'referrals' && (
        <View style={{ gap: space.sm }}>
          <Button variant="secondary" label="New referral" icon={GitPullRequestArrow} onPress={() => router.push({ pathname: '/care/p/[id]/refer', params: { id: p.id } })} />
          {refs.map((r) => (
            <ListRow
              key={r.id}
              title={`${r.department} · ${r.status}`}
              subtitle={r.reason}
              meta={
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {REFERRAL_STEPS.map((st, i) => (
                    <View key={st} style={[styles.step, { backgroundColor: i <= REFERRAL_STEPS.indexOf(r.status) ? palette.rose500 : palette.softBorder }]} />
                  ))}
                </View>
              }
              onPress={() => router.push({ pathname: '/care/referral/[id]', params: { id: r.id } })}
            />
          ))}
        </View>
      )}

      {tab === 'notes' && (
        <View style={{ gap: space.sm }}>
          <Card style={{ gap: space.sm }}>
            <Field label="Add a note for the care team" value={draft} onChangeText={setDraft} multiline placeholder="e.g. Echo reviewed, plan updated" />
            <Button
              variant="secondary"
              icon={Send}
              label="Post note"
              onPress={() => {
                if (!draft.trim()) return;
                db.addNote(p.id, draft.trim(), by, 'note', now);
                setDraft('');
              }}
            />
          </Card>
          {notes.map((n) => (
            <Card key={n.id} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <AppText variant="label">{n.author}</AppText>
                <AppText variant="caption" tone="faint">
                  {ago(n.at, now)} ago
                </AppText>
              </View>
              {n.kind === 'ai_verified' && <Chip label="AI draft · verified" variant="tag" />}
              <AppText>{n.body}</AppText>
            </Card>
          ))}
        </View>
      )}

      {tab === 'visits' && (
        <View style={{ gap: space.sm }}>
          {visits.map((v) => {
            const states = Object.values(v.checklist);
            return (
              <ListRow
                key={v.id}
                title={`${fmtDay(v.at)} · ${gestationalAge(p.edd, v.at).weeks} weeks`}
                subtitle={`BP ${v.vitals.bpSys ?? '—'}/${v.vitals.bpDia ?? '—'} · ${v.vitals.weightKg ?? '—'} kg${v.complaints.length ? ` · ${v.complaints.join(', ')}` : ''}`}
                meta={
                  <>
                    <AncBadge />
                    <StatusBadge status="done" label={`Checklist ${states.filter((x) => x.state === 'done').length}/${states.filter((x) => x.state !== 'na').length}`} />
                    <SyncBadge id={v.id} />
                  </>
                }
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 6 },
  gaRow: { flexDirection: 'row', alignItems: 'flex-end' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderWidth: 1.5, borderColor: palette.lav400 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  tiles: { flexDirection: 'row', gap: space.sm },
  event: { flexDirection: 'row', gap: 10 },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.rose300, marginTop: 7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: { flexDirection: 'row', gap: space.sm },
  step: { width: 18, height: 5, borderRadius: 3 },
});
