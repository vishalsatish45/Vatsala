/**
 * Supabase → DbState adapters. Screens and selectors keep reading
 * the same `DbState`; this file is the only place snake_case becomes UI shape.
 *
 *  - Every inbound row and DTO is parsed with a strict Zod object. An unknown key or a wrong type is a contract
 *    defect and fails the load loudly — never silently ignored.
 *  - Each table schema's keys are also the explicit column list requested (no `select *`).
 *  - Care Team: parallel SELECTs, each already filtered by row-level security to what this clinician may see.
 *  - Family: the per-screen read functions only (families read no table directly).
 *
 * Pure apart from the client it is given, so it can be exercised against the hosted project from Node.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { localDay } from '@domain/gestation';

import { CARD_FIELDS } from './catalogue';
import { callbackOutcomeCodes, complaintCodes, complicationCodes, contactOutcomeCodes, deliveryModeCodes, dischargeLabel, followUpCodes, labourMedicineCodes, previousLabel, previousModeCodes, previousOutcomeCodes, signLabel } from './codes';
import {
  asBabyId,
  asCallbackId,
  asCaregiverId,
  asDeliveryId,
  asDischargeId,
  asDocumentId,
  asEncounterId,
  asImmunizationId,
  asInvestigationId,
  asMedDoseId,
  asMotherId,
  asNoteId,
  asPregnancyId,
  asPrescriptionId,
  asReferralId,
  asSelfLogId,
  asStaffId,
  asSubjectId,
  asTagId,
  asTaskId,
  asTeamId,
  asVisitId,
} from './ids';
import type { DbState } from './store';
import type {
  AccessOverride,
  AppNotification,
  AuditEntry,
  DocumentedFact,
  SharedResult,
  Baby,
  Callback,
  Caregiver,
  CaptureDoc,
  Delivery,
  Discharge,
  Immunization,
  Investigation,
  MedDose,
  Mother,
  NewbornObs,
  Note,
  Pregnancy,
  Prescription,
  Referral,
  SelfLog,
  Tag,
  Task,
  Visit,
} from './types';

/** Row versions for optimistic concurrency, by row id (ids are UUIDs, unique across tables). */
export type Versions = Record<string, number>;
export type Snapshot = { state: DbState; versions: Versions };

// ── value helpers ─────────────────────────────────────────────────────────────────

/** A `date` column → the UTC-midnight Date the domain arithmetic uses. */
export const day = (s: string): Date => new Date(`${s}T00:00:00Z`);
const dayOpt = (s: string | null | undefined) => (s ? day(s) : undefined);
const tsOpt = (s: string | null | undefined) => (s ? new Date(s) : undefined);
/**
 * Date → `date` column (plain YYYY-MM-DD). A domain date (UTC midnight, from `day` / `addDays`) is that day; any other
 * moment (now, a picked date with its time) is the phone's local calendar day — never the UTC day, which in India is
 * a day behind between 00:00 and 05:30 and would shift follow-up dates and vaccine dates.
 */
export const isoDay = (d: Date) => {
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return (utcMidnight ? d : localDay(d)).toISOString().slice(0, 10);
};
/** Stored as 91XXXXXXXXXX; the app shows and dials the 10-digit number. */
export const localPhone = (p: string | null | undefined) => (p && p.length === 12 && p.startsWith('91') ? p.slice(2) : (p ?? ''));
export const e164 = (p: string) => (p.length === 10 ? `91${p}` : p);
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function emptyState(): DbState {
  return {
    mothers: [], pregnancies: [], tags: [], visits: [], tasks: [], investigations: [], referrals: [], callbacks: [], selfLogs: [],
    deliveries: [], babies: [], immunizations: [], discharges: [], audit: [], caregivers: [], cardFields: {}, notes: [],
    newbornObs: [], medDoses: [], captures: [], staff: [], teams: [], prescriptions: [], facts: [], overrides: [], notifications: [],
    sharedResults: [], teamMembers: [], assignments: [], mchSeq: 0,
  };
}

// ── contract: column types ────────────────────────────────────────────────────────

/** Every id column is checked to be a UUID here; the mappers below then brand it (`asMotherId` …). */
const id = z.guid();
const nid = id.nullable();
const str = z.string();
const nstr = str.nullable();
const num = z.number();
const nnum = num.nullable();
const bool = z.boolean();
const texts = z.array(str);
const intensity = z.enum(['routine', 'enhanced', 'close']);
const slot = z.enum(['morning', 'afternoon', 'night']);
const referralStatus = z.enum(['requested', 'accepted', 'scheduled', 'seen', 'recommendations', 'closed', 'declined', 'cancelled']);
const emergencyContact = z.strictObject({ name: str.optional(), relation: str.optional(), phone: str }).nullable();
const endReason = z.enum(['delivered', 'miscarriage', 'induced_abortion', 'ectopic', 'molar', 'maternal_death', 'transferred_out', 'lost_to_follow_up', 'other']);
const notificationTarget = z.enum(['pregnancy', 'baby', 'callback', 'referral', 'task', 'investigation']);
const captureField = z.strictObject({ key: str, label: str, value: str, confidence: num, confirmed: bool });

/** One strict schema per table read: its keys are the columns requested. */
const T = {
  staff: z.strictObject({ id, name: str, role: str }),
  teams: z.strictObject({ id, name: str, kind: z.enum(['department', 'unit']), specialty: str }),
  mothers: z.strictObject({
    id, phone: nstr, name: str, dob: nstr, age_at_registration: nnum, lang: z.enum(['en', 'kn', 'hi']), village: nstr,
    emergency_contact: emergencyContact, card_fields: z.array(z.enum(CARD_FIELDS)), version: num,
    alt_phone: nstr, husband_name: nstr, dob_estimated: bool, district: nstr, state: nstr, pincode: nstr,
  }),
  // Her national ids as documented (RCH register, ABHA); the hospital MRN is not read here.
  patient_identifiers: z.strictObject({ id, mother_id: id, system: z.enum(['rch', 'abha_number', 'abha_address']), value: str }),
  team_members: z.strictObject({ id, team_id: id, staff_id: id }),
  pregnancies: z.strictObject({
    id, mch_id: str, mother_id: id, registered_on: str, edd: str, gravida: num, para: num, living: num, abortions: num,
    status: z.enum(['active', 'delivered', 'closed']), intensity, ended_on: nstr, end_reason: endReason.nullable(), version: num,
  }),
  pregnancy_datings: z.strictObject({ id, pregnancy_id: id, method: z.enum(['lmp', 'scan', 'clinician']), lmp: nstr }),
  admissions: z.strictObject({ id, pregnancy_id: id, mother_id: id, ip_no: str, admitted_at: str, reason: nstr, discharged_at: nstr }),
  care_assignments: z.strictObject({ id, pregnancy_id: nid, baby_id: nid, specialty: z.enum(['obstetrics', 'paediatrics']), team_id: id, primary_staff_id: nid }),
  documented_conditions: z.strictObject({ id, mother_id: id, label: str }),
  allergies: z.strictObject({ id, mother_id: id, substance: str }),
  medications: z.strictObject({
    id, mother_id: id, pregnancy_id: nid, baby_id: nid, kind: z.enum(['statement', 'prescription']), name: str, dose: nstr, slots: z.array(slot),
    instructions: nstr, status: str, version: num,
  }),
  previous_pregnancies: z.strictObject({ id, mother_id: id, year: num, outcome: str, mode: nstr, gestation_weeks: nnum, complications: texts, note: nstr }),
  observations: z.strictObject({ id, encounter_id: id, code: str, value_num: nnum, value_text: nstr, at: str }),
  encounters: z.strictObject({
    id, pregnancy_id: nid, baby_id: nid, kind: str, at: str, by_staff: id, complaints: texts, complaints_note: nstr, note: nstr, document_id: nid,
  }),
  encounter_checklist: z.strictObject({ encounter_id: id, component: str, state: z.enum(['done', 'not_done', 'na']), reason: nstr }),
  tags: z.strictObject({
    id, pregnancy_id: nid, baby_id: nid, code: str, note: nstr, set_by: id, set_at: str, removed_at: nstr, removed_reason: nstr,
  }),
  tasks: z.strictObject({
    id, pregnancy_id: nid, baby_id: nid, kind: z.enum(['anc_visit', 'pn_visit', 'nb_visit', 'referral_appt', 'template']), title: str,
    referral_id: nid, place: nstr, completed_by_encounter_id: nid, due_from: nstr, due_by: str, completed_at: nstr, cancelled_at: nstr,
    generated_by: z.enum(['protocol', 'template', 'clinician', 'import']), override_reason: nstr, version: num,
  }),
  task_contacts: z.strictObject({ id, task_id: id, at: str, outcome: str, by_staff: id }),
  investigations: z.strictObject({
    id, pregnancy_id: nid, baby_id: nid, code: str, label: str, sensitive: bool, due_from: str, due_by: str, late: bool,
    status: z.enum(['due', 'ordered', 'collected', 'resulted', 'reviewed', 'not_done', 'not_applicable']),
    ordered_at: nstr, reviewed_at: nstr, reviewed_by: nid, follow_up: nstr, not_done_reason: nstr, version: num,
  }),
  investigation_catalogue: z.strictObject({ code: str, kind: z.enum(['lab', 'scan']) }),
  investigation_results: z.strictObject({
    id, investigation_id: id, value_num: nnum, value_text: nstr, unit: nstr, reported_at: str, entered_at: str, note: nstr,
  }),
  referrals: z.strictObject({
    id, pregnancy_id: nid, baby_id: nid, to_team_id: id, urgency: z.enum(['emergency', '24h', 'routine']), reason: str, question: str,
    status: referralStatus, scheduled_at: nstr, place: nstr, recommendations: nstr, created_by: id, version: num,
  }),
  referral_events: z.strictObject({ id, referral_id: id, status: referralStatus, at: str, by_staff: id, note: nstr }),
  callbacks: z.strictObject({
    id, mother_id: id, requested_by_label: str, channel: z.enum(['app', 'whatsapp', 'sms']), signs: texts, note: nstr, voice_path: nstr, voice_seconds: nnum,
    at: str, closed_at: nstr, outcome: nstr, outcome_note: nstr, closed_by: nid, version: num,
  }),
  self_logs: z.strictObject({ id, mother_id: id, baby_id: nid, kind: str, value: str, at: str, by_label: str }),
  deliveries: z.strictObject({
    id, pregnancy_id: id, at: str, mode: str, indication: nstr, blood_loss_ml: nnum, complications: texts, medicines: texts,
    place: z.enum(['this_facility', 'other_facility', 'home', 'in_transit']), labour_onset: z.enum(['spontaneous', 'induced', 'no_labour']).nullable(),
    perineum: nstr, complications_note: nstr, medicines_note: nstr, maternal_condition: nstr, attended_by: nstr,
  }),
  babies: z.strictObject({
    id, child_id: str, mother_id: id, pregnancy_id: id, dob: str, sex: z.enum(['F', 'M', 'U']), birth_weight_g: nnum, ga_at_birth_days: nnum,
    apgar1: nnum, apgar5: nnum, outcome: z.enum(['live', 'stillbirth']), intensity, deceased_at: nstr, version: num,
    length_cm: nnum, head_circ_cm: nnum, stillbirth_type: z.enum(['fresh', 'macerated']).nullable(), resuscitation: bool.nullable(),
    birth_defects: nstr, breastfed_within_1h: bool.nullable(), vitamin_k: bool.nullable(),
  }),
  immunizations: z.strictObject({
    id, baby_id: nid, code: str, due_on: str, given_on: nstr, status: z.enum(['due', 'given', 'not_given']), version: num,
    primary_source: bool.nullable(), batch: nstr, expiry_on: nstr, manufacturer: nstr, site: nstr, route: nstr, location: nstr, not_given_reason: nstr,
  }),
  vaccine_catalogue: z.strictObject({ code: str, label: str, grp: str }),
  discharges: z.strictObject({ id, pregnancy_id: nid, baby_id: nid, completed_at: nstr, completed_by: nid, version: num }),
  discharge_items: z.strictObject({ discharge_id: id, key: str, state: z.enum(['done', 'na', 'deferred']).nullable(), reason: nstr }),
  caregivers: z.strictObject({
    id, mother_id: id, name: str, relation: str, phone: nstr, scope_schedule: bool, scope_baby: bool, scope_logs: bool, scope_tests: bool,
    added_at: str, revoked_at: nstr, version: num,
  }),
  care_notes: z.strictObject({ id, pregnancy_id: nid, baby_id: nid, author: id, body: str, kind: z.enum(['note', 'ai_verified']), at: str }),
  med_doses: z.strictObject({ id, medication_id: id, mother_id: id, date: str, slot, status: z.enum(['taken', 'skipped']), at: str }),
  audit_log: z.strictObject({ id: num, at: str, actor_label: nstr, role: nstr, action: str, entity_type: str }),
  documents: z.strictObject({
    id, pregnancy_id: nid, baby_id: nid, storage_path: nstr, fields: z.array(captureField).nullable(), captured_at: str, captured_by: id,
  }),
  access_overrides: z.strictObject({ id, staff_id: id, mother_id: id, reason: str, granted_at: str, expires_at: str, ended_at: nstr }),
  referral_shared_results: z.strictObject({ referral_id: id, investigation_id: id }),
  // Own rows only (RLS). `params` is reserved for localised text and is not shown.
  notifications: z.strictObject({
    id, kind: str, params: z.record(z.string(), z.unknown()), target_type: notificationTarget.nullable(), target_id: nid, at: str, read_at: nstr,
  }),
};
type TableName = keyof typeof T;
type RowOf<K extends TableName> = z.infer<(typeof T)[K]>;

/** Family read-function results (supabase/migrations/2026100500040*, 2026100500080*). */
const homeReading = z.strictObject({ id, kind: str, value: str, at: str, by: str });
const scopes = z.strictObject({ schedule: bool, baby: bool, logs: bool, tests: bool });
const F = {
  context: z.strictObject({
    role: z.enum(['mother', 'caregiver']),
    scopes,
    mother: z.strictObject({ id, name: str, lang: z.enum(['en', 'kn', 'hi']), age: nnum, card_fields: z.array(z.enum(CARD_FIELDS)).nullable() }),
    hospital: z.strictObject({ name: str, phone_opd: nstr, phone_labour: nstr, address: nstr, maps_url: nstr }).nullable(),
    pregnancy: z
      .strictObject({
        id, mch_id: nstr, registered_on: str, edd: str, status: z.enum(['active', 'delivered', 'closed']), ended_on: nstr, end_reason: nstr,
        closer_follow_up: bool,
      })
      .nullable(),
    babies: z.array(z.strictObject({ id, name: nstr, dob: str, sex: z.enum(['F', 'M', 'U']), live: bool })).nullable(),
    card: z.strictObject({ blood_group: nstr, allergies: texts, conditions: texts, emergency_contact: emergencyContact }).nullable(),
  }),
  schedule: z.strictObject({
    visits: z.array(z.strictObject({
      id, kind: T.tasks.shape.kind, title: str, baby_id: nid, due_from: nstr, due_by: str, appointment_at: nstr, place: nstr, done: bool,
    })),
    vaccines: z.array(z.strictObject({ id, code: str, label: str, group: str, baby_id: nid, due_on: str, status: str, given_on: nstr })),
    tests_due: z.array(z.strictObject({ id, label: str, due_from: str, due_by: str })),
  }),
  tests: z.array(z.strictObject({
    id, code: str, kind: z.enum(['lab', 'scan']), label: str, baby_id: nid, due_from: str, due_by: str, status: z.enum(['due', 'done', 'not_done']),
    result: z.strictObject({ value_num: nnum, value_text: nstr, unit: nstr, recorded_on: str }).nullable(),
  })),
  readings: z.strictObject({
    hospital: z.array(z.strictObject({ code: str, value_num: nnum, value_text: nstr, unit: nstr, at: str })).nullable(),
    home: z.array(homeReading),
  }),
  baby: z.strictObject({
    id, name: nstr, child_id: str, dob: str, sex: z.enum(['F', 'M', 'U']), birth_weight_g: nnum, live: bool,
    vaccines: z.array(z.strictObject({ code: str, label: str, group: str, due_on: str, status: str, given_on: nstr })),
    weights: z.array(z.strictObject({ grams: nnum, at: str })),
    home: z.array(homeReading),
  }),
  medicines: z.array(z.strictObject({
    id, name: str, dose: nstr, slots: z.array(slot), instructions: nstr, start_on: nstr, end_on: nstr,
    doses: z.array(z.strictObject({ date: str, slot, status: z.enum(['taken', 'skipped']) })),
  })),
  callbacks: z.array(z.strictObject({ id, at: str, signs: texts, has_voice: bool, called_back: bool, closed_at: nstr, by: str })),
  caregivers: z.array(z.strictObject({
    id, name: str, relation: str, phone: nstr, version: num, scopes, added_at: str, has_signed_in: bool,
  })),
};

// ── reads ─────────────────────────────────────────────────────────────────────────

export class RemoteError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

function parse<S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new RemoteError(`Contract mismatch in ${what}: ${z.prettifyError(r.error)}`, 'contract');
  return r.data;
}

/** Stable paging order: the primary key (tables without an `id` column are listed here). */
const KEYS: Partial<Record<TableName, string[]>> = {
  encounter_checklist: ['encounter_id', 'component'],
  discharge_items: ['discharge_id', 'key'],
  investigation_catalogue: ['code'],
  vaccine_catalogue: ['code'],
  referral_shared_results: ['referral_id', 'investigation_id'],
};

/** Every visible row of a table, paged (PostgREST returns at most 1000 rows per request), each one parsed. */
async function all<K extends TableName>(db: SupabaseClient, table: K, filter?: (q: any) => any): Promise<RowOf<K>[]> {
  const schema = T[table];
  const columns = Object.keys(schema.shape).join(',');
  const out: RowOf<K>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(columns);
    if (filter) q = filter(q);
    for (const k of KEYS[table] ?? ['id']) q = q.order(k);
    q = q.range(from, from + 999);
    const { data, error } = await q;
    if (error) throw new RemoteError(`${table}: ${error.message}`, error.code);
    out.push(...parse(z.array(schema), data, table));
    if (!data || data.length < 1000) return out as RowOf<K>[];
  }
}

async function rpc<S extends z.ZodType>(db: SupabaseClient, fn: string, schema: S, p: Record<string, unknown> = {}): Promise<z.infer<S>> {
  const { data, error } = await db.rpc(fn, { p });
  if (error) throw new RemoteError(error.message, error.code);
  return parse(schema, data, fn);
}

const groupBy = <R, K extends string | null>(rows: R[], key: (r: R) => K) => {
  const m = new Map<string, R[]>();
  for (const r of rows) {
    const k = key(r);
    if (k != null) m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
};

// ── Care Team ─────────────────────────────────────────────────────────────────────

export async function loadCareSnapshot(db: SupabaseClient): Promise<Snapshot> {
  const final = (q: any) => q.eq('status', 'final');
  const [
    staff, teams, mothers, pregnancies, datings, admissions, assignments, conditions, allergies, medications, previous,
    observations, encounters, checklist, tags, tasks, contacts, investigations, catalogue, results, referrals, refEvents,
    callbacks, selfLogs, deliveries, babies, immunizations, vaccines, discharges, dischargeItems, caregivers, notes, doses,
    audit, documents, overrides, shared, notifications, identifiers, teamMembers,
  ] = await Promise.all([
    all(db, 'staff', (q) => q.eq('active', true)),
    all(db, 'teams', (q) => q.eq('active', true)),
    all(db, 'mothers'),
    all(db, 'pregnancies'),
    all(db, 'pregnancy_datings', (q) => q.eq('is_current', true)),
    all(db, 'admissions'),
    all(db, 'care_assignments', (q) => q.is('to_at', null)),
    all(db, 'documented_conditions', (q) => final(q).eq('clinical_status', 'active')),
    all(db, 'allergies', final),
    all(db, 'medications'),
    all(db, 'previous_pregnancies', final),
    all(db, 'observations', (q) => q.neq('status', 'entered_in_error')),
    all(db, 'encounters', final),
    all(db, 'encounter_checklist'),
    all(db, 'tags'),
    all(db, 'tasks'),
    all(db, 'task_contacts'),
    all(db, 'investigations'),
    all(db, 'investigation_catalogue'),
    all(db, 'investigation_results', (q) => q.neq('status', 'entered_in_error')),
    all(db, 'referrals'),
    all(db, 'referral_events'),
    all(db, 'callbacks'),
    all(db, 'self_logs', final),
    all(db, 'deliveries'),
    all(db, 'babies'),
    all(db, 'immunizations', (q) => q.not('baby_id', 'is', null).in('status', ['due', 'given', 'not_given'])),
    all(db, 'vaccine_catalogue'),
    all(db, 'discharges'),
    all(db, 'discharge_items'),
    all(db, 'caregivers'),
    all(db, 'care_notes', final),
    all(db, 'med_doses'),
    // The audit tail is bounded: the latest 200 entries this clinician may see.
    db
      .from('audit_log')
      .select(Object.keys(T.audit_log.shape).join(','))
      .order('at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) throw new RemoteError(`audit_log: ${error.message}`, error.code);
        return parse(z.array(T.audit_log), data, 'audit_log');
      }),
    all(db, 'documents'),
    // Only overrides still in force (RLS: the clinician's own, and any on mothers whose whole record she holds).
    all(db, 'access_overrides', (q) => q.is('ended_at', null).gt('expires_at', new Date().toISOString())),
    all(db, 'referral_shared_results'),
    notificationTail(db),
    all(db, 'patient_identifiers', (q) => q.is('baby_id', null).in('system', ['rch', 'abha_number', 'abha_address'])),
    all(db, 'team_members', (q) => q.is('to_at', null)),
  ]);

  const versions: Versions = {};
  for (const rows of [mothers, pregnancies, tasks, investigations, referrals, callbacks, babies, immunizations, discharges, caregivers, medications]) {
    for (const r of rows as { id: string; version: number }[]) versions[r.id] = r.version;
  }

  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const nameOf = (sid: string | null | undefined) => (sid ? (staffName.get(sid) ?? 'Care Team') : '');
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const s = emptyState();
  s.staff = staff.map((x) => ({ ...x, id: asStaffId(x.id) }));
  s.teams = teams.map((x) => ({ ...x, id: asTeamId(x.id) }));
  s.teamMembers = teamMembers.map((x) => ({ teamId: asTeamId(x.team_id), staffId: asStaffId(x.staff_id) }));
  s.assignments = assignments.map((a) => ({
    subjectId: asSubjectId((a.pregnancy_id ?? a.baby_id)!),
    specialty: a.specialty,
    teamId: asTeamId(a.team_id),
    staffId: a.primary_staff_id ? asStaffId(a.primary_staff_id) : undefined,
  }));
  const idOf = (motherId: string, system: string) => identifiers.find((i) => i.mother_id === motherId && i.system === system)?.value;

  // Mothers: the IP number of her latest admission (open first).
  const admByMother = groupBy(admissions, (a) => a.mother_id);
  s.mothers = mothers.map((m): Mother => {
    const adm = [...(admByMother.get(m.id) ?? [])].sort(
      (a, b) => Number(!!a.discharged_at) - Number(!!b.discharged_at) || b.admitted_at.localeCompare(a.admitted_at),
    )[0];
    const ec = m.emergency_contact;
    return {
      id: asMotherId(m.id),
      name: m.name,
      age: m.age_at_registration ?? (m.dob ? Math.floor((Date.now() - day(m.dob).getTime()) / (365.25 * 86_400_000)) : 0),
      phone: localPhone(m.phone),
      lang: m.lang,
      village: m.village ?? '',
      ipNo: adm?.ip_no,
      emergencyContact: { name: ec?.name ?? '', relation: ec?.relation ?? '', phone: localPhone(ec?.phone) },
      altPhone: m.alt_phone ? localPhone(m.alt_phone) : undefined,
      husbandName: opt(m.husband_name),
      dob: dayOpt(m.dob),
      dobEstimated: m.dob ? m.dob_estimated : undefined,
      district: opt(m.district),
      state: opt(m.state),
      pincode: opt(m.pincode),
      rchId: idOf(m.id, 'rch'),
      abhaNumber: idOf(m.id, 'abha_number'),
      abhaAddress: idOf(m.id, 'abha_address'),
    };
  });
  for (const m of mothers) s.cardFields[m.id] = m.card_fields;

  // Observations grouped by encounter, for visits and newborn checks.
  const obsByEnc = groupBy(observations, (o) => o.encounter_id);
  const vitals = (encId: string) => {
    const v: Record<string, number | string> = {};
    for (const o of obsByEnc.get(encId) ?? []) v[o.code] = o.value_num ?? o.value_text ?? '';
    return v;
  };
  const encPregnancy = new Map(encounters.map((e) => [e.id, e.pregnancy_id]));
  const latestObs = (pregIds: Set<string>, code: string) =>
    observations
      .filter((o) => o.code === code && pregIds.has(encPregnancy.get(o.encounter_id) ?? ''))
      .sort((a, b) => b.at.localeCompare(a.at))[0];

  const datingOf = new Map(datings.map((d) => [d.pregnancy_id, d]));
  const openAdm = new Map(admissions.filter((a) => !a.discharged_at).map((a) => [a.pregnancy_id, a]));
  const obAssign = new Map(assignments.filter((a) => a.specialty === 'obstetrics' && a.pregnancy_id).map((a) => [a.pregnancy_id!, a]));
  const condByMother = groupBy(conditions, (c) => c.mother_id);
  const allergyByMother = groupBy(allergies, (a) => a.mother_id);
  const prevByMother = groupBy(previous, (p) => p.mother_id);
  const pregsByMother = groupBy(pregnancies, (p) => p.mother_id);

  s.pregnancies = pregnancies.map((g): Pregnancy => {
    const d = datingOf.get(g.id);
    const doctor = obAssign.get(g.id)?.primary_staff_id;
    const sameMother = new Set((pregsByMother.get(g.mother_id) ?? []).map((x) => x.id));
    const bg = latestObs(sameMother, 'blood_group');
    const ht = latestObs(sameMother, 'height');
    return {
      id: asPregnancyId(g.id),
      mchId: g.mch_id,
      motherId: asMotherId(g.mother_id),
      registeredOn: new Date(g.registered_on),
      lmp: dayOpt(d?.lmp),
      edd: day(g.edd),
      eddSource: d?.method ?? 'lmp',
      gpla: { g: g.gravida, p: g.para, l: g.living, a: g.abortions },
      // 'Admitted' is an open admission, not a stored status.
      status: g.status === 'active' && openAdm.has(g.id) ? 'admitted' : g.status,
      intensity: g.intensity,
      endReason: opt(g.end_reason),
      endedOn: dayOpt(g.ended_on),
      admissionId: openAdm.get(g.id)?.id,
      admittedAt: tsOpt(openAdm.get(g.id)?.admitted_at),
      admissionReason: opt(openAdm.get(g.id)?.reason),
      assignedDoctor: doctor ? { name: nameOf(doctor) } : undefined,
      history: {
        conditions: (condByMother.get(g.mother_id) ?? []).map((c) => c.label),
        allergies: (allergyByMother.get(g.mother_id) ?? []).map((a) => a.substance),
        medicines: medications.filter((x) => x.pregnancy_id === g.id && x.kind === 'statement' && x.status === 'active').map((x) => x.name),
        bloodGroup: opt(bg?.value_text),
        heightCm: opt(ht?.value_num),
      },
      previous: (prevByMother.get(g.mother_id) ?? []).map((x) => ({
        id: x.id,
        year: x.year,
        outcome: previousOutcomeCodes.label(x.outcome),
        mode: x.mode ? previousModeCodes.label(x.mode) : undefined,
        gestationWeeks: opt(x.gestation_weeks),
        complications: x.complications.length ? x.complications : undefined,
        note: opt(x.note),
      })),
    };
  });

  s.facts = [
    ...conditions.map((c): DocumentedFact => ({ id: c.id, motherId: asMotherId(c.mother_id), kind: 'condition', label: c.label })),
    ...allergies.map((a): DocumentedFact => ({ id: a.id, motherId: asMotherId(a.mother_id), kind: 'allergy', label: a.substance })),
    ...previous.map((x): DocumentedFact => ({
      id: x.id,
      motherId: asMotherId(x.mother_id),
      kind: 'previous_pregnancy',
      label: previousLabel({
        year: x.year, outcome: previousOutcomeCodes.label(x.outcome), mode: x.mode ? previousModeCodes.label(x.mode) : undefined,
        gestationWeeks: opt(x.gestation_weeks), complications: x.complications, note: opt(x.note),
      }),
    })),
  ];

  const subjectOf = (r: { pregnancy_id: string | null; baby_id: string | null }) => asSubjectId((r.pregnancy_id ?? r.baby_id)!);

  s.tags = tags.map((t): Tag => ({
    id: asTagId(t.id), subjectId: subjectOf(t), code: t.code, note: opt(t.note), setBy: nameOf(t.set_by), setAt: new Date(t.set_at),
    removedAt: tsOpt(t.removed_at), removedReason: opt(t.removed_reason),
  }));

  // ANC visits (and a registration encounter that recorded vitals). Paper-record captures are visits too.
  const checklistByEnc = groupBy(checklist, (c) => c.encounter_id);
  const VITALS = ['weight', 'bp_sys', 'bp_dia'];
  s.visits = encounters
    .filter((e) => e.pregnancy_id && (e.kind === 'anc' || (e.kind === 'registration' && (obsByEnc.get(e.id) ?? []).some((o) => VITALS.includes(o.code)))))
    .map((e): Visit => {
      const v = vitals(e.id);
      const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : undefined);
      const t = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
      return {
        id: asVisitId(e.id),
        pregnancyId: asPregnancyId(e.pregnancy_id!),
        at: new Date(e.at),
        by: nameOf(e.by_staff),
        vitals: {
          weightKg: n('weight'), bpSys: n('bp_sys'), bpDia: n('bp_dia'), pulse: n('pulse'), fundalHeightCm: n('fundal_height'), fhr: n('fhr'),
          presentation: t('presentation'), urineAlbumin: t('urine_albumin'), urineSugar: t('urine_sugar'), oedema: t('oedema'),
        },
        checklist: Object.fromEntries((checklistByEnc.get(e.id) ?? []).map((c) => [c.component, { state: c.state, reason: opt(c.reason) }])),
        complaints: [...e.complaints.map(complaintCodes.label), ...(e.complaints_note ? [e.complaints_note] : [])],
        note: opt(e.note),
      };
    });

  s.newbornObs = encounters
    .filter((e) => e.kind === 'newborn' && e.baby_id)
    .map((e): NewbornObs => {
      const v = vitals(e.id);
      const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : undefined);
      const t = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
      return {
        id: asEncounterId(e.id), babyId: asBabyId(e.baby_id!), at: new Date(e.at), by: nameOf(e.by_staff),
        weightG: n('nb_weight'), tempC: n('nb_temp'), respRate: n('nb_resp_rate'), feeding: t('nb_feeding'), jaundice: t('nb_jaundice'),
        lengthCm: n('nb_length'), headCircCm: n('nb_head_circ'), note: opt(e.note),
      };
    });

  const contactsByTask = groupBy(contacts, (c) => c.task_id);
  s.tasks = tasks.map((t): Task => ({
    id: asTaskId(t.id),
    kind: t.kind,
    subjectType: t.baby_id ? 'baby' : 'pregnancy',
    subjectId: subjectOf(t),
    title: t.title,
    refId: t.referral_id ? asReferralId(t.referral_id) : t.completed_by_encounter_id ? asVisitId(t.completed_by_encounter_id) : undefined,
    place: opt(t.place),
    dueFrom: dayOpt(t.due_from),
    dueBy: day(t.due_by),
    completedAt: tsOpt(t.completed_at),
    cancelledAt: tsOpt(t.cancelled_at),
    generatedBy: t.generated_by,
    overrideReason: opt(t.override_reason),
    contactAttempts: [...(contactsByTask.get(t.id) ?? [])]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((c) => ({ at: new Date(c.at), outcome: contactOutcomeCodes.label(c.outcome), by: nameOf(c.by_staff) })),
  }));

  const kindOf = new Map(catalogue.map((c) => [c.code, c.kind]));
  const resultsByInv = groupBy(results, (r) => r.investigation_id);
  s.investigations = investigations.map((i): Investigation => {
    const r = [...(resultsByInv.get(i.id) ?? [])].sort((a, b) => b.entered_at.localeCompare(a.entered_at))[0];
    return {
      id: asInvestigationId(i.id),
      subjectId: subjectOf(i),
      code: i.code,
      label: i.label,
      kind: kindOf.get(i.code) ?? 'lab',
      sensitive: i.sensitive,
      dueFrom: day(i.due_from),
      dueBy: day(i.due_by),
      late: i.late,
      status: i.status === 'collected' ? 'ordered' : i.status === 'not_applicable' ? 'not_done' : i.status,
      orderedAt: tsOpt(i.ordered_at),
      result: r ? { value: r.value_text ?? String(r.value_num), unit: opt(r.unit), at: new Date(r.reported_at), note: opt(r.note) } : undefined,
      resultId: r?.id,
      review: i.reviewed_at ? { by: nameOf(i.reviewed_by), at: new Date(i.reviewed_at), followUp: followUpCodes.label(i.follow_up ?? '') } : undefined,
      notDoneReason: opt(i.not_done_reason),
    };
  });

  const babyPregnancy = new Map(babies.map((b) => [b.id, b.pregnancy_id]));
  const eventsByRef = groupBy(refEvents, (e) => e.referral_id);
  // The app shows a cancelled referral as closed.
  const shown = (st: z.infer<typeof referralStatus>) => (st === 'cancelled' ? 'closed' : st);
  s.referrals = referrals.map((r): Referral => ({
    id: asReferralId(r.id),
    pregnancyId: asPregnancyId(r.pregnancy_id ?? babyPregnancy.get(r.baby_id ?? '') ?? ''),
    department: teamName.get(r.to_team_id) ?? 'Department',
    urgency: r.urgency,
    reason: r.reason,
    question: r.question,
    status: shown(r.status),
    scheduledAt: tsOpt(r.scheduled_at),
    place: opt(r.place),
    recommendations: opt(r.recommendations),
    events: [...(eventsByRef.get(r.id) ?? [])]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => ({ status: shown(e.status), at: new Date(e.at), by: nameOf(e.by_staff), note: opt(e.note) })),
    createdBy: nameOf(r.created_by),
  }));

  const motherName = new Map(mothers.map((m) => [m.id, m.name]));
  s.callbacks = callbacks.map((c): Callback => ({
    id: asCallbackId(c.id),
    motherId: asMotherId(c.mother_id),
    requestedBy: requesterLabel(c.requested_by_label, motherName.get(c.mother_id)),
    channel: c.channel === 'app' ? 'app' : 'whatsapp',
    signs: c.signs.map(signLabel),
    note: opt(c.note),
    voicePath: opt(c.voice_path),
    voiceSeconds: opt(c.voice_seconds),
    at: new Date(c.at),
    closedAt: tsOpt(c.closed_at),
    outcome: c.outcome ? callbackOutcomeCodes.label(c.outcome) : undefined,
    outcomeNote: opt(c.outcome_note),
    closedBy: c.closed_by ? nameOf(c.closed_by) : undefined,
  }));

  s.selfLogs = selfLogs.map((l) => selfLog(l.id, l.mother_id, l.baby_id, l.kind, l.value, l.at, requesterLabel(l.by_label, motherName.get(l.mother_id))));

  const babiesByPregnancy = groupBy(babies, (b) => b.pregnancy_id);
  s.deliveries = deliveries.map((d): Delivery => ({
    id: asDeliveryId(d.id),
    pregnancyId: asPregnancyId(d.pregnancy_id),
    at: new Date(d.at),
    mode: deliveryModeCodes.label(d.mode),
    indication: opt(d.indication),
    bloodLossMl: opt(d.blood_loss_ml),
    complications: d.complications.map(complicationCodes.label),
    complicationsNote: opt(d.complications_note),
    medicines: d.medicines.map(labourMedicineCodes.label),
    medicinesNote: opt(d.medicines_note),
    babyIds: (babiesByPregnancy.get(d.pregnancy_id) ?? []).map((b) => asBabyId(b.id)),
    place: d.place,
    labourOnset: opt(d.labour_onset),
    perineum: opt(d.perineum),
    maternalCondition: opt(d.maternal_condition),
    attendedBy: opt(d.attended_by),
  }));

  s.babies = babies.map((b): Baby => ({
    id: asBabyId(b.id), childId: b.child_id, motherId: asMotherId(b.mother_id), pregnancyId: asPregnancyId(b.pregnancy_id), dob: new Date(b.dob), sex: babySex(b.sex),
    birthWeightG: opt(b.birth_weight_g), gaAtBirthDays: b.ga_at_birth_days ?? 0, apgar1: opt(b.apgar1), apgar5: opt(b.apgar5), outcome: b.outcome, intensity: b.intensity,
    deceasedAt: tsOpt(b.deceased_at),
    lengthCm: opt(b.length_cm), headCircCm: opt(b.head_circ_cm), stillbirthType: opt(b.stillbirth_type), resuscitation: opt(b.resuscitation),
    birthDefects: opt(b.birth_defects), breastfedWithin1h: opt(b.breastfed_within_1h), vitaminK: opt(b.vitamin_k),
  }));

  const vaccine = new Map(vaccines.map((v) => [v.code, v]));
  s.immunizations = immunizations.flatMap((z): Immunization[] =>
    z.baby_id
      ? [{
          id: asImmunizationId(z.id), babyId: asBabyId(z.baby_id), code: z.code, label: vaccine.get(z.code)?.label ?? z.code, group: vaccine.get(z.code)?.grp ?? '',
          dueOn: day(z.due_on), givenOn: dayOpt(z.given_on), notGivenReason: z.status === 'not_given' ? (z.not_given_reason ?? '') : undefined,
          given: z.status === 'given'
            ? { here: z.primary_source !== false, batch: opt(z.batch), expiryOn: dayOpt(z.expiry_on), manufacturer: opt(z.manufacturer), site: opt(z.site), route: opt(z.route), location: opt(z.location) }
            : undefined,
        }]
      : [],
  );

  const itemsByDischarge = groupBy(dischargeItems, (i) => i.discharge_id);
  s.discharges = discharges.map((d): Discharge => ({
    id: asDischargeId(d.id),
    subjectId: subjectOf(d),
    subject: d.baby_id ? 'baby' : 'mother',
    items: (itemsByDischarge.get(d.id) ?? []).map((i) => ({ key: i.key, label: dischargeLabel(i.key), state: opt(i.state), reason: opt(i.reason) })),
    completedAt: tsOpt(d.completed_at),
    completedBy: d.completed_by ? nameOf(d.completed_by) : undefined,
  }));

  s.caregivers = caregivers.map((c): Caregiver => ({
    id: asCaregiverId(c.id), motherId: asMotherId(c.mother_id), name: c.name, relation: c.relation, phone: localPhone(c.phone),
    scopes: { schedule: c.scope_schedule, baby: c.scope_baby, logs: c.scope_logs, tests: c.scope_tests }, addedAt: new Date(c.added_at), revokedAt: tsOpt(c.revoked_at),
  }));

  s.notes = notes.map((n): Note => ({ id: asNoteId(n.id), subjectId: subjectOf(n), author: nameOf(n.author), body: n.body, at: new Date(n.at), kind: n.kind }));

  s.prescriptions = medications
    .filter((m) => m.kind === 'prescription' && m.status === 'active')
    .map((m): Prescription => ({
      id: asPrescriptionId(m.id), motherId: asMotherId(m.mother_id), pregnancyId: m.pregnancy_id ? asPregnancyId(m.pregnancy_id) : undefined, babyId: m.baby_id ? asBabyId(m.baby_id) : undefined, name: m.name, dose: opt(m.dose), slots: m.slots, instructions: opt(m.instructions),
    }));
  const medName = new Map(medications.map((m) => [m.id, m.name]));
  s.medDoses = doses.map((d): MedDose => ({ id: asMedDoseId(d.id), motherId: asMotherId(d.mother_id), med: medName.get(d.medication_id) ?? '', medicationId: asPrescriptionId(d.medication_id), date: d.date, slot: d.slot, status: d.status, at: new Date(d.at) }));

  s.audit = audit.map((a): AuditEntry => ({ id: String(a.id), at: new Date(a.at), actor: a.actor_label ?? a.role ?? 'System', action: a.action.replace(/_/g, ' '), entity: a.entity_type }));

  const encByDoc = new Map(encounters.filter((e) => e.document_id).map((e) => [e.document_id!, asVisitId(e.id)]));
  s.captures = documents.flatMap((d): CaptureDoc[] =>
    d.fields
      ? [{ id: asDocumentId(d.id), subjectId: subjectOf(d), storagePath: opt(d.storage_path), fields: d.fields, at: new Date(d.captured_at), by: nameOf(d.captured_by), visitId: encByDoc.get(d.id) }]
      : [],
  );

  s.overrides = overrides.map((o): AccessOverride => ({
    id: o.id, staffId: asStaffId(o.staff_id), motherId: asMotherId(o.mother_id), reason: o.reason, grantedAt: new Date(o.granted_at), expiresAt: new Date(o.expires_at),
  }));
  s.sharedResults = shared.map((r): SharedResult => ({ referralId: asReferralId(r.referral_id), investigationId: asInvestigationId(r.investigation_id) }));
  s.notifications = notifications;

  return { state: s, versions };
}

/** The signed-in person's latest notifications (own rows by RLS), bounded. */
async function notificationTail(db: SupabaseClient): Promise<AppNotification[]> {
  const { data, error } = await db
    .from('notifications')
    .select(Object.keys(T.notifications.shape).join(','))
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);
  if (error) throw new RemoteError(`notifications: ${error.message}`, error.code);
  return parse(z.array(T.notifications), data, 'notifications').map((n) => ({
    id: n.id, kind: n.kind, targetType: opt(n.target_type), targetId: opt(n.target_id), at: new Date(n.at), readAt: tsOpt(n.read_at),
  }));
}

/** 'mother' | 'caregiver: Ravi (husband)' → what the care team reads. */
function requesterLabel(label: string, mother: string | undefined) {
  if (label === 'mother') return `${mother ?? 'Mother'} (mother)`;
  return label.replace(/^caregiver: /, '');
}

/** The app records only F / M at birth; an undetermined sex is never created by this app. */
const babySex = (sex: 'F' | 'M' | 'U'): Baby['sex'] => sex;

const SELF_LOG_KINDS: readonly string[] = ['bp', 'weight', 'movements', 'contractions', 'feeding', 'note'];
function selfLog(lid: string, motherId: string, babyId: string | null | undefined, kind: string, value: string, at: string, by: string): SelfLog {
  return {
    id: asSelfLogId(lid),
    motherId: asMotherId(motherId),
    subject: babyId ? 'baby' : 'mother',
    babyId: babyId ? asBabyId(babyId) : undefined,
    // bleeding / wound readings come from other channels; the app lists them as notes.
    kind: (SELF_LOG_KINDS.includes(kind) ? kind : 'note') as SelfLog['kind'],
    value,
    at: new Date(at),
    by,
  };
}

// ── Family ────────────────────────────────────────────────────────────────────────

export type FamilyWho = { motherId?: string; phone: string; name: string; role: 'mother' | 'caregiver' };

/** The server has no active app consent for this person (or the caregiver was removed): onboarding comes first. */
export class NeedsConsent extends Error {}

export async function loadFamilySnapshot(db: SupabaseClient, who: FamilyWho): Promise<Snapshot> {
  // A caregiver names the mother; a mother is resolved from her own login.
  const forMother: Record<string, unknown> = who.role === 'caregiver' && who.motherId ? { mother_id: who.motherId } : {};
  let ctx: z.infer<typeof F.context>;
  try {
    ctx = await rpc(db, 'family_context', F.context, forMother);
  } catch (e) {
    if (e instanceof RemoteError && e.code === 'PT404') throw new NeedsConsent('Consent needed');
    throw e;
  }
  const isMother = ctx.role === 'mother';
  const sc = ctx.scopes;

  const [schedule, tests, readings, medicines, callbacks, caregivers, babies, notifications] = await Promise.all([
    rpc(db, 'family_schedule', F.schedule, forMother),
    sc.tests ? rpc(db, 'family_tests', F.tests, forMother) : Promise.resolve([]),
    sc.logs ? rpc(db, 'family_readings', F.readings, forMother) : Promise.resolve({ hospital: null, home: [] }),
    sc.logs ? rpc(db, 'family_medicines', F.medicines, forMother) : Promise.resolve([]),
    rpc(db, 'family_callbacks', F.callbacks, forMother),
    isMother ? rpc(db, 'family_caregivers', F.caregivers) : Promise.resolve([]),
    sc.baby ? Promise.all((ctx.babies ?? []).map((b) => rpc(db, 'family_baby', F.baby, { ...forMother, baby_id: b.id }))) : Promise.resolve([]),
    // The one table a family reads directly: her own notification rows (RLS).
    notificationTail(db),
  ]);

  const s = emptyState();
  const versions: Versions = {};
  const motherId = asMotherId(ctx.mother.id);
  const card = ctx.card;
  const prescriptions = medicines.map((m): Prescription => ({ id: asPrescriptionId(m.id), motherId, name: m.name, dose: opt(m.dose), slots: m.slots, instructions: opt(m.instructions) }));

  s.mothers = [{
    id: motherId,
    name: ctx.mother.name,
    age: ctx.mother.age ?? 0,
    phone: isMother ? who.phone : '',
    lang: ctx.mother.lang,
    village: '',
    emergencyContact: { name: card?.emergency_contact?.name ?? '', relation: card?.emergency_contact?.relation ?? '', phone: localPhone(card?.emergency_contact?.phone) },
  }];
  if (ctx.mother.card_fields) s.cardFields[motherId] = ctx.mother.card_fields;
  if (ctx.hospital) {
    const h = ctx.hospital;
    s.hospital = { name: h.name, phoneOpd: localPhone(h.phone_opd) || undefined, phoneLabour: localPhone(h.phone_labour) || undefined, address: opt(h.address), mapsUrl: opt(h.maps_url) };
  }

  const g = ctx.pregnancy;
  if (g) {
    s.pregnancies = [{
      id: asPregnancyId(g.id),
      mchId: g.mch_id ?? '',
      motherId,
      registeredOn: new Date(g.registered_on),
      edd: day(g.edd),
      eddSource: 'lmp',
      gpla: { g: 0, p: 0, l: 0, a: 0 },
      status: g.status,
      endReason: opt(g.end_reason),
      endedOn: dayOpt(g.ended_on),
      // Families see only whether follow-up is closer than routine, never the clinician's grading.
      intensity: g.closer_follow_up ? 'enhanced' : 'routine',
      history: { conditions: card?.conditions ?? [], allergies: card?.allergies ?? [], medicines: prescriptions.map((p) => p.name), bloodGroup: opt(card?.blood_group) },
      previous: [],
    }];
  }
  const pregId = asPregnancyId(g?.id ?? '');

  s.babies = babies.map((b): Baby => ({
    id: asBabyId(b.id), childId: b.child_id, motherId, pregnancyId: pregId, dob: new Date(b.dob), sex: babySex(b.sex),
    birthWeightG: opt(b.birth_weight_g), gaAtBirthDays: 0, outcome: b.live ? 'live' : 'stillbirth', intensity: 'routine',
  }));

  // The journey's "birth" moment for the family timeline: the date only — delivery details are the clinicians'.
  if (g && s.babies.length) {
    const first = s.babies.reduce((a, b) => (a.dob.getTime() <= b.dob.getTime() ? a : b));
    s.deliveries = [{ id: asDeliveryId(`birth_${g.id}`), pregnancyId: pregId, at: first.dob, mode: '', complications: [], medicines: [], babyIds: s.babies.map((b) => b.id) }];
  }

  s.tasks = schedule.visits.map((t): Task => ({
    id: asTaskId(t.id), kind: t.kind, subjectType: t.baby_id ? 'baby' : 'pregnancy', subjectId: t.baby_id ? asBabyId(t.baby_id) : pregId, title: t.title,
    place: opt(t.place), dueFrom: dayOpt(t.due_from), dueBy: day(t.due_by), completedAt: t.done ? day(t.due_by) : undefined,
    generatedBy: 'protocol', contactAttempts: [],
  }));

  s.immunizations = schedule.vaccines.flatMap((z): Immunization[] =>
    z.baby_id && z.status !== 'not_given' ? [{ id: asImmunizationId(z.id), babyId: asBabyId(z.baby_id), code: z.code, label: z.label, group: z.group, dueOn: day(z.due_on), givenOn: dayOpt(z.given_on) }] : [],
  );

  s.investigations = tests.map((i): Investigation => ({
    id: asInvestigationId(i.id),
    subjectId: i.baby_id ? asBabyId(i.baby_id) : pregId,
    code: i.code,
    label: i.label,
    kind: i.kind,
    sensitive: false,
    dueFrom: day(i.due_from),
    dueBy: day(i.due_by),
    late: false,
    status: i.status === 'due' ? 'due' : i.status === 'not_done' ? 'not_done' : i.result ? 'reviewed' : 'resulted',
    result: i.result ? { value: i.result.value_text ?? String(i.result.value_num), unit: opt(i.result.unit), at: new Date(i.result.recorded_on) } : undefined,
  }));

  // Hospital readings arrive as single observations; readings taken together form one visit.
  const atGroups = groupBy(readings.hospital ?? [], (o) => o.at);
  s.visits = [...atGroups.entries()].map(([at, obs]): Visit => {
    const v = (code: string) => obs.find((o) => o.code === code)?.value_num ?? undefined;
    return {
      id: asVisitId(`reading_${at}`), pregnancyId: pregId, at: new Date(at), by: '',
      vitals: { weightKg: v('weight'), bpSys: v('bp_sys'), bpDia: v('bp_dia'), fundalHeightCm: v('fundal_height'), fhr: v('fhr') },
      checklist: {}, complaints: [],
    };
  });

  s.selfLogs = [
    ...readings.home.map((l) => selfLog(l.id, motherId, null, l.kind, l.value, l.at, requesterLabel(l.by, ctx.mother.name))),
    ...babies.flatMap((b) => b.home.map((l) => selfLog(l.id, motherId, b.id, l.kind, l.value, l.at, requesterLabel(l.by, ctx.mother.name)))),
  ];

  s.callbacks = callbacks.map((c): Callback => ({
    id: asCallbackId(c.id), motherId, requestedBy: requesterLabel(c.by, ctx.mother.name), channel: 'app', signs: c.signs.map(signLabel),
    at: new Date(c.at), closedAt: tsOpt(c.closed_at),
  }));

  s.caregivers = isMother
    ? caregivers.map((c): Caregiver => ({
        id: asCaregiverId(c.id), motherId, name: c.name, relation: c.relation, phone: localPhone(c.phone),
        scopes: { schedule: c.scopes.schedule, baby: c.scopes.baby, logs: c.scopes.logs, tests: c.scopes.tests }, addedAt: new Date(c.added_at),
      }))
    : [{ id: asCaregiverId('me'), motherId, name: who.name, relation: '', phone: who.phone, scopes: { schedule: sc.schedule, baby: sc.baby, logs: sc.logs, tests: sc.tests }, addedAt: new Date(0) }];
  for (const c of caregivers) versions[c.id] = c.version;
  s.notifications = notifications;

  s.prescriptions = prescriptions;
  s.medDoses = medicines.flatMap((m) =>
    m.doses.map((d): MedDose => ({ id: asMedDoseId(`${m.id}:${d.date}:${d.slot}`), motherId, med: m.name, medicationId: asPrescriptionId(m.id), date: d.date, slot: d.slot, status: d.status, at: day(d.date) })),
  );

  return { state: s, versions };
}

/** Exposed for the contract test (src/data/__tests__/remote.test.ts). */
export const contracts = { T, F };
