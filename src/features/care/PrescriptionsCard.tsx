import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Pill, Plus } from 'lucide-react-native';

import { reasonOk } from '@/data/payloads';
import { useDb } from '@/data/store';
import type { DoseSlot, Id, Prescription } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, Field, OptionChips, Sheet, SyncBadge, palette, space } from '@/ui';

const SLOT_LABEL: Record<DoseSlot, string> = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };
export const slotsLabel = (slots: DoseSlot[]) => slots.map((s) => SLOT_LABEL[s]).join(' · ');

const STOP_REASONS = ['Course completed', 'Changed by clinician', 'Entered in error'];

/**
 * Active prescriptions of one subject (a pregnancy or a baby), as the clinician entered them, with Stop. Only these
 * drive the family's medicine reminders; the app never suggests a medicine.
 */
export function PrescriptionsCard({ subjectId, kind, canWrite = true }: { subjectId: Id; kind: 'pregnancy' | 'baby'; canWrite?: boolean }) {
  const prescriptions = useDb((s) => s.prescriptions);
  const stopMedication = useDb((s) => s.stopMedication);
  const by = useActor();
  const now = useNow();
  const [stopping, setStopping] = useState<Prescription>();
  const [reason, setReason] = useState('');
  // One stop per medicine: the lock is per prescription (the sheet is reused).
  const { busy, once } = useSubmitOnce(stopping?.id ?? '');
  const mine = prescriptions.filter((p) => (kind === 'baby' ? p.babyId === subjectId : p.pregnancyId === subjectId));
  const close = () => {
    setStopping(undefined);
    setReason('');
  };

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pill size={16} color={palette.rose600} />
        <AppText variant="headline" style={{ flex: 1 }}>
          Prescriptions
        </AppText>
        {canWrite && <Chip label="Prescribe" icon={Plus} onPress={() => router.push({ pathname: '/care/rx/[id]', params: { id: subjectId } })} />}
      </View>
      {mine.length === 0 && <AppText tone="secondary">No active prescriptions.</AppText>}
      {mine.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyMedium">{[p.name, p.dose].filter(Boolean).join(' · ')}</AppText>
            <AppText variant="caption" tone="secondary">
              {[slotsLabel(p.slots), p.instructions].filter(Boolean).join(' · ')}
            </AppText>
            <SyncBadge id={p.id} />
          </View>
          {canWrite && <Chip label="Stop" onPress={() => setStopping(p)} />}
        </View>
      ))}
      <AppText variant="caption" tone="faint">
        As prescribed by the clinician. These drive the family’s medicine reminders.
      </AppText>

      <Sheet
        visible={!!stopping}
        onClose={close}
        title={`Stop ${stopping?.name ?? ''}`}
        subtitle="The family’s reminders for this medicine stop."
        footer={
          <Button
            label="Stop medicine"
            disabled={!reasonOk(reason) || busy}
            onPress={() => {
              if (!stopping || !reasonOk(reason)) return;
              once(() => {
                stopMedication(stopping.id, reason, by, now);
                close();
              })();
            }}
          />
        }
      >
        <OptionChips label="Reason" options={STOP_REASONS} value={STOP_REASONS.includes(reason) ? reason : undefined} onChange={(v) => setReason(v ?? '')} />
        <Field label="Reason (required)" value={reason} onChangeText={setReason} placeholder="Why the medicine is stopped" />
      </Sheet>
    </Card>
  );
}
