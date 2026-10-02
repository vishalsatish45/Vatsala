import { useState } from 'react';

import { reasonOk } from '@/data/payloads';
import { useDb } from '@/data/store';
import type { EieKind, Id } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Field, OptionChips, Sheet } from '@/ui';

export type EieTarget = { kind: EieKind; id: Id; label: string };

const COMMON = ['Wrong patient', 'Typing error', 'Duplicate entry'];

/**
 * Mark a recorded fact as entered in error: facts are never edited or deleted; the entry is
 * withdrawn with who, when and why, and disappears from every view. A reason is required.
 */
export function EnteredInErrorSheet({ target, onClose }: { target?: EieTarget; onClose: () => void }) {
  const markEnteredInError = useDb((s) => s.markEnteredInError);
  const by = useActor();
  const [reason, setReason] = useState('');
  // One withdrawal per entry: the lock is per target (the sheet is reused for the next entry).
  const { busy, once } = useSubmitOnce(target ? `${target.kind}:${target.id}` : '');
  const close = () => {
    setReason('');
    onClose();
  };
  return (
    <Sheet
      visible={!!target}
      onClose={close}
      title="Mark as entered in error"
      subtitle={target?.label}
      footer={
        <Button
          label="Mark entered in error"
          disabled={!reasonOk(reason) || busy}
          onPress={() => {
            if (!target || !reasonOk(reason)) return;
            once(() => {
              markEnteredInError(target.kind, target.id, reason, by, new Date());
              close();
            })();
          }}
        />
      }
    >
      <AppText tone="secondary">The entry is withdrawn from the record and every view. Who did it, when and why are kept in the audit log. This cannot be undone; record the correct entry again if needed.</AppText>
      <OptionChips label="Reason" options={COMMON} value={COMMON.includes(reason) ? reason : undefined} onChange={(v) => setReason(v ?? '')} />
      <Field label="Reason (required)" value={reason} onChangeText={setReason} placeholder="e.g. Entered on the wrong patient" />
    </Sheet>
  );
}
