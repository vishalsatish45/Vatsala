/**
 * Private Storage files (voice notes, paper-record photos) are opened only through short-lived signed URLs.
 * Storage grants one only when the row-level policy lets this user read the object
 * (supabase/migrations/20261005000900_storage.sql). The storage key itself is never shown on screen.
 */
import { useQuery } from '@tanstack/react-query';

import { isRemote, supabase } from '@/lib/supabase';

export type Bucket = 'voice-notes' | 'documents';

/** Signed URLs live 5 minutes; the cached one is replaced a minute before it expires. */
const TTL_SECONDS = 300;

export const storageKeys = {
  signedUrl: (bucket: Bucket, key: string) => ['storage', 'signed-url', bucket, key] as const,
};

/** 'voice-notes/<mother>/<id>.m4a' → the object name inside the bucket. */
export function objectName(bucket: Bucket, key: string) {
  return key.startsWith(`${bucket}/`) ? key.slice(bucket.length + 1) : key;
}

export function useSignedUrl(bucket: Bucket, key: string | undefined) {
  return useQuery({
    queryKey: storageKeys.signedUrl(bucket, key ?? ''),
    enabled: isRemote && !!key,
    staleTime: (TTL_SECONDS - 60) * 1000,
    gcTime: TTL_SECONDS * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase().storage.from(bucket).createSignedUrl(objectName(bucket, key!), TTL_SECONDS);
      if (error || !data?.signedUrl) throw new Error('Not available yet');
      return data.signedUrl;
    },
  });
}
