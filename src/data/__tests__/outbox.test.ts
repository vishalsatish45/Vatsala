import { uploadPath } from '../outbox';

jest.mock('@/lib/supabase', () => ({ isRemote: false, supabase: () => undefined }));
jest.mock('@/lib/secureStorage', () => ({ secureStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));

const m = '00000000-0000-4000-8003-000000000001';
const cb = '00000000-0000-4000-8070-0000000000c1';

describe('uploadPath', () => {
  it('takes the server-chosen path from the response, without the bucket', () => {
    expect(uploadPath({ bucket: 'voice-notes', pathFrom: 'voice_path' }, { callback_id: cb, voice_path: `voice-notes/${m}/${cb}.m4a` })).toBe(`${m}/${cb}.m4a`);
    expect(uploadPath({ bucket: 'documents', pathFrom: 'storage_path' }, { document_id: cb, storage_path: `documents/${m}/${cb}.jpg` })).toBe(`${m}/${cb}.jpg`);
  });

  it('names nothing to upload when the response has no path', () => {
    expect(uploadPath({ bucket: 'documents', pathFrom: 'storage_path' }, { document_id: cb, storage_path: null })).toBeUndefined();
    expect(uploadPath({ bucket: 'voice-notes', pathFrom: 'voice_path' }, null)).toBeUndefined();
    expect(uploadPath({ bucket: 'voice-notes', pathFrom: 'voice_path' }, { voice_path: 42 })).toBeUndefined();
  });
});
