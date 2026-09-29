/**
 * Register import (PRD F-30): CSV parsing, column mapping, row validation.
 * Excel (.xlsx) parsing lands server-side with the backend (import-register function).
 */
import { eddFromLmp } from '@domain/gestation';

import type { RegisterInput } from '@/data/store';

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'age', label: 'Age', required: true },
  { key: 'phone', label: 'Mobile', required: true },
  { key: 'village', label: 'Village' },
  { key: 'lmp', label: 'LMP', required: true },
  { key: 'gravida', label: 'Gravida' },
  { key: 'para', label: 'Para' },
  { key: 'blood', label: 'Blood group' },
] as const;

export type FieldKey = (typeof IMPORT_FIELDS)[number]['key'];
export type Mapping = Partial<Record<FieldKey, number>>;

/** Minimal CSV parser: commas, quoted fields with "" escapes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const HINTS: Record<FieldKey, RegExp> = {
  name: /name|patient/i,
  age: /^age|years/i,
  phone: /phone|mobile|contact/i,
  village: /village|address|area/i,
  lmp: /lmp|last.*period/i,
  gravida: /^g$|gravida/i,
  para: /^p$|para/i,
  blood: /blood|group/i,
};

/** Guess the column for each field from header names; the clinician can change it. */
export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {};
  for (const f of IMPORT_FIELDS) {
    const i = headers.findIndex((h) => HINTS[f.key].test(h));
    if (i >= 0) m[f.key] = i;
  }
  return m;
}

function parseDate(s: string): Date | undefined {
  const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export type RowResult = { index: number; cells: string[]; status: 'valid' | 'warning' | 'rejected'; reasons: string[]; input?: RegisterInput };

export function validate(rows: string[][], mapping: Mapping, existingPhones: Set<string>, now: Date): RowResult[] {
  const seen = new Set<string>();
  return rows.map((cells, index) => {
    const get = (k: FieldKey) => (mapping[k] !== undefined ? (cells[mapping[k]!] ?? '') : '');
    const reasons: string[] = [];
    const name = get('name');
    const age = Number(get('age'));
    const phone = get('phone').replace(/\D/g, '').slice(-10);
    const lmp = parseDate(get('lmp'));
    if (!name) reasons.push('Missing name');
    if (!(age >= 12 && age <= 55)) reasons.push('Age missing or implausible');
    if (!/^[6-9]\d{9}$/.test(phone)) reasons.push('Mobile number invalid');
    if (!lmp) reasons.push('LMP not a date (DD-MM-YYYY)');
    const edd = lmp ? eddFromLmp(lmp) : undefined;
    if (edd && (edd.getTime() < now.getTime() || edd.getTime() - now.getTime() > 300 * 86_400_000)) reasons.push('LMP gives an EDD outside this pregnancy window');
    if (reasons.length) return { index, cells, status: 'rejected', reasons };

    const warnings: string[] = [];
    if (existingPhones.has(phone) || seen.has(phone)) warnings.push('Phone already registered — will be skipped');
    seen.add(phone);
    if (!get('gravida')) warnings.push('Gravida missing — set to 1');
    const g = Number(get('gravida')) || 1;
    const p = Number(get('para')) || 0;
    const input: RegisterInput = {
      mother: { name, age, phone, village: get('village') || '—', lang: 'kn', emergencyContact: { name: '—', relation: 'Family', phone: '—' } },
      lmp,
      edd: edd!,
      eddSource: 'lmp',
      gpla: { g, p, l: p, a: 0 },
      history: { conditions: [], allergies: [], medicines: ['IFA', 'Calcium'], bloodGroup: get('blood') || undefined },
      previous: [],
      tagCodes: [],
      intensity: 'routine',
    };
    const dup = warnings.some((w) => w.startsWith('Phone already'));
    return { index, cells, status: dup ? 'rejected' : warnings.length ? 'warning' : 'valid', reasons: warnings, input: dup ? undefined : input };
  });
}

/** Synthetic sample register (fake data) with a few deliberate problems to show validation. */
export function sampleRegisterCsv(now: Date): string {
  const lmp = (weeksAgo: number) => {
    const d = new Date(now.getTime() - weeksAgo * 7 * 86_400_000);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  };
  const rows = [
    ['Patient Name', 'Age', 'Mobile', 'Village', 'LMP', 'G', 'P', 'Blood Group'],
    ['Asha R', '22', '9822200001', 'Hoskote', lmp(12), '1', '0', 'O+'],
    ['Bhavya S', '27', '9822200002', 'Malur', lmp(20), '2', '1', 'B+'],
    ['Chaitra N', '31', '9822200003', 'Anekal', lmp(28), '3', '2', 'A+'],
    ['Divya K', '19', '9822200004', 'Devanahalli', lmp(16), '', '', ''],
    ['Esha P', '25', '98222', 'Hebbal', lmp(24), '1', '0', 'AB+'],
    ['Farida B', '29', '9822200006', 'Yelahanka', 'next month', '2', '1', 'O-'],
    ['Gowri M', '34', '9822200007', 'Nelamangala', lmp(33), '4', '3', 'B-'],
    ['Hema T', '23', '9000000003', 'Hosakote', lmp(18), '1', '0', 'B+'],
    ['Indu V', '26', '9822200009', 'Doddaballapur', lmp(9), '1', '0', 'A-'],
    ['Jyothi R', '28', '9822200010', 'Kolar', lmp(30), '2', '1', 'O+'],
  ];
  return rows.map((r) => r.join(',')).join('\n');
}
