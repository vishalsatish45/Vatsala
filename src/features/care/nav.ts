import { router } from 'expo-router';

import type { WorkItem } from '@/data/selectors';
import { useSession } from '@/state/session';

/** Opens the screen that closes a worklist item. */
export function openTarget(t: WorkItem['target']) {
  switch (t.type) {
    case 'callback':
      return router.push({ pathname: '/care/callback/[id]', params: { id: t.id } });
    case 'task':
      return router.push({ pathname: '/care/task/[id]', params: { id: t.id } });
    case 'investigation':
      return router.push({ pathname: '/care/test/[id]', params: { id: t.id } });
    case 'referral':
      return router.push({ pathname: '/care/referral/[id]', params: { id: t.id } });
    case 'pregnancy':
      return router.push({ pathname: '/care/p/[id]', params: { id: t.id } });
    case 'baby':
      return router.push({ pathname: '/care/b/[id]', params: { id: t.id } });
  }
}

/** Display name of the signed-in clinician, recorded on every action (audit). */
export function useActor(): string {
  return useSession((s) => s.account?.name ?? 'Unknown');
}
