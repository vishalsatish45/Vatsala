/**
 * Pure helpers for the `ai-brief` and `capture-transcribe` Edge Functions (PRD F-27, F-31).
 * No imports and no Deno/Node globals, so the same file runs in the Edge runtime and in
 * the app's jest suite (src/features/ai/__tests__/serverAi.test.ts).
 *
 *  1. composeFacts   rows already filtered by RLS → one plain-language fact per source record. Staff appear
 *                    only as role words; names, phones and numbers are never composed in.
 *  2. deidentify     scrubs what free text (notes, reasons) may still carry: known names → role words, phone
 *                    numbers, MCH / IP / child ids, UUIDs, e-mail addresses, villages and pincodes.
 *  3. assignRefs     short citation ids ([V3] = a visit, [T2] = a test …) that map back to real row ids.
 *  4. filterCited    the model's sentences: every one must cite only known short ids, use no interpretive
 *                    or advice language outside quotes, and carry no identifier — neither a generic one (phone,
 *                    id, e-mail) nor any of this record's known names, places and numbers; anything else is dropped.
 *
 * Hackathon scope: nothing here assesses, scores, thresholds or labels a clinical value.
 */

// ── Sources ──────────────────────────────────────────────────────────────────────

export type DraftKind = 'brief' | 'handoff' | 'discharge';
export const DRAFT_KINDS: readonly DraftKind[] = ['brief', 'handoff', 'discharge'];

export type SourceKind =
  | 'registration' | 'baby' | 'delivery' | 'visit' | 'test' | 'referral' | 'tag' | 'task' | 'callback' | 'selflog'
  | 'note' | 'medication' | 'vaccine' | 'discharge';

/** Citation prefix per source kind. Must stay in step with app.ai_source_table() in the 0950 migration. */
export const SOURCE_PREFIX: Record<SourceKind, string> = {
  registration: 'P', baby: 'B', delivery: 'D', visit: 'V', test: 'T', referral: 'R', tag: 'G', task: 'K',
  callback: 'C', selflog: 'H', note: 'N', medication: 'M', vaccine: 'I', discharge: 'X',
};
export const SOURCE_KINDS = Object.keys(SOURCE_PREFIX) as SourceKind[];

export type Fact = { kind: SourceKind; id: string; text: string };
export type Item = { ref: string; kind: SourceKind; text: string };
export type RefMap = Record<string, { kind: SourceKind; id: string }>;
export type Sentence = { text: string; sources: { kind: SourceKind; id: string }[] };

// ── 1. Facts from rows ───────────────────────────────────────────────────────────

type D = string | null | undefined;

export type RawRecord = {
  kind: DraftKind;
  today: string; // YYYY-MM-DD (the app's clock in demo mode)
  pregnancy?: {
    id: string; registered_on: string; edd: string; gravida: number; para: number; living: number; abortions: number;
    status: string; intensity: string; age: number | null; dating_method: string | null;
  };
  baby?: {
    id: string; dob: string; sex: string; birth_weight_g: number | null; ga_at_birth_days: number | null;
    apgar1: number | null; apgar5: number | null; outcome: string; intensity: string;
  };
  delivery?: { id: string; at: string; mode: string; indication: D; blood_loss_ml: number | null; complications: string[] } | null;
  conditions: string[];
  allergies: string[];
  previous: { year: number; outcome: string; mode: D }[];
  tags: { id: string; label: string; set_at: string; set_by_role: string; note: D }[];
  visits: { id: string; at: string; kind: string; by_role: string; observations: { label: string; value: string; unit: D }[]; complaints: string[]; note: D }[];
  tests: {
    id: string; label: string; status: string; due_by: string; sensitive: boolean; follow_up: D;
    result: { value: string; unit: D; reported_at: string } | null;
  }[];
  referrals: { id: string; department: string; status: string; urgency: string; reason: string; created_at: string; scheduled_at: D; recommendations: D }[];
  tasks: { id: string; title: string; due_by: string }[];
  callbacks: { id: string; at: string; signs: string[]; closed_at: D; outcome: D }[];
  selfLogs: { id: string; at: string; kind: string; value: string; by: string }[];
  notes: { id: string; at: string; by_role: string; body: string }[];
  medications: { id: string; name: string; dose: D; status: string }[];
  vaccines: { id: string; label: string; due_on: string; given_on: D; status: string }[];
  discharges: { id: string; completed_at: D; items: { label: string; state: D; reason: D }[] }[];
};

const day = (s: D) => (s ? s.slice(0, 10) : '');
const q = (s: D) => `"${(s ?? '').replace(/"/g, "'").trim()}"`;
const list = (xs: string[]) => (xs.length ? xs.map(q).join(', ') : 'none documented');
const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / DAY_MS);
const weeks = (days: number) => `${Math.floor(days / 7)}+${days % 7}`;

/** One fact per source record. Values are copied as documented, never compared with anything. */
export function composeFacts(r: RawRecord): Fact[] {
  const f: Fact[] = [];
  const p = r.pregnancy;
  if (p) {
    const ga = 280 - daysBetween(r.today, p.edd);
    f.push({
      kind: 'registration',
      id: p.id,
      text:
        `Pregnancy registered ${day(p.registered_on)}. G${p.gravida} P${p.para} L${p.living} A${p.abortions}. ` +
        `EDD ${day(p.edd)}${p.dating_method ? ` (dated by ${p.dating_method})` : ''}. Status: ${p.status}. ` +
        (p.status === 'active' && ga >= 0 && ga <= 320 ? `Gestational age on ${r.today} (from EDD): ${weeks(ga)} weeks. ` : '') +
        `Follow-up intensity set by the care team: ${p.intensity}. ` +
        (p.age != null ? `Age at registration: ${p.age}. ` : '') +
        `Documented conditions: ${list(r.conditions)}. Allergies: ${list(r.allergies)}. ` +
        `Previous pregnancies: ${r.previous.length ? r.previous.map((x) => `${x.year} ${q(x.mode ?? x.outcome)}`).join(', ') : 'none documented'}.`,
    });
  }
  const b = r.baby;
  if (b) {
    f.push({
      kind: 'baby',
      id: b.id,
      text:
        `Baby born ${day(b.dob)}, sex ${b.sex}, outcome ${b.outcome}` +
        (b.birth_weight_g != null ? `, birth weight ${b.birth_weight_g} g` : '') +
        (b.ga_at_birth_days != null ? `, gestational age at birth ${weeks(b.ga_at_birth_days)} weeks` : '') +
        (b.apgar1 != null || b.apgar5 != null ? `, Apgar ${b.apgar1 ?? '-'} at 1 min and ${b.apgar5 ?? '-'} at 5 min` : '') +
        `. Age on ${r.today}: ${Math.max(0, daysBetween(b.dob, r.today))} days. Follow-up intensity set by the care team: ${b.intensity}.`,
    });
  }
  const d = r.delivery;
  if (d) {
    f.push({
      kind: 'delivery',
      id: d.id,
      text:
        `Delivery on ${day(d.at)}, mode ${d.mode}` +
        (d.indication ? `, indication documented as ${q(d.indication)}` : '') +
        (d.blood_loss_ml != null ? `, blood loss documented ${d.blood_loss_ml} ml` : '') +
        `, complications documented: ${list(d.complications)}.`,
    });
  }
  for (const t of r.tags) {
    f.push({ kind: 'tag', id: t.id, text: `Tag ${q(t.label)} set ${day(t.set_at)} by the ${t.set_by_role}${t.note ? `, note ${q(t.note)}` : ''}.` });
  }
  for (const v of r.visits) {
    const obs = v.observations.map((o) => `${o.label} ${o.value}${o.unit ? ` ${o.unit}` : ''}`).join('; ');
    f.push({
      kind: 'visit',
      id: v.id,
      text:
        `${v.kind} encounter on ${day(v.at)} by the ${v.by_role}. Recorded: ${obs || 'no measurements'}.` +
        (v.complaints.length ? ` Complaints reported: ${list(v.complaints)}.` : '') +
        (v.note ? ` Note: ${q(v.note)}.` : ''),
    });
  }
  for (const t of r.tests) {
    const res = t.result
      ? t.sensitive
        ? ` A result was recorded on ${day(t.result.reported_at)} (value withheld from this summary).`
        : ` Result as entered: ${q(`${t.result.value}${t.result.unit ? ` ${t.result.unit}` : ''}`)}, reported ${day(t.result.reported_at)}.`
      : '';
    f.push({
      kind: 'test',
      id: t.id,
      text: `Test ${q(t.label)}: status ${t.status}, window ends ${day(t.due_by)}.${res}${t.follow_up ? ` Clinician review follow-up: ${t.follow_up}.` : ''}`,
    });
  }
  for (const x of r.referrals) {
    f.push({
      kind: 'referral',
      id: x.id,
      text:
        `Referral to ${q(x.department)} created ${day(x.created_at)} (urgency ${x.urgency}), reason ${q(x.reason)}; status ${x.status}` +
        (x.scheduled_at ? `, appointment ${day(x.scheduled_at)}` : '') +
        (x.recommendations ? `; recommendations documented: ${q(x.recommendations)}` : '') +
        '.',
    });
  }
  for (const t of r.tasks) f.push({ kind: 'task', id: t.id, text: `Scheduled: ${q(t.title)}, due by ${day(t.due_by)}.` });
  for (const c of r.callbacks) {
    f.push({
      kind: 'callback',
      id: c.id,
      text:
        `Call-back requested by the family on ${day(c.at)}` +
        (c.signs.length ? `; signs the family ticked: ${list(c.signs)}` : '') +
        (c.closed_at ? `; closed ${day(c.closed_at)}${c.outcome ? ` with outcome ${c.outcome}` : ''}` : '; still open') +
        '.',
    });
  }
  for (const l of r.selfLogs) f.push({ kind: 'selflog', id: l.id, text: `Home reading entered by the ${l.by} on ${day(l.at)}: ${l.kind} ${q(l.value)}.` });
  for (const n of r.notes) f.push({ kind: 'note', id: n.id, text: `Note by the ${n.by_role} on ${day(n.at)}: ${q(n.body)}.` });
  for (const m of r.medications) f.push({ kind: 'medication', id: m.id, text: `Medicine ${q(m.name)}${m.dose ? `, dose ${q(m.dose)}` : ''}, status ${m.status}.` });
  for (const v of r.vaccines) {
    f.push({ kind: 'vaccine', id: v.id, text: `Vaccine ${q(v.label)}: ${v.given_on ? `given ${day(v.given_on)}` : `${v.status}, due ${day(v.due_on)}`}.` });
  }
  for (const x of r.discharges) {
    const items = x.items.map((i) => `${q(i.label)} ${i.state ?? 'open'}${i.reason ? ` (${q(i.reason)})` : ''}`).join('; ');
    f.push({ kind: 'discharge', id: x.id, text: `Discharge checklist ${x.completed_at ? `completed ${day(x.completed_at)}` : 'in progress'}: ${items || 'no items'}.` });
  }
  return f;
}

// ── 2. De-identification ─────────────────────────────────────────────────────────

/** Known identifying strings for this record, by what replaces them. */
export type Identifiers = {
  mother: D[]; // her name
  family: D[]; // husband, emergency contact, caregivers, baby's name
  staff: D[];
  places: D[]; // village, district, state, pincode
  numbers: D[]; // MCH id, IP numbers, child ids, phone numbers (hers, alternate, emergency contact's, caregivers'), RCH / ABHA ids
};

const ROLE_WORD: Record<keyof Identifiers, string> = {
  mother: 'the mother',
  family: 'a family member',
  staff: 'a clinician',
  places: '[place]',
  numbers: '[id]',
};

/** Honorifics and particles that are not names on their own. */
const NOT_A_NAME = new Set(['dr', 'doctor', 'mr', 'mrs', 'ms', 'smt', 'shri', 'sri', 'baby', 'of', 'the', 'and', 'nurse', 'sister']);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GENERIC: [RegExp, string][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]'],
  [/\b(?:MCH|RCH|IP|MRN|UHID|ABHA)[-\s]?[A-Z0-9-]*\d{3,}[A-Z0-9-]*/gi, '[id]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]'],
  [/\b\d{8,}\b/g, '[number]'],
];

/** Scrub one piece of text. Longer strings are replaced first so "Lakshmi K" wins over "Lakshmi". */
export function deidentify(text: string, ids: Identifiers): string {
  const pairs: [string, string][] = [];
  for (const group of Object.keys(ROLE_WORD) as (keyof Identifiers)[]) {
    for (const raw of ids[group]) {
      const s = (raw ?? '').trim();
      if (s.length < 2) continue;
      pairs.push([s, ROLE_WORD[group]]);
      if (group === 'mother' || group === 'family' || group === 'staff') {
        for (const tok of s.split(/[\s.,]+/)) {
          if (tok.length >= 3 && !NOT_A_NAME.has(tok.toLowerCase())) pairs.push([tok, ROLE_WORD[group]]);
        }
      }
      if (group === 'numbers') {
        const digits = s.replace(/\D/g, '');
        if (digits.length >= 10) pairs.push([digits.slice(-10), ROLE_WORD.numbers]);
      }
    }
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  // Pattern-shaped identifiers first (so an e-mail or phone goes whole), then the known strings.
  let out = text;
  for (const [re, w] of GENERIC) out = out.replace(re, w);
  for (const [s, w] of pairs) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(s)}(?![\\p{L}\\p{N}])`, 'giu'), w);
  }
  return out;
}

/**
 * True when text still looks like it carries a direct identifier (defence in depth on model output): a generic
 * pattern (phone, id, e-mail, long number), or — given this record's identifiers — any known name, name part, place
 * or number of hers, her family's or the staff's.
 */
export function looksIdentifying(text: string, ids?: Identifiers): boolean {
  if (GENERIC.some(([re]) => new RegExp(re.source, re.flags.replace('g', '')).test(text))) return true;
  return !!ids && deidentify(text, ids) !== text;
}

// ── 3. Short citation ids ────────────────────────────────────────────────────────

export function assignRefs(facts: Fact[]): { items: Item[]; map: RefMap } {
  const n: Partial<Record<SourceKind, number>> = {};
  const seen = new Set<string>();
  const items: Item[] = [];
  const map: RefMap = {};
  for (const f of facts) {
    const key = `${f.kind}:${f.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    n[f.kind] = (n[f.kind] ?? 0) + 1;
    const ref = `${SOURCE_PREFIX[f.kind]}${n[f.kind]}`;
    items.push({ ref, kind: f.kind, text: f.text });
    map[ref] = { kind: f.kind, id: f.id };
  }
  return { items, map };
}

/** Facts → de-identified, cited items, ready for the prompt. */
export function prepareRecord(raw: RawRecord, ids: Identifiers): { items: Item[]; map: RefMap } {
  const facts = composeFacts(raw).map((f) => ({ ...f, text: deidentify(f.text, ids) }));
  return assignRefs(facts);
}

// ── 4. Prompt and citation filter ────────────────────────────────────────────────

const PURPOSE: Record<DraftKind, string> = {
  brief: 'a consultation brief for the clinician about to see her: what changed since the last visit, what is still due, open referrals and the next scheduled items',
  handoff: 'a handoff summary for the next team: documented history, tags, what is done and what is still due',
  discharge: 'a discharge summary draft: what was documented during the stay and the discharge checklist, and what is scheduled after discharge',
};

export const BRIEF_SYSTEM = [
  'You draft short summaries of a de-identified maternal and child health record for a clinician, who will check every sentence before anything is saved.',
  'Rules, all mandatory:',
  '1. Use only facts stated in the record items. Never add knowledge, never infer, never fill gaps.',
  '2. No diagnosis, no assessment, no interpretation of any value, no advice, no recommendations, no next steps, no ranking or urgency, no risk statements.',
  '3. Never describe a value with words such as normal, abnormal, high, low, raised, elevated, concerning, severe, mild, critical, risk, stable or improving. Report values exactly as recorded.',
  '4. Labels, notes and reasons written by people stay inside double quotes, copied verbatim.',
  '5. Every sentence cites the item ids it comes from in its "sources" list (for example ["V3", "T2"]). Cite only ids that appear in the record. A sentence you cannot cite must not be written.',
  '6. Refer to people only by role: the mother, the baby, the family, the obstetrician, the clinician. Never write names, phone numbers or identifiers, even if one appears in the record.',
  '7. Plain, short sentences in English. At most 12 sentences.',
].join('\n');

export function briefPrompt(kind: DraftKind, today: string, items: Item[]): string {
  return [
    `Write ${PURPOSE[kind]}.`,
    `Today is ${today}.`,
    'Record items (id, then the documented fact):',
    ...items.map((i) => `[${i.ref}] ${i.text}`),
  ].join('\n');
}

/** JSON schema for structured output (output_config.format). */
export const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } },
        required: ['text', 'sources'],
        additionalProperties: false,
      },
    },
  },
  required: ['sentences'],
  additionalProperties: false,
} as const;

/** Interpretive words (same list as the on-device brief, src/features/ai/brief.ts), checked outside quotes. */
export const BANNED = /\b(abnormal|normal|high|low|concerning|risk|dangerous|severe|mild|elevated|critical)\b/i;
/** Advice, inference and reassurance language, checked outside quotes. */
export const ADVICE = /\b(should|must|suggest\w*|consider\w*|advis\w*|likely|unlikely|probabl\w*|possibl\w*|diagnos\w*|worr\w*|reassur\w*|raised|stable|improv\w*|worsen\w*|needs? to)\b/i;

const REF = /^[A-Z]\d{1,3}$/;
const INLINE_REF = /\s*\[([A-Z]\d{1,3})(?:\s*,\s*[A-Z]\d{1,3})*\]/g;
const MAX_SENTENCES = 40;
const MAX_TEXT = 600;

/**
 * Keeps only sentences whose every citation is a known id and whose wording stays documentary.
 * Inline markers ("… [V3]") count as citations too and are removed from the text.
 */
export function filterCited(raw: unknown, map: RefMap, ids?: Identifiers): { kept: Sentence[]; dropped: number } {
  const arr = raw && typeof raw === 'object' && Array.isArray((raw as { sentences?: unknown }).sentences) ? (raw as { sentences: unknown[] }).sentences : [];
  const kept: Sentence[] = [];
  let dropped = 0;
  for (const s of arr) {
    const r = s as { text?: unknown; sources?: unknown };
    if (typeof r?.text !== 'string') {
      dropped++;
      continue;
    }
    const refs = new Set<string>();
    let unknownRef = false;
    const add = (x: unknown) => {
      const ref = typeof x === 'string' ? x.trim().replace(/^\[|\]$/g, '').toUpperCase() : '';
      if (REF.test(ref) && map[ref]) refs.add(ref);
      else unknownRef = true;
    };
    if (Array.isArray(r.sources)) r.sources.forEach(add);
    else if (r.sources !== undefined) unknownRef = true;
    for (const m of r.text.matchAll(INLINE_REF)) for (const x of m[0].replace(/[[\]\s]/g, '').split(',')) add(x);
    const text = r.text.replace(INLINE_REF, '').replace(/\s+/g, ' ').trim();
    const unquoted = text.replace(/"[^"]*"/g, '');
    if (!text || text.length > MAX_TEXT || unknownRef || refs.size === 0 || BANNED.test(unquoted) || ADVICE.test(unquoted) || looksIdentifying(text, ids) || kept.length >= MAX_SENTENCES) {
      dropped++;
      continue;
    }
    kept.push({ text, sources: [...refs].map((ref) => ({ kind: map[ref]!.kind, id: map[ref]!.id })) });
  }
  return { kept, dropped };
}

// ── Paper capture (F-31) ─────────────────────────────────────────────────────────

/** The ANC-card fields we transcribe. Must match app.capture_field_labels in the 0950 migration. */
export const CAPTURE_FIELDS = [
  { key: 'visit_date', label: 'Visit date' },
  { key: 'weight', label: 'Weight' },
  { key: 'bp', label: 'BP' },
  { key: 'albumin', label: 'Urine albumin' },
  { key: 'urine_sugar', label: 'Urine sugar' },
  { key: 'hb', label: 'Hb' },
  { key: 'fhr', label: 'FHR' },
  { key: 'fundal_height', label: 'Fundal height' },
  { key: 'next_visit', label: 'Next visit date' },
] as const;
export type CaptureKey = (typeof CAPTURE_FIELDS)[number]['key'];
const CAPTURE_KEYS = new Set<string>(CAPTURE_FIELDS.map((f) => f.key));

export const CAPTURE_SYSTEM = [
  'You copy handwritten or printed entries from a photo of an Indian Mother and Child Protection (ANC) card into fields.',
  'Rules, all mandatory:',
  '1. Transcribe only these fields: ' + CAPTURE_FIELDS.map((f) => `${f.key} (${f.label})`).join(', ') + '. If a card has several visits, use the most recent visit column.',
  '2. Copy each value exactly as written, including units or symbols that are written (for example "128/82", "61 kg", "Nil", "+"). Do not convert, correct, round, complete or interpret anything.',
  '3. Leave out any field you cannot see. Never guess.',
  '4. Never copy names, phone numbers, addresses or identity numbers.',
  '5. confidence is how sure you are that you read the characters correctly (0 to 1), not a judgement about the value.',
].join('\n');

export const CAPTURE_SCHEMA = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: CAPTURE_FIELDS.map((f) => f.key) },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['key', 'value', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['fields'],
  additionalProperties: false,
} as const;

export type CaptureDraft = { key: CaptureKey; value: string; confidence: number };

/** Allowlisted keys only, first reading per key, values as written (trimmed), confidence clamped to 0..1. */
export function cleanCaptureFields(raw: unknown): CaptureDraft[] {
  const arr = raw && typeof raw === 'object' && Array.isArray((raw as { fields?: unknown }).fields) ? (raw as { fields: unknown[] }).fields : [];
  const out: CaptureDraft[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const r = x as { key?: unknown; value?: unknown; confidence?: unknown };
    if (typeof r?.key !== 'string' || !CAPTURE_KEYS.has(r.key) || seen.has(r.key) || typeof r.value !== 'string') continue;
    const value = r.value.replace(/\s+/g, ' ').trim();
    if (!value || value.length > 80 || looksIdentifying(value)) continue;
    const c = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
    seen.add(r.key);
    out.push({ key: r.key as CaptureKey, value, confidence: Math.round(c * 100) / 100 });
  }
  return out;
}
