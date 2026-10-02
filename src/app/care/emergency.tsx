import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ScanLine, ShieldAlert } from 'lucide-react-native';

import { requestEmergencyAccess } from '@/data/emergency';
import { mchIdIn, reasonOk } from '@/data/payloads';
import { currentPregnancy } from '@/data/selectors';
import { useDb } from '@/data/store';
import { refresh } from '@/data/sync';
import { AppText, Button, Card, Chip, Field, GlassSurface, OptionChips, Screen, TopBar, palette, space } from '@/ui';

const REASONS = ['Emergency in labour room', 'Covering for the treating team', 'Patient transferred in'];

/**
 * Emergency access — "break the glass". For a patient who is not in this clinician's list: the MCH
 * id (typed or scanned) and a reason open her record for at most 24 hours. Every use is audited and visible to her
 * treating team.
 */
export default function EmergencyAccess() {
  const { mch } = useLocalSearchParams<{ mch?: string }>();
  const [code, setCode] = useState(mch ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mchId = mchIdIn(code);

  async function open() {
    if (!mchId || !reasonOk(reason) || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await requestEmergencyAccess(mchId, reason);
      if (!r.ok) return setError(r.message);
      await refresh();
      const s = useDb.getState();
      const pregnancyId =
        r.pregnancyId ?? currentPregnancy(s, r.motherId)?.id;
      if (pregnancyId) router.replace({ pathname: '/care/p/[id]', params: { id: pregnancyId } });
      else setError('Access granted. The record will appear in your patient list in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen blob="none" header={<TopBar back title="Emergency access" />}>
      <GlassSurface strong radius={20} style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderWidth: 1.5, borderColor: palette.lav400 }}>
        <ShieldAlert size={22} color={palette.lav600} />
        <AppText tone="secondary" style={{ flex: 1 }}>
          For a patient who is not in your list. Access lasts at most 24 hours, the reason is recorded, and her treating team can see that you opened the record.
        </AppText>
      </GlassSurface>

      <Card style={{ gap: space.md }}>
        <Field label="MCH ID" value={code} onChangeText={(v) => (setCode(v), setError(undefined))} autoCapitalize="characters" placeholder="MCH-2026-000123" />
        <View style={{ flexDirection: 'row' }}>
          <Chip label="Scan her card" icon={ScanLine} onPress={() => router.replace('/care/scan')} />
        </View>
        <OptionChips label="Reason" options={REASONS} value={REASONS.includes(reason) ? reason : undefined} onChange={(v) => setReason(v ?? '')} />
        <Field label="Reason (required)" value={reason} onChangeText={setReason} multiline placeholder="Why you need this record now" />
        {!!code && !mchId && <AppText tone="overdue">Enter an MCH ID like MCH-2026-000123.</AppText>}
        {!!error && <AppText tone="overdue">{error}</AppText>}
      </Card>

      <Button label="Open record with emergency access" loading={busy} disabled={!mchId || !reasonOk(reason)} onPress={open} />
    </Screen>
  );
}
