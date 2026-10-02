/**
 * Register import (PRD F-30): CSV parsing, column mapping, row validation.
 * Excel (.xlsx) parsing lands server-side with the backend (import-register function).
 *
 * Each row is checked by the registration form's own schema (makeRegisterSchema), which mirrors the server's bounds,
 * so a row shown as importable is not refused for its values. Only what the file says is sent: nothing is filled in
 * (no default medicines, no assumed living children or abortions); a missing required value rejects the row.
 */
import type { RegisterInput } from '@/data/store';
import type { MotherId } from '@/data/types';
import { blankRegisterForm, makeRegisterSchema, parseDayMonthYear, pickerDay, type RegisterForm } from '@/features/care/forms';

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'age', label: 'Age', required: true },
  { key: 'phone', label: 'Mobile', required: true },
  { key: 'lmp', label: 'LMP (DD-MM-YYYY)', required: true },
  { key: 'gravida', label: 'Gravida (G)', required: true },
  { key: 'para', label: 'Para (P)', required: true },
  { key: 'living', label: 'Living children (L)', required: true },
  { key: 'abortions', label: 'Abortions (A)', required: true },
  { key: 'village', label: 'Village' },
  { key: 'blood', label: 'Blood group' },
  { key: 'lang', label: 'Language' },
  { key: 'rch', label: 'RCH id' },
  { key: 'husband', label: "Husband's name" },
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
  name: /^(patient )?name|patient/i,
  age: /^age|years/i,
  phone: /phone|mobile|contact/i,
  village: /village|address|area/i,
  lmp: /lmp|last.*period/i,
  gravida: /^g$|gravida/i,
  para: /^p$|para/i,
  living: /^l$|living/i,
  abortions: /^a$|abort/i,
  blood: /blood|group/i,
  lang: /lang/i,
  rch: /rch/i,
  husband: /husband/i,
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

const LANG: Record<string, RegisterForm['lang']> = { en: 'English', english: 'English', kn: 'Kannada', kannada: 'Kannada', hi: 'Hindi', hindi: 'Hindi' };
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/** A mother already on this phone's record (the visible ones): a returning mother or someone else's number. */
export type KnownMother = { id: MotherId; name: string; phone: string; activePregnancy: boolean };

export type RowResult = { index: number; cells: string[]; status: 'valid' | 'warning' | 'rejected'; reasons: string[]; input?: RegisterInput };

/**
 * `units`/`teamId`: the obstetric unit the import registers into (required by the server when the clinician has
 * several). Rows are checked one by one; the reasons are the form's own messages.
 */
export function validate(rows: string[][], mapping: Mapping, known: KnownMother[], now: Date, opts: { units?: readonly string[]; teamId?: string } = {}): RowResult[] {
  const schema = makeRegisterSchema(now, { units: opts.units });
  const firstRow = new Map<string, number>();
  return rows.map((cells, index) => {
    const get = (k: FieldKey) => (mapping[k] !== undefined ? (cells[mapping[k]!] ?? '').trim() : '');
    const reasons: string[] = [];
    const warnings: string[] = [];
    const phone = get('phone').replace(/\D/g, '').slice(-10);
    const lmpText = get('lmp');
    const lmp = parseDayMonthYear(lmpText);
    const langText = get('lang');
    const lang = LANG[langText.toLowerCase()];
    if (!lang) warnings.push(langText ? `Language "${langText}" is not offered — English until she changes it` : 'No language given — English until she changes it');

    const form: RegisterForm = {
      ...blankRegisterForm(now),
      name: get('name'),
      age: get('age'),
      phone,
      village: get('village'),
      lang: lang ?? 'English',
      rchId: get('rch'),
      husbandName: get('husband'),
      method: 'LMP',
      lmp: lmp ? pickerDay(lmp) : undefined,
      g: get('gravida'),
      p: get('para'),
      l: get('living'),
      a: get('abortions'),
      blood: get('blood') ? get('blood').replace(/\s+/g, '').toUpperCase() : undefined,
      teamId: opts.teamId,
    };

    if (lmpText && !lmp) reasons.push('LMP is not a real date (DD-MM-YYYY)');
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        if (i.path[0] === 'lmp' && lmpText && !lmp) continue;
        if (!reasons.includes(i.message)) reasons.push(i.message);
      }
    }

    // One phone = one mother (the server's rule): an earlier row, another patient, or a returning mother.
    let returningId: MotherId | undefined;
    if (phone) {
      const earlier = firstRow.get(phone);
      if (earlier !== undefined) reasons.push(`Same mobile as row ${earlier + 2}`);
      else firstRow.set(phone, index);
      const other = known.find((m) => m.phone === phone);
      if (other && earlier === undefined) {
        if (!sameName(other.name, form.name)) reasons.push('This mobile belongs to another patient');
        else if (other.activePregnancy) reasons.push('She already has an ongoing pregnancy');
        else {
          returningId = other.id;
          warnings.push('Returning mother — her record is reused and updated from this row');
        }
      }
    }

    if (reasons.length || !parsed.success) return { index, cells, status: 'rejected', reasons };
    const input: RegisterInput = { ...parsed.data, existingMotherId: returningId };
    return { index, cells, status: warnings.length ? 'warning' : 'valid', reasons: warnings, input };
  });
}

/** Synthetic sample register (fake data) with a few deliberate problems to show validation. */
export function sampleRegisterCsv(now: Date): string {
  const lmp = (weeksAgo: number) => {
    const d = new Date(now.getTime() - weeksAgo * 7 * 86_400_000);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  };
  const rows = [
    ['Patient Name', 'Age', 'Mobile', 'Village', 'LMP', 'G', 'P', 'L', 'A', 'Blood Group', 'Language'],
    ['Asha R', '22', '9822200001', 'Hoskote', lmp(12), '1', '0', '0', '0', 'O+', 'Kannada'],
    ['Bhavya S', '27', '9822200002', 'Malur', lmp(20), '2', '1', '1', '0', 'B+', 'Kannada'],
    ['Chaitra N', '31', '9822200003', 'Anekal', lmp(28), '3', '2', '2', '0', 'A+', 'Hindi'],
    ['Divya K', '19', '9822200004', 'Devanahalli', lmp(16), '1', '0', '0', '0', '', ''],
    ['Esha P', '25', '98222', 'Hebbal', lmp(24), '1', '0', '0', '0', 'AB+', 'English'],
    ['Farida B', '29', '9822200006', 'Yelahanka', 'next month', '2', '1', '1', '0', 'O-', 'Hindi'],
    ['Gowri M', '34', '9822200007', 'Nelamangala', lmp(33), '4', '3', '3', '0', 'B-', 'Kannada'],
    ['Hema T', '23', '9000000003', 'Hosakote', lmp(18), '1', '0', '0', '0', 'B+', 'Kannada'],
    ['Indu V', '26', '9822200009', 'Doddaballapur', lmp(9), '1', '0', '0', '0', 'A-', 'Kannada'],
    ['Jyothi R', '28', '9822200010', 'Kolar', lmp(30), '2', '1', '1', '0', 'O+', 'English'],
  ];
  return rows.map((r) => r.join(',')).join('\n');
}
