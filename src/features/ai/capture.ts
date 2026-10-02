/**
 * Paper-record capture in Supabase mode: the photo has to be on the server before Claude can read it, so this runs
 * straight away rather than through the outbox — open the document (the server names the photo's path), upload the
 * photo, then ask `capture-transcribe` for the fields. Every field comes back unconfirmed; saving later only confirms.
 */
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';

import { asDocumentId } from '@/data/ids';
import { sendUpload, uploadPath } from '@/data/outbox';
import { photoMime } from '@/data/store';
import type { CaptureField, DocumentId, PregnancyId } from '@/data/types';
import { supabase } from '@/lib/supabase';

import { AiError, transcribe } from './remote';

const opened = z.strictObject({ document_id: z.guid(), storage_path: z.string().min(1) });

export async function captureAndTranscribe(pregnancyId: PregnancyId, uri: string): Promise<{ documentId: DocumentId; fields: CaptureField[] }> {
  const id = randomUUID();
  const mime = photoMime(uri);
  const res = await supabase().rpc('create_document', { p: { idempotency_key: randomUUID(), id, pregnancy_id: pregnancyId, kind: 'anc_card', mime } });
  if (res.error) throw new AiError(res.error.message, res.error.code ?? 'PT500');
  const doc = opened.safeParse(res.data);
  if (!doc.success) throw new AiError('Unexpected reply from the server.', 'contract');
  const upload = { bucket: 'documents', pathFrom: 'storage_path', localUri: uri, contentType: mime } as const;
  const path = uploadPath(upload, doc.data);
  if (!path) throw new AiError('The server named no place for the photo.', 'contract');
  const up = await sendUpload({ ...upload, path });
  if (up.status !== 200) throw new AiError(up.message || 'The photo could not be uploaded.', String(up.status));
  return { documentId: asDocumentId(id), fields: await transcribe(id) };
}
