import { Suspense, lazy, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { ShieldAlert } from 'lucide-react-native';

import { mchIdIn } from '@/data/payloads';
import { useDb } from '@/data/store';
import { AppText, Button, Card, Chip, Screen, TopBar, space } from '@/ui';

// Lazy so builds without expo-camera keep working elsewhere.
const QrScanner = lazy(() => import('@/features/device/QrScanner'));

/**
 * Scan patient QR (PRD F-28): the mother's emergency card, a baby's ID QR, or any code
 * containing an MCH ID opens the record (after the clinician's own login). A patient who is not in this
 * clinician's list can be opened with emergency access (a reason, at most 24 hours, audited).
 */
export default function ScanPatient() {
  const db = useDb();
  const [msg, setMsg] = useState<string>();
  const [notMine, setNotMine] = useState<string>();
  const handled = useRef(false);

  function onScan(data: string) {
    if (handled.current) return;
    const child = data.match(/MCH-\d{4}-\d{6}-B\d+/)?.[0];
    const mch = mchIdIn(data);
    const baby = child ? db.babies.find((b) => b.childId === child) : undefined;
    const preg = mch ? db.pregnancies.find((p) => p.mchId === mch) : undefined;
    if (baby) {
      handled.current = true;
      return router.replace({ pathname: '/care/b/[id]', params: { id: baby.id } });
    }
    if (preg) {
      handled.current = true;
      return router.replace({ pathname: '/care/p/[id]', params: { id: preg.id } });
    }
    setNotMine(mch);
    setMsg(mch ? `${mch} is not in your patient list.` : 'No patient found for this code.');
  }

  return (
    <Screen blob="none" header={<TopBar back title="Scan patient QR" />}>
      <AppText tone="secondary">Point the camera at the patient’s emergency card, a baby’s ID QR, or a printed MCH ID code.</AppText>
      <Suspense fallback={<AppText>Starting camera…</AppText>}>
        <QrScanner onScan={onScan} />
      </Suspense>
      {!!msg && (
        <Card style={{ gap: space.sm }}>
          <AppText tone="overdue">{msg}</AppText>
          {!!notMine && (
            <Button variant="secondary" icon={ShieldAlert} label="Emergency access to this record" onPress={() => router.push({ pathname: '/care/emergency', params: { mch: notMine } })} />
          )}
        </Card>
      )}
      <View style={{ flexDirection: 'row' }}>
        <Chip label="Patient not in my list" icon={ShieldAlert} onPress={() => router.push('/care/emergency')} />
      </View>
      <View style={{ height: space.md }} />
    </Screen>
  );
}
