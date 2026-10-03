import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Controller } from "react-hook-form";
import {
  Baby,
  CalendarClock,
  Camera,
  ClipboardCheck,
  ClipboardPlus,
  CircleCheck,
  DoorOpen,
  EllipsisVertical,
  Eye,
  FileText,
  FolderOpen,
  GitPullRequestArrow,
  HeartPulse,
  Pencil,
  Pill,
  Ruler,
  Scale,
  Send,
  ShieldAlert,
  Tags,
  type LucideIcon,
} from "lucide-react-native";
import { gestationalAge } from "@domain/gestation";

import { tagLabel } from "@/data/catalogue";
import { endReasonCodes } from "@/data/codes";
import { asPregnancyId } from "@/data/ids";
import { overrideActive } from "@/data/payloads";
import {
  DATING_NOT_RECORDED,
  activeTags,
  ago,
  continuityEvents,
  fmtDate,
  fmtDay,
  fmtTime,
  invState,
  motherOf,
  nextVisit,
  obsScore,
  patientIds,
  referralStatusLabel,
  sexLabel,
  stillDue,
  visitsTab,
  type DueItem,
} from "@/data/selectors";
import { useDb } from "@/data/store";
import {
  REFERRAL_STEPS,
  type DocumentedFact,
  type Investigation,
  type Pregnancy,
} from "@/data/types";
import { EndAdmissionSheet } from "@/features/care/AdmissionSheets";
import {
  CareTeamRows,
  canEditMother,
  useCareMe,
} from "@/features/care/CareTeam";
import { DeliverySummaryCard } from "@/features/care/DeliverySummaryCard";
import {
  EnteredInErrorSheet,
  type EieTarget,
} from "@/features/care/EnteredInErrorSheet";
import { FactEditSheet } from "@/features/care/FactEditSheet";
import { noteSchema } from "@/features/care/forms";
import { useActor } from "@/features/care/nav";
import { OverrideBanner } from "@/features/care/OverrideBanner";
import {
  canCorrectSelfLog,
  canWriteSubject,
} from "@/features/care/permissions";
import { PrescriptionsCard } from "@/features/care/PrescriptionsCard";
import { useNow } from "@/lib/clock";
import { useZodForm } from "@/lib/forms";
import { useSubmitOnce } from "@/lib/useSubmitOnce";
import {
  AncBadge,
  AppText,
  Button,
  Card,
  Chip,
  ChecklistRow,
  ContinuityTimeline,
  Field,
  GlassIconButton,
  GlassSurface,
  InfoRow,
  IntensityPill,
  ListRow,
  PressableScale,
  Screen,
  Section,
  Sheet,
  StatTile,
  StatusBadge,
  SyncBadge,
  TopBar,
  UnderlineTabs,
  palette,
  space,
} from "@/ui";

type Tab = "overview" | "visits" | "tests" | "history" | "details";

function dueAction(d: DueItem) {
  switch (d.kind) {
    case "investigation":
    case "result":
      return () =>
        router.push({ pathname: "/care/test/[id]", params: { id: d.refId } });
    case "referral":
      return () =>
        router.push({
          pathname: "/care/referral/[id]",
          params: { id: d.refId },
        });
    default:
      return () =>
        router.push({ pathname: "/care/task/[id]", params: { id: d.refId } });
  }
}

const openTest = (i: Investigation) =>
  router.push({ pathname: "/care/test/[id]", params: { id: i.id } });

/**
 * CT-20 Consultation-ready patient view (PRD F-12): "still due" before "what happened". Everything sits in the
 * page's tabs — Overview · Visits · Tests · History · Details (settings and administration in Details). A recorded
 * entry is corrected by tapping it (the server writes a new version and keeps the old one as "Corrected"); values are
 * shown exactly as documented, never coloured or interpreted.
 */
export default function PatientView() {
  const id = asPregnancyId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("overview");
  const [eie, setEie] = useState<EieTarget>();
  const [fact, setFact] = useState<DocumentedFact>();
  const [endingAdmission, setEndingAdmission] = useState(false);
  const [menu, setMenu] = useState(false);
  const [menuTab, setMenuTab] = useState<"actions" | "referrals">("actions");
  const by = useActor();
  const me = useCareMe();

  const p = db.pregnancies.find((x) => x.id === id);
  const logAccess = useDb((s) => s.logAccess);
  useEffect(() => {
    if (id) logAccess(id, by, new Date());
  }, [id, by, logAccess]);
  if (!p)
    return (
      <Screen header={<TopBar back title="Patient" />}>
        <AppText>Not found.</AppText>
      </Screen>
    );
  const m = motherOf(db, p.motherId);
  const ga = p.edd && gestationalAge(p.edd, now);
  const tags = activeTags(db, p.id);
  const due = stillDue(db, p, now);
  const { recorded: visits, scheduled } = visitsTab(db, p.id, now);
  const last = visits[0];
  const invs = db.investigations.filter((i) => i.subjectId === p.id);
  const refs = db.referrals.filter((r) => r.pregnancyId === p.id);
  // A menu item closes the menu, then opens its screen
  const go = (to: Parameters<typeof router.push>[0]) => () => {
    setMenu(false);
    router.push(to);
  };
  const logs = db.selfLogs
    .filter((l) => l.motherId === m.id)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const cbs = db.callbacks.filter((c) => c.motherId === m.id);
  const nv = nextVisit(db, p.id, now);
  const babies = db.babies.filter((b) => b.pregnancyId === p.id);
  const delivery = db.deliveries.find((x) => x.pregnancyId === p.id);
  const motherDischarge = db.discharges.find(
    (x) => x.subjectId === p.id && x.subject === "mother",
  );
  const delivered = p.status === "delivered";
  const closed = p.status === "closed";
  const ongoing = p.status === "active" || p.status === "admitted";
  // A pregnancy's record is written by an obstetrician (app.require_writer): visits, tags, referrals, captures,
  // plans and corrections. Specialists and paediatricians read it; the server refuses their writes, so no button.
  const treating = canWriteSubject(me, "pregnancy");
  // Corrections are refused on a closed episode (correct_* PT409).
  const correcting = treating && !closed;
  const facts = db.facts.filter((f) => f.motherId === m.id);
  const since = last?.at ?? p.registeredOn;
  const notes = db.notes
    .filter((n) => n.subjectId === p.id)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const doses = db.medDoses.filter(
    (d) =>
      d.motherId === m.id && now.getTime() - d.at.getTime() < 8 * 86_400_000,
  );
  const override = db.overrides.find(
    (o) => o.motherId === m.id && overrideActive(o, now),
  );

  const sinceEvents = [
    ...invs
      .filter((i) => i.result && i.result.at > since)
      .map((i) => ({ at: i.result!.at, text: `${i.label}: result entered` })),
    ...refs.flatMap((r) =>
      r.events
        .filter((e) => e.at > since)
        .map((e) => ({
          at: e.at,
          text: `${r.department} referral: ${e.status}`,
        })),
    ),
    ...logs
      .filter((l) => l.at > since)
      .map((l) => ({
        at: l.at,
        text: `Home reading (family-reported): ${l.kind.toUpperCase()} ${l.value}`,
      })),
    ...cbs
      .filter((c) => c.at > since)
      .map((c) => ({
        at: c.at,
        text: `Call-back ${c.closedAt ? `closed: ${c.outcome}` : "requested"}${c.signs.length ? ` · ticked: ${c.signs.join(", ")}` : ""}`,
      })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const recordVisit = () =>
    router.push({ pathname: "/care/p/[id]/visit", params: { id: p.id } });
  const factsOf = (kind: DocumentedFact["kind"]) =>
    facts.filter((f) => f.kind === kind);

  return (
    <Screen
      blob="top"
      blobCenterY={150}
      header={
        <TopBar
          back
          title={m.name}
          right={
            <GlassIconButton
              icon={EllipsisVertical}
              accessibilityLabel="More: handoff, clinical actions, referrals"
              onPress={() => setMenu(true)}
            />
          }
        />
      }
      footer={
        ongoing &&
        treating &&
        tab !== "visits" && (
          <View style={styles.footer}>
            <View style={{ flex: 1 }}>
              <Button
                label="Record visit"
                icon={ClipboardPlus}
                onPress={recordVisit}
              />
            </View>
            {p.status === "admitted" && (
              <View style={{ flex: 1 }}>
                <Button
                  label="Record delivery"
                  icon={Baby}
                  onPress={() =>
                    router.push({
                      pathname: "/care/p/[id]/deliver",
                      params: { id: p.id },
                    })
                  }
                />
              </View>
            )}
          </View>
        )
      }
    >
      <OverrideBanner motherId={m.id} />
      {/* Header: identifiers (RCH ID at the top; her phone is in the Plan card), gestation, tags. */}
      <View style={styles.header}>
        <AppText variant="caption" tone="secondary" align="center">
          {patientIds(db, m.id, p.id).ageObs}
        </AppText>
        <AppText variant="caption" tone="secondary" align="center">
          {[
            `RCH ID ${m.rchId ?? "not recorded"}`,
            p.mchId,
            m.ipNo ? `IP ${m.ipNo}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </AppText>
        {closed ? (
          <>
            <AppText variant="display" align="center">
              Episode closed
            </AppText>
            <AppText tone="secondary" align="center">
              {[
                p.endReason && endReasonCodes.label(p.endReason),
                p.endedOn && fmtDay(p.endedOn),
              ]
                .filter(Boolean)
                .join(" · ")}
            </AppText>
          </>
        ) : delivered ? (
          <AppText variant="hero" align="center">
            Delivered
          </AppText>
        ) : !ga ? (
          <AppText variant="display" align="center">
            {DATING_NOT_RECORDED}
          </AppText>
        ) : (
          <View style={styles.gaRow}>
            <AppText variant="hero">{ga.weeks}</AppText>
            <AppText variant="stat" style={{ marginBottom: 12 }}>
              +{ga.days}
            </AppText>
            <AppText
              variant="headline"
              tone="secondary"
              style={{ marginBottom: 16, marginLeft: 6 }}
            >
              weeks
            </AppText>
          </View>
        )}
        <View style={styles.chips}>
          {!!p.lmp && <Chip label={`LMP: ${fmtDate(p.lmp)}`} variant="glass" />}
          {!!p.edd && <Chip label={`EDD: ${fmtDate(p.edd)}`} variant="glass" />}
          {!!p.history.bloodGroup && (
            <Chip label={p.history.bloodGroup} variant="glass" />
          )}
          {p.history.allergies.map((a) => (
            <Chip key={a} label={`Allergy: ${a}`} variant="glass" />
          ))}
        </View>
        <View style={styles.chips}>
          {tags.map((t) => (
            <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />
          ))}
          <IntensityPill value={p.intensity} />
          {treating && !closed && (
            <Chip
              label="Edit tags"
              icon={Tags}
              onPress={() =>
                router.push({
                  pathname: "/care/p/[id]/tags",
                  params: { id: p.id },
                })
              }
            />
          )}
        </View>
      </View>

      <UnderlineTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "visits", label: "Visits", count: visits.length },
          { value: "tests", label: "Tests", count: invs.length },
          { value: "history", label: "History" },
          { value: "details", label: "Details" },
        ]}
      />

      {tab === "overview" && (
        <>
          {babies.length > 0 && (
            <Section title="Baby">
              {babies.map((b) => (
                <ListRow
                  key={b.id}
                  leading={<Baby size={22} color={palette.lav600} />}
                  title={b.childId}
                  subtitle={[
                    sexLabel(b.sex),
                    b.outcome === "stillbirth" ? "stillborn" : undefined,
                    b.birthWeightG != null
                      ? `${b.birthWeightG} g at birth`
                      : undefined,
                    `born ${fmtDay(b.dob)} ${fmtTime(b.dob)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onPress={() =>
                    router.push({
                      pathname: "/care/b/[id]",
                      params: { id: b.id },
                    })
                  }
                />
              ))}
            </Section>
          )}

          {p.status === "admitted" && (
            <Card style={{ gap: 4 }}>
              <AppText variant="title">Admitted</AppText>
              <AppText tone="secondary">
                {[
                  p.admittedAt &&
                    `${fmtDay(p.admittedAt)} ${fmtTime(p.admittedAt)}`,
                  m.ipNo && `IP ${m.ipNo}`,
                  p.admissionReason,
                ]
                  .filter(Boolean)
                  .join(" · ") || "In the labour room"}
              </AppText>
            </Card>
          )}

          {delivery && (
            <DeliverySummaryCard delivery={delivery} babies={babies} />
          )}

          <PressableScale
            onPress={() =>
              router.push({
                pathname: "/care/p/[id]/brief",
                params: { id: p.id },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Case file"
          >
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

          {treating && ongoing && (
            <PressableScale
              onPress={() =>
                router.push({ pathname: "/care/capture", params: { id: p.id } })
              }
              accessibilityRole="button"
              accessibilityLabel="Capture paper record"
            >
              <GlassSurface strong radius={20} style={styles.captureRow}>
                <Camera size={20} color={palette.lav600} />
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">Capture paper record</AppText>
                  <AppText variant="caption" tone="secondary">
                    Photograph an ANC card; you confirm every field before it is
                    saved
                  </AppText>
                </View>
                <AppText variant="label" tone="accent">
                  Start ›
                </AppText>
              </GlassSurface>
            </PressableScale>
          )}

          {!p.edd && ongoing && (
            <Card style={{ gap: space.sm }}>
              <AppText variant="title">{DATING_NOT_RECORDED}</AppText>
              <AppText tone="secondary">
                Record the dating (LMP, scan or your EDD) to schedule her ANC
                visits and test windows.
              </AppText>
              {treating && (
                <Button
                  label="Record dating scan / EDD"
                  icon={CalendarClock}
                  onPress={() =>
                    router.push({
                      pathname: "/care/p/[id]/redate",
                      params: { id: p.id },
                    })
                  }
                />
              )}
            </Card>
          )}

          <Card style={{ gap: 4 }}>
            <View style={styles.cardHead}>
              <AppText variant="title">Still due</AppText>
              <AppText variant="label" tone="secondary">
                {due.length
                  ? `${due.length} item${due.length > 1 ? "s" : ""}`
                  : "All clear"}
              </AppText>
            </View>
            {due.length === 0 && (
              <AppText tone="secondary">
                Nothing pending for this pregnancy right now.
              </AppText>
            )}
            {due.map((d) => (
              <ChecklistRow
                key={d.key}
                label={d.label}
                detail={d.detail}
                state={
                  d.status === "missed" || d.status === "overdue"
                    ? "not_done"
                    : undefined
                }
                actions={<Chip label="Open" onPress={dueAction(d)} />}
              />
            ))}
          </Card>

          <Section title="Latest documented">
            <View style={styles.tiles}>
              <StatTile
                icon={Scale}
                label="Weight"
                value={
                  last?.vitals.weightKg ? String(last.vitals.weightKg) : "—"
                }
                unit="kg"
                caption={last ? fmtDate(last.at) : undefined}
              />
              <StatTile
                icon={HeartPulse}
                label="BP"
                value={
                  last?.vitals.bpSys
                    ? `${last.vitals.bpSys}/${last.vitals.bpDia}`
                    : "—"
                }
                caption={last ? fmtDate(last.at) : undefined}
              />
            </View>
            <View style={styles.tiles}>
              <StatTile
                icon={Ruler}
                label="Fundal height"
                value={
                  last?.vitals.fundalHeightCm
                    ? String(last.vitals.fundalHeightCm)
                    : "—"
                }
                unit="cm"
                caption={last ? fmtDate(last.at) : undefined}
              />
              <StatTile
                icon={HeartPulse}
                label="FHR"
                value={last?.vitals.fhr ? String(last.vitals.fhr) : "—"}
                unit="bpm"
                caption={last ? fmtDate(last.at) : undefined}
              />
            </View>
            {logs.slice(0, 3).map((l) => (
              <ListRow
                key={l.id}
                title={`${l.kind.toUpperCase()} ${l.value}`}
                subtitle={`Home reading · family-reported · ${fmtDay(l.at)} ${fmtTime(l.at)}`}
                // Family-reported: doctors never edit it; the reading's owner team may only remove it (with a reason).
                onPress={
                  canCorrectSelfLog(me, l.subject)
                    ? () =>
                        setEie({
                          kind: "self_log",
                          id: l.id,
                          label: `Home reading · ${l.kind.toUpperCase()} ${l.value} · ${fmtDay(l.at)}`,
                        })
                    : undefined
                }
              />
            ))}
          </Section>

          {doses.length > 0 && (
            <Card style={{ gap: 6 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Pill size={16} color={palette.rose600} />
                <AppText variant="headline">
                  Medicines · family-reported, last 7 days
                </AppText>
              </View>
              {[...new Set(doses.map((d) => d.med))].map((med) => {
                const mine = doses.filter((d) => d.med === med);
                return (
                  <AppText key={med} variant="caption" tone="secondary">
                    {med}: taken{" "}
                    {mine.filter((d) => d.status === "taken").length} of{" "}
                    {mine.length} logged doses
                  </AppText>
                );
              })}
            </Card>
          )}

          <Section
            title={`Since last visit${last ? ` (${fmtDate(last.at)})` : ""}`}
          >
            <Card style={{ gap: 8 }}>
              {sinceEvents.length === 0 && (
                <AppText tone="secondary">No new events.</AppText>
              )}
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
              <InfoRow
                label="Next visit"
                value={nv ? `${fmtDay(nv.dueBy)} · ${nv.title}` : undefined}
              />
              <InfoRow
                label="EDD"
                value={
                  p.edd
                    ? `${fmtDay(p.edd)} (${(p.eddSource ?? "lmp").toUpperCase()})`
                    : DATING_NOT_RECORDED
                }
              />
              <CareTeamRows
                subjectId={p.id}
                specialties={["obstetrics", "paediatrics"]}
                readOnly
              />
              <InfoRow label="Village" value={m.village} />
              <InfoRow label="Phone" value={m.phone} />
              <InfoRow
                label="Previous"
                value={
                  p.previous
                    .map((x) => `${x.year} ${x.mode ?? x.outcome}`)
                    .join(", ") || "None"
                }
              />
            </Card>
          </Section>

          <PrescriptionsCard
            subjectId={p.id}
            kind="pregnancy"
            canWrite={treating && !closed}
          />

          <Section title={`Notes${notes.length ? ` · ${notes.length}` : ""}`}>
            {!closed && <NoteForm key={p.id} pregnancy={p} />}
            {notes.map((n) => {
              const body = (
                <Card style={{ gap: 4 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <AppText variant="label">{n.author}</AppText>
                    <AppText variant="caption" tone="faint">
                      {ago(n.at, now)} ago
                    </AppText>
                  </View>
                  {n.kind === "ai_verified" && (
                    <Chip label="AI draft · verified" variant="tag" />
                  )}
                  <AppText>{n.body}</AppText>
                </Card>
              );
              // A note is never edited; the writer may remove it (entered in error, with a reason).
              return treating ? (
                <PressableScale
                  key={n.id}
                  onPress={() =>
                    setEie({
                      kind: "care_note",
                      id: n.id,
                      label: `Note · ${n.body.slice(0, 60)}`,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Note: remove"
                >
                  {body}
                </PressableScale>
              ) : (
                <View key={n.id}>{body}</View>
              );
            })}
          </Section>
        </>
      )}

      {tab === "visits" && (
        <View style={{ gap: space.md }}>
          {ongoing && treating && (
            <Button
              label="Record visit"
              icon={ClipboardPlus}
              onPress={recordVisit}
            />
          )}
          <Section title="Scheduled ANC visits">
            {scheduled.length === 0 && (
              <AppText tone="secondary">
                {p.edd
                  ? "No ANC visits are planned."
                  : "ANC visits are planned once the dating scan / EDD is recorded."}
              </AppText>
            )}
            {scheduled.map((s) => (
              <ListRow
                key={s.task.id}
                leading={<CalendarClock size={20} color={palette.lav600} />}
                title={s.task.title}
                meta={<StatusBadge status={s.status} label={s.label} />}
                onPress={
                  s.task.completedAt
                    ? undefined
                    : () =>
                        router.push({
                          pathname: "/care/task/[id]",
                          params: { id: s.task.id },
                        })
                }
              />
            ))}
          </Section>
          <Section title="Recorded visits">
            {visits.length === 0 && (
              <AppText tone="secondary">No visit recorded yet.</AppText>
            )}
            {correcting && visits.some((v) => !v.fromRegistration) && (
              <AppText variant="caption" tone="faint">
                Tap a visit to correct it or remove it.
              </AppText>
            )}
            {visits.map((v) => {
              const states = Object.values(v.checklist);
              const editable = correcting && !v.fromRegistration;
              return (
                <ListRow
                  key={v.id}
                  title={`${fmtDay(v.at)} ${fmtTime(v.at)}${p.edd ? ` · ${gestationalAge(p.edd, v.at).weeks} weeks` : ""}`}
                  subtitle={[
                    v.fromRegistration ? "At registration" : "",
                    `BP ${v.vitals.bpSys ?? "—"}/${v.vitals.bpDia ?? "—"} · ${v.vitals.weightKg ?? "—"} kg`,
                    v.complaints.length ? v.complaints.join(", ") : "",
                    v.vitals.fetalMovements
                      ? `Fetal movements (as reported): ${v.vitals.fetalMovements}`
                      : "",
                    v.counselling?.length
                      ? `Counselling: ${v.counselling.join(", ")}`
                      : "",
                    v.by,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  meta={
                    <>
                      <AncBadge />
                      {states.length > 0 && (
                        <StatusBadge
                          status="done"
                          label={`Checklist ${states.filter((x) => x.state === "done").length}/${states.filter((x) => x.state !== "na").length}`}
                        />
                      )}
                      <SyncBadge id={v.id} />
                    </>
                  }
                  onPress={
                    editable
                      ? () =>
                          router.push({
                            pathname: "/care/p/[id]/visit",
                            params: { id: p.id, edit: v.id },
                          })
                      : undefined
                  }
                />
              );
            })}
          </Section>
        </View>
      )}

      {tab === "tests" && <TestsTab invs={invs} now={now} />}

      {tab === "history" && (
        <>
          <Section title="Documented history">
            <Card style={{ gap: 6 }}>
              {correcting && facts.length > 0 && (
                <AppText variant="caption" tone="faint">
                  As documented. Tap an entry to correct it or remove it.
                </AppText>
              )}
              <FactGroup
                title="Conditions"
                facts={factsOf("condition")}
                fallback={p.history.conditions}
                onOpen={correcting ? setFact : undefined}
              />
              <FactGroup
                title="Allergies"
                facts={factsOf("allergy")}
                fallback={p.history.allergies}
                onOpen={correcting ? setFact : undefined}
              />
              <FactGroup
                title="Previous pregnancies"
                facts={factsOf("previous_pregnancy")}
                fallback={[]}
                onOpen={correcting ? setFact : undefined}
              />
            </Card>
          </Section>
          <Section title="As documented at registration">
            <Card>
              <InfoRow label="Obstetric score" value={obsScore(p.gpla)} />
              <InfoRow
                label="Current medicines"
                value={p.history.medicines.join(", ") || "None documented"}
              />
              <InfoRow
                label="Blood group"
                value={p.history.bloodGroup ?? "Not documented"}
              />
              <InfoRow
                label="Height"
                value={
                  p.history.heightCm != null
                    ? `${p.history.heightCm} cm`
                    : "Not documented"
                }
              />
              <InfoRow
                label="Weight at registration"
                value={
                  p.history.weightKg != null
                    ? `${p.history.weightKg} kg`
                    : "Not documented"
                }
              />
              <InfoRow label="Registered" value={fmtDay(p.registeredOn)} />
            </Card>
          </Section>
          <Section title="Care timeline">
            <ContinuityTimeline
              events={continuityEvents(db, p.id, now, "care").map((e) => ({
                ...e,
                title:
                  e.kind === "tag"
                    ? `Tagged: ${tagLabel(e.sub ?? "")}`
                    : e.label,
                sub: e.kind === "tag" ? undefined : e.sub,
                anc: e.kind === "visit" || e.kind === "planned_visit",
              }))}
              now={now}
              fmt={fmtDay}
              motherLabel="Mother"
              babyLabel="Baby"
              todayLabel="Today"
              edd={delivered ? undefined : p.edd}
              eddLabel={p.edd ? `EDD · ${fmtDay(p.edd)}` : DATING_NOT_RECORDED}
            />
          </Section>
        </>
      )}

      {tab === "details" && (
        <>
          <Section title="Mother">
            <Card>
              <InfoRow label="Name" value={m.name} />
              <InfoRow label="Phone" value={m.phone} />
              <InfoRow label="RCH ID" value={m.rchId ?? "Not recorded"} />
              <InfoRow label="Village" value={m.village} />
            </Card>
            {canEditMother(db, me, m.id) && (
              <Button
                variant="secondary"
                icon={Pencil}
                label="Edit details"
                onPress={() =>
                  router.push({
                    pathname: "/care/p/[id]/details",
                    params: { id: p.id },
                  })
                }
              />
            )}
          </Section>

          <Section title="Care team">
            <Card>
              <CareTeamRows
                subjectId={p.id}
                specialties={["obstetrics", "paediatrics"]}
              />
              <AppText variant="caption" tone="faint" style={{ marginTop: 4 }}>
                Only her current team (or named doctor) of that specialty can
                change it; the reason is recorded.
              </AppText>
            </Card>
          </Section>

          <Section title="Dating scan / EDD">
            <Card>
              <InfoRow
                label="EDD"
                value={
                  p.edd
                    ? `${fmtDay(p.edd)} (${(p.eddSource ?? "lmp").toUpperCase()})`
                    : DATING_NOT_RECORDED
                }
              />
              {!!p.lmp && <InfoRow label="LMP" value={fmtDay(p.lmp)} />}
            </Card>
            {treating && ongoing && (
              <Button
                variant="secondary"
                icon={CalendarClock}
                label={p.edd ? "Re-date (EDD)" : "Record dating scan / EDD"}
                onPress={() =>
                  router.push({
                    pathname: "/care/p/[id]/redate",
                    params: { id: p.id },
                  })
                }
              />
            )}
          </Section>

          <Section title="Record access">
            <ListRow
              leading={<Eye size={20} color={palette.lav600} />}
              title="Who viewed this record"
              subtitle="Every opening is logged"
              onPress={() =>
                router.push({
                  pathname: "/care/p/[id]/access",
                  params: { id: p.id },
                })
              }
            />
          </Section>

          <Section title="Emergency access">
            <Card style={{ gap: 4 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <ShieldAlert size={18} color={palette.lav600} />
                <AppText variant="headline" style={{ flex: 1 }}>
                  {override
                    ? `Open through emergency access · until ${fmtDay(override.expiresAt)} ${fmtTime(override.expiresAt)}`
                    : "No emergency access in force"}
                </AppText>
              </View>
              <AppText variant="caption" tone="secondary">
                {override
                  ? `Reason: ${override.reason}. End it from the banner at the top of this page.`
                  : "A clinician of the same specialty can open an unassigned record for 24 hours with a reason; it is logged and her doctor is told."}
              </AppText>
            </Card>
          </Section>

          {treating && (p.status === "active" || delivered) && (
            <Section title="Episode">
              <Button
                variant="secondary"
                label={
                  delivered
                    ? motherDischarge && !motherDischarge.completedAt
                      ? "Close episode (after discharge)"
                      : "Close episode"
                    : "End of pregnancy care"
                }
                onPress={() =>
                  router.push({
                    pathname: "/care/p/[id]/end",
                    params: { id: p.id },
                  })
                }
              />
            </Section>
          )}
        </>
      )}

      <EnteredInErrorSheet target={eie} onClose={() => setEie(undefined)} />
      <FactEditSheet
        fact={fact}
        previous={
          fact?.kind === "previous_pregnancy"
            ? p.previous.find((x) => x.id === fact.id)
            : undefined
        }
        onClose={() => setFact(undefined)}
      />
      <EndAdmissionSheet
        pregnancy={p}
        ipNo={m.ipNo}
        visible={endingAdmission}
        onClose={() => setEndingAdmission(false)}
      />
      {/* The "⋮" menu: handoff, clinical actions and referrals */}
      <Sheet visible={menu} onClose={() => setMenu(false)} title={m.name}>
        <UnderlineTabs
          value={menuTab}
          onChange={setMenuTab}
          tabs={[
            { value: "actions", label: "Actions" },
            { value: "referrals", label: "Referrals", count: refs.length },
          ]}
        />
        {menuTab === "actions" && (
          <>
        <MenuRow icon={FileText} label="Handoff summary" onPress={go({ pathname: "/care/p/[id]/handoff", params: { id: p.id } })} />
        <MenuRow icon={Eye} label="Who viewed this record" onPress={go({ pathname: "/care/p/[id]/access", params: { id: p.id } })} />
        {treating && ongoing && (
          <>
            <MenuRow icon={Camera} label="Capture paper record" onPress={go({ pathname: "/care/capture", params: { id: p.id } })} />
            <MenuRow icon={CalendarClock} label={p.edd ? "Re-date (EDD)" : "Record dating scan / EDD"} onPress={go({ pathname: "/care/p/[id]/redate", params: { id: p.id } })} />
          </>
        )}

        {treating && (ongoing || delivered) && (
          <>
            <AppText variant="label" tone="secondary" style={styles.menuGroup}>
              Clinical actions
            </AppText>
            {ongoing && (
              <MenuRow
                icon={Baby}
                label={p.status === "admitted" ? "Record delivery" : "Admit / record delivery"}
                onPress={go({ pathname: "/care/p/[id]/deliver", params: { id: p.id } })}
              />
            )}
            {p.status === "admitted" && (
              <MenuRow
                icon={DoorOpen}
                label="End admission (no delivery)"
                onPress={() => {
                  setMenu(false);
                  setEndingAdmission(true);
                }}
              />
            )}
            {delivered && motherDischarge && (
              <MenuRow
                icon={ClipboardCheck}
                label={
                  motherDischarge.completedAt
                    ? "Discharge checklist (completed)"
                    : `Mother's discharge checklist · ${motherDischarge.items.filter((i) => !i.state).length} open`
                }
                onPress={go({ pathname: "/care/discharge/[id]", params: { id: p.id } })}
              />
            )}
            {(p.status === "active" || delivered) && (
              <MenuRow
                icon={CircleCheck}
                label={
                  delivered
                    ? motherDischarge && !motherDischarge.completedAt
                      ? "Close episode (after discharge)"
                      : "Close episode"
                    : "End of pregnancy care"
                }
                onPress={go({ pathname: "/care/p/[id]/end", params: { id: p.id } })}
              />
            )}
          </>
        )}
          </>
        )}

        {menuTab === "referrals" && (
          <>
        {treating && !closed && (
          <MenuRow icon={GitPullRequestArrow} label="New referral" onPress={go({ pathname: "/care/p/[id]/refer", params: { id: p.id } })} />
        )}
        {refs.length === 0 && <AppText tone="secondary">No referrals.</AppText>}
        {refs.map((r) => (
          <ListRow
            key={r.id}
            title={`${r.department} · ${referralStatusLabel(r.status)}`}
            subtitle={r.reason}
            meta={
              <View style={{ flexDirection: "row", gap: 4 }}>
                {REFERRAL_STEPS.map((st, i) => (
                  <View
                    key={st}
                    style={[styles.step, { backgroundColor: i <= REFERRAL_STEPS.indexOf(r.status) ? palette.rose500 : palette.softBorder }]}
                  />
                ))}
              </View>
            }
            onPress={go({ pathname: "/care/referral/[id]", params: { id: r.id } })}
          />
        ))}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/** One kind of documented history: its entries (tap to correct when allowed), or what registration listed. */
function FactGroup({
  title,
  facts,
  fallback,
  onOpen,
}: {
  title: string;
  facts: DocumentedFact[];
  fallback: string[];
  onOpen?: (f: DocumentedFact) => void;
}) {
  const rows = facts.length
    ? facts
    : fallback.map((label) => ({ id: label, label }));
  return (
    <View style={{ gap: 2, paddingVertical: 4 }}>
      <AppText variant="caption" tone="secondary">
        {title}
      </AppText>
      {rows.length === 0 && <AppText tone="secondary">None documented</AppText>}
      {rows.map((f) => {
        const fact = facts.find((x) => x.id === f.id);
        return fact && onOpen ? (
          <PressableScale
            key={f.id}
            onPress={() => onOpen(fact)}
            accessibilityRole="button"
            accessibilityLabel={`${title}: ${f.label}, correct`}
            style={styles.factRow}
          >
            <AppText variant="bodyMedium" style={{ flex: 1 }}>
              {f.label}
            </AppText>
            <Pencil size={14} color={palette.lav600} />
          </PressableScale>
        ) : (
          <AppText key={f.id} variant="bodyMedium">
            {f.label}
          </AppText>
        );
      })}
    </View>
  );
}

const TEST_GROUPS: { title: string; when: (i: Investigation) => boolean }[] = [
  { title: "Awaiting your review", when: (i) => i.status === "resulted" },
  {
    title: "Due and ordered",
    when: (i) => i.status === "due" || i.status === "ordered",
  },
  { title: "Reviewed", when: (i) => i.status === "reviewed" },
  { title: "Not done", when: (i) => i.status === "not_done" },
];

/** CT-22 Tests tab: every investigation by state, with its due window and the result as entered. */
function TestsTab({ invs, now }: { invs: Investigation[]; now: Date }) {
  if (!invs.length)
    return (
      <AppText tone="secondary">
        No tests planned yet (test windows are planned with the dating).
      </AppText>
    );
  return (
    <View style={{ gap: space.md }}>
      {TEST_GROUPS.map((g) => {
        const rows = invs
          .filter(g.when)
          .sort((a, b) => a.dueBy.getTime() - b.dueBy.getTime());
        if (!rows.length) return null;
        return (
          <Section key={g.title} title={`${g.title} · ${rows.length}`}>
            {rows.map((i) => {
              const s = invState(i, now);
              return (
                <ListRow
                  key={i.id}
                  title={i.label}
                  subtitle={[
                    `Window ${fmtDate(i.dueFrom)} – ${fmtDate(i.dueBy)}`,
                    i.result
                      ? `Tested ${fmtDay(i.result.at)} · ${i.result.value}${i.result.unit ? ` ${i.result.unit}` : ""} (as entered)`
                      : i.kind === "scan"
                        ? "Scan"
                        : "Lab",
                    i.review ? `Reviewed (${i.review.followUp})` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  meta={<StatusBadge status={s.status} label={s.label} />}
                  onPress={() => openTest(i)}
                />
              );
            })}
          </Section>
        );
      })}
    </View>
  );
}

/** A care-team note; the field clears after each post. */
function NoteForm({ pregnancy }: { pregnancy: Pregnancy }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit, reset } = useZodForm(noteSchema, {
    defaultValues: { body: "" },
  });
  const { busy, once, next } = useSubmitOnce();
  const post = handleSubmit(
    once((v) => {
      db.addNote(pregnancy.id, v.body, by, "note", now);
      reset();
      next();
    }),
  );
  return (
    <Card style={{ gap: space.sm }}>
      <Controller
        control={control}
        name="body"
        render={({ field }) => (
          <Field
            label="Add a note for the care team"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
            placeholder="e.g. Echo reviewed, plan updated"
          />
        )}
      />
      <Button
        variant="secondary"
        icon={Send}
        label="Post note"
        disabled={busy}
        onPress={post}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  menuRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 14, paddingHorizontal: space.md, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.55)" },
  menuGroup: { marginTop: space.sm },
  header: { alignItems: "center", gap: 6 },
  gaRow: { flexDirection: "row", alignItems: "flex-end" },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
  },
  aiRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderWidth: 1.5,
    borderColor: palette.lav400,
  },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  tiles: { flexDirection: "row", gap: space.sm },
  event: { flexDirection: "row", gap: 10 },
  eventDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.rose300,
    marginTop: 7,
  },
  actions: { gap: space.sm },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 6,
  },
  footer: { flexDirection: "row", gap: space.sm },
  step: { width: 18, height: 5, borderRadius: 3 },
});

/** One item in the "⋮" menu. */
function MenuRow({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.menuRow}>
      <Icon size={20} color={palette.rose600} strokeWidth={1.8} />
      <AppText variant="bodyMedium" style={{ flex: 1 }}>
        {label}
      </AppText>
    </PressableScale>
  );
}
