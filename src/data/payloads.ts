/**
 * Pure request builders for the record-keeping RPCs (supabase/migrations/2026100500030*, 0400*, 0600*).
 * Each one maps the app's shape to the RPC allowlist explicitly — no payload is written
 * wholesale, and an unknown key would be refused by the server. Dates only; no clinical interpretation.
 */
import { addDays, daysBetween, eddFromLmp, PREGNANCY_DAYS } from '@domain/gestation';

import { isoDay } from './remote';
import type { AccessOverride, CaregiverScopes, DoseSlot, EieKind, Id } from './types';

// ── Re-dating ─────────────────────────────────────────────────────────────────────

/** How the clinician dates the pregnancy. The app shows the resulting EDD; it never chooses between datings. */
export type RedateInput =
  | { method: 'lmp'; lmp: Date; note?: string }
  | { method: 'scan'; scanOn: Date; gaAtScanDays: number; note?: string }
  | { method: 'clinician'; edd: Date; note?: string };

/** The EDD a dating gives, by calendar arithmetic only (LMP + 280 days; scan date + days remaining). */
export function eddFor(input: RedateInput): Date {
  switch (input.method) {
    case 'lmp':
      return eddFromLmp(input.lmp);
    case 'scan':
      return addDays(input.scanOn, PREGNANCY_DAYS - input.gaAtScanDays);
    case 'clinician':
      return input.edd;
  }
}

/** Input checks the database also enforces (`pregnancy_datings` constraints); returns a message or undefined. */
export function redateProblem(input: RedateInput, now: Date): string | undefined {
  if (input.method === 'lmp' && daysBetween(now, input.lmp) > 0) return 'The LMP cannot be in the future.';
  if (input.method === 'scan') {
    if (daysBetween(now, input.scanOn) > 0) return 'The scan date cannot be in the future.';
    if (!Number.isInteger(input.gaAtScanDays) || input.gaAtScanDays < 28 || input.gaAtScanDays > 300) return 'Enter the gestational age at the scan (4 to 42 weeks).';
  }
  if (input.method === 'clinician' && daysBetween(now, input.edd) < 0) return 'The EDD cannot be in the past for an ongoing pregnancy.';
  return undefined;
}

/** `redate_pregnancy.dating` — exactly the keys of its allowlist that this method uses. */
export function datingPayload(input: RedateInput) {
  const edd = isoDay(eddFor(input));
  const note = input.note?.trim() || undefined;
  switch (input.method) {
    case 'lmp':
      return { method: 'lmp' as const, lmp: isoDay(input.lmp), edd, note };
    case 'scan':
      return { method: 'scan' as const, scan_on: isoDay(input.scanOn), ga_at_scan_days: input.gaAtScanDays, edd, note };
    case 'clinician':
      return { method: 'clinician' as const, edd, note };
  }
}

// ── Prescriptions ─────────────────────────────────────────────────────────────────

export const SLOTS: readonly DoseSlot[] = ['morning', 'afternoon', 'night'];

/** Free text typed by the clinician — the app never suggests a medicine, dose or schedule. */
export type PrescriptionInput = { name: string; dose?: string; slots: DoseSlot[]; instructions?: string };
export type Subject = { pregnancyId: Id; babyId?: undefined } | { babyId: Id; pregnancyId?: undefined };

export function prescriptionProblem(input: PrescriptionInput): string | undefined {
  if (!input.name.trim()) return 'Enter the medicine as prescribed.';
  if (!input.slots.length) return 'Choose at least one time of day.';
  return undefined;
}

/** `prescribe` payload (one subject: the pregnancy xor the baby). */
export function prescribePayload(id: Id, subject: Subject, input: PrescriptionInput, today: Date) {
  return {
    id,
    ...(subject.babyId ? { baby_id: subject.babyId } : { pregnancy_id: subject.pregnancyId }),
    name: input.name.trim(),
    dose: input.dose?.trim() || undefined,
    // In the fixed morning → night order, each once.
    slots: SLOTS.filter((s) => input.slots.includes(s)),
    instructions: input.instructions?.trim() || undefined,
    start_on: isoDay(today),
  };
}

// ── Entered in error, caregivers, notifications, overrides ────────────────────────

export function eiePayload(kind: EieKind, id: Id, reason: string, at: Date) {
  return { kind, id, reason: reason.trim(), at: at.toISOString() };
}

/** `update_caregiver.scopes`: every scope stated, so the server never keeps a value the mother did not see. */
export function caregiverScopesPayload(s: CaregiverScopes) {
  return { schedule: s.schedule, baby: s.baby, logs: s.logs, tests: s.tests };
}

/** `mark_notifications_read`: the rows read, or all of them. */
export function notificationsReadPayload(ids: Id[] | 'all') {
  return ids === 'all' ? { all: true } : { ids };
}

/** An override counts until it ends or expires. */
export const overrideActive = (o: AccessOverride, now: Date) => o.expiresAt.getTime() > now.getTime();

/** A typed or scanned code → the MCH id it carries (the baby suffix is dropped; access is to the mother). */
export function mchIdIn(text: string): string | undefined {
  return text.toUpperCase().match(/MCH-\d{4}-\d{6}/)?.[0];
}

/** Reasons are required and the database wants at least 3 characters. */
export const reasonOk = (r: string) => r.trim().length >= 3;
