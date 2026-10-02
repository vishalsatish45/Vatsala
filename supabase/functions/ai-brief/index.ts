// ai-brief (PRD F-27). POST { pregnancy_id | baby_id, kind: 'brief'|'handoff'|'discharge', today? }
//
//  1. Reads the record as the calling clinician (their JWT → RLS): only what they may see is ever read.
//  2. Composes one fact per source row, de-identifies it (role words for people; no names, phones, ids, places)
//     and gives each a short citation id ([V3] visit, [T2] test …).
//  3. Claude drafts sentences that must cite those ids; sentences with no valid citation, or with interpretive
//     or advice wording, are dropped (supabase/functions/_shared/ai.ts).
//  4. Citations map back to real row ids; the draft is saved through save_ai_draft (status 'unverified') and
//     returned. It enters the record only when the clinician verifies it (verify_ai_draft).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

import { BRIEF_SCHEMA, BRIEF_SYSTEM, DRAFT_KINDS, briefPrompt, filterCited, prepareRecord, type DraftKind, type Identifiers, type RawRecord } from '../_shared/ai.ts';
import { HttpError, UUID, askModel, callerClient, fail, fromDb, json, readJson } from '../_shared/http.ts';

type Row = Record<string, any>;

/** A bounded, explicit-column select through RLS. */
async function rows(q: PromiseLike<{ data: Row[] | null; error: { code?: string; message: string } | null }>): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw fromDb(error);
  return data ?? [];
}

const label = (l: unknown) => (l && typeof l === 'object' && typeof (l as { en?: unknown }).en === 'string' ? (l as { en: string }).en : '');

async function load(db: SupabaseClient, subject: { pregnancyId?: string; babyId?: string }, kind: DraftKind, today: string) {
  const isBaby = !!subject.babyId;
  const subjectId = (subject.pregnancyId ?? subject.babyId)!;
  const col = isBaby ? 'baby_id' : 'pregnancy_id';

  const [preg] = isBaby
    ? [undefined]
    : await rows(db.from('pregnancies').select('id,mother_id,mch_id,registered_on,edd,gravida,para,living,abortions,status,intensity').eq('id', subjectId).limit(1));
  const [baby] = isBaby
    ? await rows(db.from('babies').select('id,mother_id,pregnancy_id,child_id,name,dob,sex,birth_weight_g,ga_at_birth_days,apgar1,apgar5,outcome,intensity').eq('id', subjectId).limit(1))
    : [undefined];
  const subj = preg ?? baby;
  if (!subj) throw new HttpError(404, 'PT404', 'Patient not found');
  const motherId: string = subj.mother_id;
  const pregnancyId: string = preg?.id ?? baby!.pregnancy_id;

  const [
    mothers, caregivers, staff, teams, datings, conditions, allergies, previous, tags, tagCat, encounters, investigations,
    referrals, tasks, callbacks, selfLogs, notes, medications, immunizations, vaccineCat, discharges, deliveries, babies,
    admissions, pickLists,
  ] = await Promise.all([
    rows(db.from('mothers').select('id,name,husband_name,phone,alt_phone,village,district,pincode,age_at_registration').eq('id', motherId).limit(1)),
    rows(db.from('caregivers').select('id,name,phone').eq('mother_id', motherId).limit(20)),
    rows(db.from('staff').select('id,name,role').limit(1000)),
    rows(db.from('teams').select('id,name').limit(500)),
    isBaby ? Promise.resolve([]) : rows(db.from('pregnancy_datings').select('method').eq('pregnancy_id', pregnancyId).eq('is_current', true).limit(1)),
    isBaby ? Promise.resolve([]) : rows(db.from('documented_conditions').select('label').eq('mother_id', motherId).eq('status', 'final').eq('clinical_status', 'active').limit(30)),
    isBaby ? Promise.resolve([]) : rows(db.from('allergies').select('substance').eq('mother_id', motherId).eq('status', 'final').limit(30)),
    isBaby ? Promise.resolve([]) : rows(db.from('previous_pregnancies').select('year,outcome,mode').eq('mother_id', motherId).eq('status', 'final').order('year').limit(20)),
    rows(db.from('tags').select('id,code,note,set_by,set_at').eq(col, subjectId).is('removed_at', null).order('set_at').limit(30)),
    rows(db.from('tag_catalogue').select('code,label').limit(500)),
    rows(db.from('encounters').select('id,kind,at,by_staff,complaints,complaints_note,note').eq(col, subjectId).eq('status', 'final').order('at', { ascending: false }).limit(6)),
    rows(db.from('investigations').select('id,label,status,due_by,sensitive,follow_up').eq(col, subjectId).order('due_by').limit(40)),
    rows(db.from('referrals').select('id,to_team_id,urgency,reason,status,scheduled_at,recommendations,created_at').eq(col, subjectId).order('created_at').limit(20)),
    rows(db.from('tasks').select('id,title,due_by').eq(col, subjectId).is('completed_at', null).is('cancelled_at', null).order('due_by').limit(10)),
    isBaby ? Promise.resolve([]) : rows(db.from('callbacks').select('id,at,signs,closed_at,outcome').eq('mother_id', motherId).order('at', { ascending: false }).limit(10)),
    rows(
      (isBaby ? db.from('self_logs').select('id,at,kind,value').eq('baby_id', subjectId) : db.from('self_logs').select('id,at,kind,value').eq('mother_id', motherId).is('baby_id', null))
        .eq('status', 'final').order('at', { ascending: false }).limit(10),
    ),
    rows(db.from('care_notes').select('id,at,author,body').eq(col, subjectId).eq('kind', 'note').eq('status', 'final').order('at', { ascending: false }).limit(5)),
    rows(db.from('medications').select('id,name,dose,status').eq(col, subjectId).eq('status', 'active').limit(20)),
    rows(db.from('immunizations').select('id,code,due_on,given_on,status').eq(col, subjectId).in('status', ['due', 'given']).order('due_on').limit(30)),
    rows(db.from('vaccine_catalogue').select('code,label').limit(200)),
    kind === 'brief' ? Promise.resolve([]) : rows(db.from('discharges').select('id,completed_at').eq(col, subjectId).limit(5)),
    rows(db.from('deliveries').select('id,at,mode,indication,blood_loss_ml,complications').eq('pregnancy_id', pregnancyId).limit(1)),
    rows(db.from('babies').select('name,child_id').eq('mother_id', motherId).limit(10)),
    rows(db.from('admissions').select('ip_no').eq('mother_id', motherId).limit(10)),
    rows(db.from('pick_lists').select('list,code,label').limit(2000)),
  ]);

  const role = new Map(staff.map((s) => [s.id as string, s.role as string]));
  const roleOf = (id: string) => role.get(id) ?? 'clinician';
  const team = new Map(teams.map((t) => [t.id as string, t.name as string]));
  const tagLabel = new Map(tagCat.map((t) => [t.code as string, label(t.label) || t.code]));
  const vaccine = new Map(vaccineCat.map((v) => [v.code as string, v.label as string]));
  const pick = new Map(pickLists.map((p) => [`${p.list}:${p.code}`, label(p.label)]));
  const anyLabel = (code: string, ...lists: string[]) => lists.map((l) => pick.get(`${l}:${code}`)).find(Boolean) ?? code.replace(/_/g, ' ');

  // Observations and latest results for the rows above (children follow their parent's visibility).
  const encIds = encounters.map((e) => e.id as string);
  const invIds = investigations.map((i) => i.id as string);
  const [observations, obsCodes, results, discharge_items] = await Promise.all([
    encIds.length ? rows(db.from('observations').select('encounter_id,code,value_num,value_text,unit').in('encounter_id', encIds).neq('status', 'entered_in_error').limit(300)) : Promise.resolve([]),
    rows(db.from('observation_codes').select('code,label').limit(500)),
    invIds.length ? rows(db.from('investigation_results').select('investigation_id,value_num,value_text,unit,reported_at').in('investigation_id', invIds).neq('status', 'entered_in_error').order('reported_at', { ascending: false }).limit(200)) : Promise.resolve([]),
    discharges.length ? rows(db.from('discharge_items').select('discharge_id,key,state,reason').in('discharge_id', discharges.map((d) => d.id)).limit(200)) : Promise.resolve([]),
  ]);
  const obsLabel = new Map(obsCodes.map((o) => [o.code as string, o.label as string]));
  const latest = new Map<string, Row>();
  for (const r of results) if (!latest.has(r.investigation_id)) latest.set(r.investigation_id, r);
  const mother = mothers[0] ?? {};

  const raw: RawRecord = {
    kind,
    today,
    pregnancy: preg && {
      id: preg.id, registered_on: preg.registered_on, edd: preg.edd, gravida: preg.gravida, para: preg.para, living: preg.living,
      abortions: preg.abortions, status: preg.status, intensity: preg.intensity, age: mother.age_at_registration ?? null,
      dating_method: datings[0]?.method ?? null,
    },
    baby: baby && {
      id: baby.id, dob: baby.dob, sex: baby.sex, birth_weight_g: baby.birth_weight_g, ga_at_birth_days: baby.ga_at_birth_days,
      apgar1: baby.apgar1, apgar5: baby.apgar5, outcome: baby.outcome, intensity: baby.intensity,
    },
    delivery: deliveries[0]
      ? { ...deliveries[0], complications: (deliveries[0].complications ?? []).map((c: string) => anyLabel(c, 'delivery_complication')) } as RawRecord['delivery']
      : null,
    conditions: conditions.map((c) => c.label),
    allergies: allergies.map((a) => a.substance),
    previous: previous.map((x) => ({ year: x.year, outcome: anyLabel(x.outcome), mode: x.mode && anyLabel(x.mode) })),
    tags: tags.map((t) => ({ id: t.id, label: tagLabel.get(t.code) ?? t.code, set_at: t.set_at, set_by_role: roleOf(t.set_by), note: t.note })),
    visits: encounters.map((e) => ({
      id: e.id, at: e.at, kind: e.kind, by_role: roleOf(e.by_staff), note: e.note,
      complaints: [...(e.complaints ?? []).map((c: string) => anyLabel(c, 'complaint')), ...(e.complaints_note ? [e.complaints_note] : [])],
      observations: observations.filter((o) => o.encounter_id === e.id).map((o) => ({
        label: obsLabel.get(o.code) ?? o.code, value: o.value_num != null ? String(o.value_num) : String(o.value_text ?? ''), unit: o.unit,
      })),
    })),
    tests: investigations.map((i) => {
      const r = latest.get(i.id);
      return {
        id: i.id, label: i.label, status: i.status, due_by: i.due_by, sensitive: i.sensitive, follow_up: i.follow_up,
        result: r ? { value: r.value_num != null ? String(r.value_num) : String(r.value_text ?? ''), unit: r.unit, reported_at: r.reported_at } : null,
      };
    }),
    referrals: referrals.map((x) => ({
      id: x.id, department: team.get(x.to_team_id) ?? 'another department', status: x.status, urgency: x.urgency, reason: x.reason,
      created_at: x.created_at, scheduled_at: x.scheduled_at, recommendations: x.recommendations,
    })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, due_by: t.due_by })),
    callbacks: callbacks.map((c) => ({ id: c.id, at: c.at, signs: (c.signs ?? []).map((s: string) => anyLabel(s, 'warning_sign')), closed_at: c.closed_at, outcome: c.outcome && anyLabel(c.outcome, 'callback_outcome') })),
    selfLogs: selfLogs.map((l) => ({ id: l.id, at: l.at, kind: l.kind, value: l.value, by: 'family' })),
    notes: notes.map((n) => ({ id: n.id, at: n.at, by_role: roleOf(n.author), body: n.body })),
    medications: medications.map((m) => ({ id: m.id, name: m.name, dose: m.dose, status: m.status })),
    vaccines: immunizations.map((v) => ({ id: v.id, label: vaccine.get(v.code) ?? v.code, due_on: v.due_on, given_on: v.given_on, status: v.status })),
    discharges: discharges.map((d) => ({
      id: d.id, completed_at: d.completed_at,
      items: discharge_items.filter((i) => i.discharge_id === d.id).map((i) => ({ label: anyLabel(i.key, 'discharge_item'), state: i.state, reason: i.reason })),
    })),
  };

  // Everything that could identify her or the people around her, scrubbed from any free text that slipped in.
  const ids: Identifiers = {
    mother: [mother.name],
    family: [mother.husband_name, ...caregivers.map((c) => c.name), ...babies.map((b) => b.name)],
    staff: staff.map((s) => s.name),
    places: [mother.village, mother.district, mother.pincode],
    numbers: [preg?.mch_id, baby?.child_id, mother.phone, mother.alt_phone, ...caregivers.map((c) => c.phone), ...babies.map((b) => b.child_id), ...admissions.map((a) => a.ip_no)],
  };
  return { raw, ids };
}

Deno.serve(async (req) => {
  try {
    const body = await readJson(req, ['pregnancy_id', 'baby_id', 'kind', 'today']);
    const pregnancyId = body.pregnancy_id;
    const babyId = body.baby_id;
    if ((pregnancyId == null) === (babyId == null)) throw new HttpError(422, 'PT422', 'Give either pregnancy_id or baby_id');
    if ((pregnancyId != null && (typeof pregnancyId !== 'string' || !UUID.test(pregnancyId))) || (babyId != null && (typeof babyId !== 'string' || !UUID.test(babyId)))) {
      throw new HttpError(404, 'PT404', 'Patient not found');
    }
    const kind = body.kind as DraftKind;
    if (!DRAFT_KINDS.includes(kind)) throw new HttpError(422, 'PT422', 'kind must be brief, handoff or discharge');
    const today = body.today == null ? new Date().toISOString().slice(0, 10) : body.today;
    if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(Date.parse(today))) throw new HttpError(422, 'PT422', 'today must be a date (YYYY-MM-DD)');

    const db = await callerClient(req);
    const { raw, ids } = await load(db, { pregnancyId: pregnancyId as string | undefined, babyId: babyId as string | undefined }, kind, today);
    const { items, map } = prepareRecord(raw, ids);

    const { data, model } = await askModel(BRIEF_SYSTEM, [{ text: briefPrompt(kind, today, items) }], BRIEF_SCHEMA);
    const { kept, dropped } = filterCited(data, map);
    if (!kept.length) throw new HttpError(502, 'PT502', 'The AI draft had no sentence that could be traced to the record. Try again.');

    const { data: draft, error } = await db.rpc('save_ai_draft', {
      p: {
        idempotency_key: crypto.randomUUID(),
        ...(pregnancyId ? { pregnancy_id: pregnancyId } : { baby_id: babyId }),
        kind,
        content: kept,
        model,
      },
    });
    if (error) throw fromDb(error);
    console.log(JSON.stringify({ fn: 'ai-brief', kind, items: items.length, kept: kept.length, dropped }));
    return json(200, { draft, dropped });
  } catch (e) {
    return fail('ai-brief', e);
  }
});
