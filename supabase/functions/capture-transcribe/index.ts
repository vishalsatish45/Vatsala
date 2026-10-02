// capture-transcribe (PRD F-31). POST { document_id }
//
// The app has uploaded a photo (or PDF) of a paper ANC card to the private `documents` bucket and created the
// documents row. As the calling clinician (their JWT → RLS and Storage policies) this reads the row and the file,
// asks Claude to copy ONLY the known ANC-card fields exactly as written, keeps allowlisted keys only, saves them
// to documents.fields through save_capture_draft (every field unconfirmed) and returns them. The clinician
// confirms field by field in the app; nothing enters the record unconfirmed.
//
// Exception: the photo itself may show her name or number (a picture cannot be de-identified
// here). Only allowlisted field values come back, anything that looks like an identifier is dropped, and the
// demo uses synthetic cards only.
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import { CAPTURE_SCHEMA, CAPTURE_SYSTEM, cleanCaptureFields } from '../_shared/ai.ts';
import { HttpError, UUID, askClaude, callerClient, fail, fromDb, json, readJson } from '../_shared/http.ts';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MAX_BYTES = 5 * 1024 * 1024; // the Messages API's per-image limit

Deno.serve(async (req) => {
  try {
    const body = await readJson(req, ['document_id']);
    const documentId = body.document_id;
    if (typeof documentId !== 'string' || !UUID.test(documentId)) throw new HttpError(404, 'PT404', 'Document not found');

    const db = await callerClient(req);
    const { data: docs, error } = await db.from('documents').select('id,storage_path,mime,confirmed_at').eq('id', documentId).limit(1);
    if (error) throw fromDb(error);
    const doc = docs?.[0];
    if (!doc) throw new HttpError(404, 'PT404', 'Document not found');
    if (doc.confirmed_at) throw new HttpError(409, 'PT409', 'This document was already confirmed');
    if (!doc.storage_path) throw new HttpError(409, 'PT409', 'The photo has not been uploaded yet');

    // storage_path is server-chosen: documents/<mother_id>/<uuid>.<ext> (bucket name first).
    const path = String(doc.storage_path).replace(/^documents\//, '');
    const { data: file, error: dlError } = await db.storage.from('documents').download(path);
    if (dlError || !file) throw new HttpError(404, 'PT404', 'The photo could not be found');
    if (file.size > MAX_BYTES) throw new HttpError(422, 'PT422', 'The photo is too large (5 MB at most)');
    const mime = String(doc.mime ?? file.type ?? '').toLowerCase();
    const data = encodeBase64(new Uint8Array(await file.arrayBuffer()));

    const source =
      mime === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
        : (IMAGE_TYPES as readonly string[]).includes(mime)
          ? ({ type: 'image', source: { type: 'base64', media_type: mime as (typeof IMAGE_TYPES)[number], data } } as const)
          : null;
    if (!source) throw new HttpError(422, 'PT422', 'Only JPEG, PNG, WebP, GIF photos or PDFs can be transcribed');

    const reply = await askClaude(CAPTURE_SYSTEM, [source, { type: 'text', text: 'Transcribe the ANC card fields from this record.' }], CAPTURE_SCHEMA);
    const fields = cleanCaptureFields(reply.data);

    const { data: saved, error: saveError } = await db.rpc('save_capture_draft', {
      p: { idempotency_key: crypto.randomUUID(), document_id: documentId, fields, model: reply.model },
    });
    if (saveError) throw fromDb(saveError);
    console.log(JSON.stringify({ fn: 'capture-transcribe', fields: fields.length }));
    return json(200, saved);
  } catch (e) {
    return fail('capture-transcribe', e);
  }
});
