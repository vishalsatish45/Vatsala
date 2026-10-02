import { Suspense, lazy } from 'react';

import { useSignedUrl } from './signedUrl';
import { AppText } from '@/ui';

const VoicePlayer = lazy(() => import('@/features/device/VoicePlayer'));

/** A family voice note stored in the private bucket, played through a 5-minute signed URL. */
export function RemoteVoiceNote({ storageKey, seconds }: { storageKey: string; seconds?: number }) {
  const url = useSignedUrl('voice-notes', storageKey);
  if (url.data) {
    return (
      <Suspense fallback={null}>
        <VoicePlayer uri={url.data} seconds={seconds} />
      </Suspense>
    );
  }
  return (
    <AppText variant="caption" tone="faint">
      {url.isError ? 'Voice note not available yet — it may still be uploading from the family’s phone.' : 'Loading voice note…'}
    </AppText>
  );
}
