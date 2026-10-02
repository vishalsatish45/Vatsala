import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { ago, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Avatar, Chip, EmptyState, ListRow, Screen, SegmentedPills, StatusBadge, TopBar, space } from '@/ui';

/** CT-40 Call-back queue — newest first; requests where the family ticked a listed sign are pinned (PRD F-25). */
export default function Callbacks() {
  const db = useDb();
  const now = useNow();
  const [view, setView] = useState<'open' | 'closed'>('open');
  const open = db.callbacks.filter((c) => !c.closedAt).sort((a, b) => Number(b.signs.length > 0) - Number(a.signs.length > 0) || b.at.getTime() - a.at.getTime());
  const closed = db.callbacks.filter((c) => c.closedAt).sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime());
  const rows = view === 'open' ? open : closed;

  return (
    <Screen withNav blob="none" header={<TopBar title="Call-backs" />}>
      <AppText variant="display">Families waiting for a call</AppText>
      <SegmentedPills
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: 'Waiting', count: open.length },
          { value: 'closed', label: 'Closed', count: closed.length },
        ]}
      />
      <View style={{ gap: space.sm }}>
        {rows.map((c) => {
          const m = motherOf(db, c.motherId);
          return (
            <ListRow
              key={c.id}
              leading={<Avatar name={m.name} size={40} />}
              title={m.name}
              subtitle={`${c.requestedBy} · ${c.channel === 'whatsapp' ? 'WhatsApp' : 'app'}${c.note ? ` · ${c.note}` : ''}`}
              meta={
                <>
                  <StatusBadge status={c.closedAt ? 'done' : 'due'} label={c.closedAt ? c.outcome ?? 'Closed' : `Waiting ${ago(c.at, now)}`} />
                  {c.signs.length > 0 && <Chip label={`Family reported: ${c.signs.join(', ')}`} variant="tag" />}
                </>
              }
              onPress={() => router.push({ pathname: '/care/callback/[id]', params: { id: c.id } })}
            />
          );
        })}
        {rows.length === 0 && <EmptyState title={view === 'open' ? 'No one waiting' : 'Nothing closed yet'} body="Family call-back requests appear here." />}
      </View>
    </Screen>
  );
}
