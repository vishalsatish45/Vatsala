/**
 * Family form schemas. Readings are stored as entered, as family-reported values: the
 * schemas only check that something was entered — never whether a value is good or bad.
 */
import { z } from 'zod';

const text = z.string();
const MOBILE = /^[6-9]\d{9}$/;

// ── Ask for a call ───────────────────────────────────────────────────────────────

export const callbackRequestSchema = z
  .object({
    /** Warning-sign codes (catalogue WARNING_SIGNS keys) the family ticked. */
    signs: z.array(z.string()),
    note: text,
    voice: z.object({ uri: z.string(), seconds: z.number() }).optional(),
  })
  .transform((v) => ({ signs: v.signs, note: v.note.trim() || undefined, voice: v.voice }));

// ── Record a reading (FA-10/11) ──────────────────────────────────────────────────

export const SELF_LOG_KINDS = ['bp', 'weight', 'movements', 'contractions', 'feeding'] as const;
export type SelfLogKind = (typeof SELF_LOG_KINDS)[number];

/** Chip choices are i18n keys; the record stores their English label. */
export const MOVEMENT_CHOICES = ['family.log.moveNormal', 'family.log.moveLess'] as const;
export const FEEDING_CHOICES = ['family.log.feedWell', 'family.log.feedPoorly', 'family.log.feedNot'] as const;

const selfLogFields = z.object({ kind: z.enum(SELF_LOG_KINDS), sys: text, dia: text, kg: text, count: text, choice: z.string().optional() });
export type SelfLogForm = z.input<typeof selfLogFields>;
export const blankSelfLog: SelfLogForm = { kind: 'bp', sys: '', dia: '', kg: '', count: '', choice: undefined };

/** The reading as it will be stored ('' while incomplete): "120/80", "62 kg", "4 in last hour", or the chosen chip key. */
export function selfLogValue(v: SelfLogForm): string {
  switch (v.kind) {
    case 'bp':
      return v.sys && v.dia ? `${v.sys}/${v.dia}` : '';
    case 'weight':
      return v.kg ? `${v.kg} kg` : '';
    case 'contractions':
      return v.count ? `${v.count} in last hour` : '';
    default:
      return v.choice ?? '';
  }
}

export const selfLogSchema = selfLogFields
  .refine((v) => !!selfLogValue(v), { path: ['kind'], message: 'Enter the reading' })
  .transform((v) => ({
    kind: v.kind,
    /** For chip readings this is the i18n key of the choice; the screen stores its English label. */
    value: selfLogValue(v),
    isChoice: v.kind === 'movements' || v.kind === 'feeding',
    subject: v.kind === 'feeding' ? ('baby' as const) : ('mother' as const),
  }));

// ── Add a family member (FM-03) ──────────────────────────────────────────────────

export const CAREGIVER_RELATIONS = ['husband', 'mother', 'motherInLaw', 'sister', 'other'] as const;

export const caregiverSchema = z
  .object({
    name: text,
    relation: z.enum(CAREGIVER_RELATIONS).optional(),
    phone: text,
    scopes: z.object({ schedule: z.boolean(), baby: z.boolean(), logs: z.boolean() }),
  })
  .superRefine((v, ctx) => {
    if (v.name.trim().length <= 1) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter their name' });
    if (!v.relation) ctx.addIssue({ code: 'custom', path: ['relation'], message: 'Choose the relation' });
    if (!MOBILE.test(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a 10-digit mobile number' });
  })
  .transform((v) => ({ name: v.name.trim(), relation: v.relation ?? 'other', phone: v.phone, scopes: v.scopes }));
