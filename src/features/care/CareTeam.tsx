import { useState } from 'react';
import { View } from 'react-native';
import { Controller, useWatch } from 'react-hook-form';
import { Users } from 'lucide-react-native';

import { findDemoAccount } from '@/features/auth/demoAccounts';
import type { CareRole } from '@/features/auth/types';
import { useDb, type DbState } from '@/data/store';
import type { CareAssignment, CareSpecialty, MotherId, SubjectId, TeamRef } from '@/data/types';
import { makeAssignCareSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { isRemote } from '@/lib/supabase';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { useSession } from '@/state/session';
import { AppText, Button, Card, Chip, Field, InfoRow, Section, Sheet, space } from '@/ui';

/** The signed-in clinician as the care-team rules need her: role, staff id and current teams. */
export type CareMe = { role?: CareRole; staffId?: string; teamIds: string[] };

export function useCareMe(): CareMe {
  const account = useSession((s) => s.account);
  // A demo session saved before staff ids existed falls back to the demo directory (mock mode only).
  const care = account?.care?.staffId || isRemote ? account?.care : (findDemoAccount(account?.phone ?? '')?.care ?? account?.care);
  return { role: care?.role, staffId: care?.staffId, teamIds: (care?.teams ?? []).map((t) => t.id) };
}

const SPECIALTY_ROLE: Record<CareSpecialty, CareRole> = { obstetrics: 'obstetrician', paediatrics: 'paediatrician' };
const SPECIALTY_LABEL: Record<CareSpecialty, string> = { obstetrics: 'Obstetric team', paediatrics: 'Paediatric team' };

/**
 * The current assignment of a subject for a specialty. A baby without its own row yet (just delivered, demo mode)
 * shows the paediatric team of its pregnancy.
 */
export function assignmentOf(db: Pick<DbState, 'assignments' | 'babies'>, subjectId: SubjectId, specialty: CareSpecialty): CareAssignment | undefined {
  const own = db.assignments.find((a) => a.subjectId === subjectId && a.specialty === specialty);
  if (own) return own;
  const baby = db.babies.find((b) => b.id === subjectId);
  return baby ? db.assignments.find((a) => a.subjectId === baby.pregnancyId && a.specialty === specialty) : undefined;
}

/** The server's rule (assign_care): a clinician of that specialty, who is the named doctor or on the current team. */
export function canReassign(me: CareMe, a: CareAssignment | undefined): boolean {
  if (!a || me.role !== SPECIALTY_ROLE[a.specialty]) return false;
  return (!!me.staffId && a.staffId === me.staffId) || me.teamIds.includes(a.teamId);
}

/** The server's rule (update_mother): an obstetrician treating her now (named doctor or on her obstetric team). */
export function canEditMother(db: Pick<DbState, 'assignments' | 'pregnancies'>, me: CareMe, motherId: MotherId): boolean {
  if (me.role !== 'obstetrician') return false;
  const pregnancies = new Set(db.pregnancies.filter((p) => p.motherId === motherId).map((p) => p.id as string));
  return db.assignments.some((a) => a.specialty === 'obstetrics' && pregnancies.has(a.subjectId) && canReassign(me, a));
}

/** "OB Unit A · Dr. Priya Rao" — the team, and the named doctor if there is one. */
export function assignmentLabel(db: Pick<DbState, 'teams' | 'staff'>, a: CareAssignment | undefined) {
  if (!a) return undefined;
  const team = db.teams.find((t) => t.id === a.teamId)?.name ?? 'Team';
  const doctor = a.staffId ? db.staff.find((s) => s.id === a.staffId)?.name : undefined;
  return doctor ? `${team} · ${doctor}` : `${team} (no named doctor)`;
}

/**
 * Care-team rows for a pregnancy (obstetric and paediatric) or a baby (paediatric), each with "Change" for the
 * clinicians the server lets reassign it.
 */
export function CareTeamRows({ subjectId, specialties }: { subjectId: SubjectId; specialties: CareSpecialty[] }) {
  const db = useDb();
  const me = useCareMe();
  const [editing, setEditing] = useState<CareSpecialty>();
  const current = editing ? assignmentOf(db, subjectId, editing) : undefined;
  return (
    <>
      {specialties.map((sp) => {
        const a = assignmentOf(db, subjectId, sp);
        return (
          <View key={sp} style={{ gap: 4 }}>
            <InfoRow label={SPECIALTY_LABEL[sp]} value={assignmentLabel(db, a) ?? 'Not assigned'} />
            {canReassign(me, a) && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Chip label={`Change ${sp === 'obstetrics' ? 'obstetric' : 'paediatric'} team`} icon={Users} onPress={() => setEditing(sp)} />
              </View>
            )}
          </View>
        );
      })}
      <Sheet visible={!!editing} onClose={() => setEditing(undefined)} title={editing ? `${SPECIALTY_LABEL[editing]}: reassign` : ''} subtitle="The reason is recorded in the audit trail.">
        {editing && current && <AssignCareForm key={`${subjectId}:${editing}`} subjectId={subjectId} specialty={editing} current={current} onDone={() => setEditing(undefined)} />}
      </Sheet>
    </>
  );
}

/** Choose a unit of the specialty, optionally a doctor of that unit, and the reason. */
function AssignCareForm({ subjectId, specialty, current, onDone }: { subjectId: SubjectId; specialty: CareSpecialty; current: CareAssignment; onDone: () => void }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { busy, once } = useSubmitOnce();
  const { control, handleSubmit, formState, setValue } = useZodForm(makeAssignCareSchema(current), {
    defaultValues: { team: current.teamId, doctor: current.staffId ?? '', reason: '' },
  });
  const team = useWatch({ control, name: 'team' });
  const units: TeamRef[] = db.teams.filter((t) => t.kind === 'unit' && t.specialty === specialty);
  const doctors = db.staff.filter((s) => s.role === SPECIALTY_ROLE[specialty] && db.teamMembers.some((m) => m.teamId === team && m.staffId === s.id));
  const save = handleSubmit(
    once((v) => {
      db.assignCare(subjectId, specialty, v.teamId, v.staffId, v.reason, by, now);
      onDone();
    }),
  );
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="label" tone="secondary">
        Team
      </AppText>
      <Controller
        control={control}
        name="team"
        render={({ field }) => (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {units.map((u) => (
              <Chip
                key={u.id}
                label={u.name}
                variant={field.value === u.id ? 'selected' : 'soft'}
                onPress={() => {
                  field.onChange(u.id);
                  setValue('doctor', '', { shouldValidate: true });
                }}
              />
            ))}
          </View>
        )}
      />
      <AppText variant="label" tone="secondary">
        Named doctor
      </AppText>
      <Controller
        control={control}
        name="doctor"
        render={({ field }) => (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Team (no named doctor)" variant={!field.value ? 'selected' : 'soft'} onPress={() => field.onChange('')} />
            {doctors.map((d) => (
              <Chip key={d.id} label={d.name} variant={field.value === d.id ? 'selected' : 'soft'} onPress={() => field.onChange(d.id)} />
            ))}
          </View>
        )}
      />
      <Controller control={control} name="reason" render={({ field }) => <Field label="Reason (recorded)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="e.g. Covering OPD this week" />} />
      {!!formState.errors.team?.message && (
        <AppText variant="caption" tone="overdue">
          {formState.errors.team.message}
        </AppText>
      )}
      <Button label="Reassign" disabled={!formState.isValid || busy} onPress={save} />
    </View>
  );
}

/** CT-90: the baby's paediatric team, and "Change" for its paediatric team (rendered on the newborn view). */
export function BabyCareTeam({ babyId }: { babyId: SubjectId }) {
  return (
    <Section title="Care team">
      <Card>
        <CareTeamRows subjectId={babyId} specialties={['paediatrics']} />
        <AppText variant="caption" tone="faint" style={{ marginTop: 4 }}>
          Only the baby&apos;s current paediatric team can change it.
        </AppText>
      </Card>
    </Section>
  );
}
