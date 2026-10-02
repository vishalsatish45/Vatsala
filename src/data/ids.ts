/**
 * Typed entity ids. The only places a raw string becomes a branded id:
 *  - the adapters (src/data/remote.ts), after the strict Zod schema has checked the value is a UUID;
 *  - the store's `uid(kind)` when the app mints a new record id;
 *  - route params, which arrive as strings — screens convert them once with these helpers;
 *  - the demo seed, whose ids are readable non-UUID strings.
 * Pure (no React Native imports), so it is unit-tested directly.
 */
import type {
  BabyId,
  CallbackId,
  CaregiverId,
  DeliveryId,
  DischargeId,
  DocumentId,
  EncounterId,
  Id,
  ImmunizationId,
  InvestigationId,
  MedDoseId,
  MotherId,
  NoteId,
  PregnancyId,
  PrescriptionId,
  ReferralId,
  SelfLogId,
  StaffId,
  SubjectId,
  TagId,
  TaskId,
  TeamId,
} from './types';

/** What `useLocalSearchParams` hands a screen: a value, a repeated value, or nothing. */
export type RouteParam = string | string[] | undefined;

/** The first value of a route param ('' when missing), so a lookup by it simply finds nothing. */
export const paramValue = (raw: RouteParam): string => (Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''));

const brand =
  <T extends Id>() =>
  (raw: RouteParam): T =>
    paramValue(raw) as T;

export const asMotherId = brand<MotherId>();
export const asPregnancyId = brand<PregnancyId>();
export const asBabyId = brand<BabyId>();
/** A record id that may be a pregnancy or a baby (tags, notes, discharge checklists). */
export const asSubjectId = brand<SubjectId>();
export const asTagId = brand<TagId>();
export const asEncounterId = brand<EncounterId>();
export const asVisitId = asEncounterId;
export const asTaskId = brand<TaskId>();
export const asInvestigationId = brand<InvestigationId>();
export const asReferralId = brand<ReferralId>();
export const asCallbackId = brand<CallbackId>();
export const asSelfLogId = brand<SelfLogId>();
export const asDeliveryId = brand<DeliveryId>();
export const asImmunizationId = brand<ImmunizationId>();
export const asDischargeId = brand<DischargeId>();
export const asStaffId = brand<StaffId>();
export const asTeamId = brand<TeamId>();
export const asPrescriptionId = brand<PrescriptionId>();
export const asCaregiverId = brand<CaregiverId>();
export const asNoteId = brand<NoteId>();
export const asMedDoseId = brand<MedDoseId>();
export const asDocumentId = brand<DocumentId>();

/** The id type of each record kind the app mints (`uid(kind)` in the store, `id(kind)` in the demo seed). */
export type IdOf = {
  mo: MotherId;
  pg: PregnancyId;
  bb: BabyId;
  tg: TagId;
  vs: EncounterId;
  nb: EncounterId;
  tk: TaskId;
  iv: InvestigationId;
  rf: ReferralId;
  cb: CallbackId;
  sl: SelfLogId;
  dl: DeliveryId;
  im: ImmunizationId;
  ds: DischargeId;
  cg: CaregiverId;
  nt: NoteId;
  md: MedDoseId;
  cp: DocumentId;
  rx: PrescriptionId;
  st: StaffId;
  tm: TeamId;
  /** Rows the app never reads back by id: audit entries, results, contact attempts, admissions. */
  au: Id;
  rs: Id;
  ct: Id;
  ad: Id;
};
export type IdKind = keyof IdOf;

/** Brands a freshly made id string as the id type of `kind`. */
export const mint = <K extends IdKind>(_kind: K, raw: string): IdOf[K] => raw as IdOf[K];
