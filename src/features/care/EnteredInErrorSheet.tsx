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
 * "Remove this record": a recorded fact is never deleted or edited in place; it is marked
 * entered in error with who, when and why, and leaves every view (the audit trail keeps it). A reason is required.
 * Reached from a record's edit screen or sheet (tap the record), never from a chip on the list.
 * `onDone`: after the removal is queued (e.g. leave the edit screen of the removed record).
 */
export function EnteredInErrorSheet({ target, onClose, onDone }: { target?: EieTarget; onClose: () => void; onDone?: () => void }) {
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
      title="Remove this record"
      subtitle={target?.label}
      footer={
        <Button
          label="Remove (entered in error)"
          disabled={!reasonOk(reason) || busy}
          onPress={() => {
            if (!target || !reasonOk(reason)) return;
            once(() => {
              markEnteredInError(target.kind, target.id, reason, by, new Date());
              close();
              onDone?.();
            })();
          }}
        />
      }
    >
      <AppText tone="secondary">
        The entry is marked entered in error and leaves the record and every view. Who did it, when and why are kept in the audit trail. This cannot be undone.
      </AppText>
      <OptionChips label="Reason" options={COMMON} value={COMMON.includes(reason) ? reason : undefined} onChange={(v) => setReason(v ?? '')} />
      <Field label="Reason (required)" value={reason} onChangeText={setReason} placeholder="e.g. Entered on the wrong patient" />
    </Sheet>
  );
}
