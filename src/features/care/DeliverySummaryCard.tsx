import { View } from 'react-native';

import { fmtDay, fmtTime, sexLabel } from '@/data/selectors';
import type { Baby, Delivery } from '@/data/types';
import { BIRTH_PLACES, LABOUR_ONSETS } from '@/features/care/forms';
import { AppText, Card, InfoRow, space } from '@/ui';

const label = <K extends string>(map: Record<string, K>, code?: K) => (code ? Object.keys(map).find((k) => map[k] === code) : undefined);
const yesNo = (v?: boolean) => (v === undefined ? undefined : v ? 'Yes' : 'No');
/** A pick-list list plus its free text for "Other", as documented. */
const withNote = (items: string[], note?: string) => [...items.filter((x) => x !== 'Other'), ...(note ? [note] : [])].join(', ') || undefined;

/**
 * The delivery record as documented (record_delivery): time of birth to the minute, place, labour, mode, perineum,
 * complications, medicines, the mother's condition, and each baby's birth record. Shown as entered — the app makes no
 * statement about any value.
 */
export function DeliverySummaryCard({ delivery: d, babies, title = 'Delivery' }: { delivery: Delivery; babies: Baby[]; title?: string }) {
  return (
    <Card style={{ gap: 2 }}>
      <AppText variant="title" style={{ marginBottom: 4 }}>
        {title}
      </AppText>
      <InfoRow label="Time of birth" value={`${fmtDay(d.at)} · ${fmtTime(d.at)}`} />
      <InfoRow label="Place" value={label(BIRTH_PLACES, d.place)} />
      <InfoRow label="Onset of labour" value={label(LABOUR_ONSETS, d.labourOnset)} />
      <InfoRow label="Mode" value={d.mode || undefined} />
      <InfoRow label="Indication" value={d.indication} />
      <InfoRow label="Blood loss (estimated)" value={d.bloodLossMl != null ? `${d.bloodLossMl} ml` : undefined} />
      <InfoRow label="Perineum" value={d.perineum} />
      <InfoRow label="Complications" value={withNote(d.complications, d.complicationsNote) ?? 'None documented'} />
      <InfoRow label="Medicines in labour" value={withNote(d.medicines, d.medicinesNote) ?? 'None documented'} />
      <InfoRow label="Mother after delivery" value={d.maternalCondition} />
      <InfoRow label="Attended by" value={d.attendedBy} />
      {babies.map((b) => (
        <View key={b.id} style={{ gap: 2, marginTop: space.sm }}>
          <AppText variant="headline">
            {b.childId} · {b.outcome === 'live' ? 'Liveborn' : `Stillborn${b.stillbirthType ? ` (${b.stillbirthType})` : ''}`}
          </AppText>
          <InfoRow label="Sex" value={sexLabel(b.sex)} />
          <InfoRow label="Birth weight" value={b.birthWeightG != null ? `${b.birthWeightG} g` : 'Not recorded'} />
          <InfoRow label="Length" value={b.lengthCm != null ? `${b.lengthCm} cm` : undefined} />
          <InfoRow label="Head circumference" value={b.headCircCm != null ? `${b.headCircCm} cm` : undefined} />
          <InfoRow label="Apgar 1 / 5 min" value={b.apgar1 != null || b.apgar5 != null ? `${b.apgar1 ?? '–'} / ${b.apgar5 ?? '–'}` : undefined} />
          <InfoRow label="Resuscitation given" value={yesNo(b.resuscitation)} />
          <InfoRow label="Birth defects" value={b.birthDefects} />
          {b.outcome === 'live' && <InfoRow label="Breastfed within 1 hour" value={yesNo(b.breastfedWithin1h)} />}
          {b.outcome === 'live' && <InfoRow label="Vitamin K given" value={yesNo(b.vitaminK)} />}
        </View>
      ))}
      <AppText variant="caption" tone="faint" style={{ marginTop: 4 }}>
        As documented in the delivery record.
      </AppText>
    </Card>
  );
}
