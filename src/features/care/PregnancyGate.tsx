import type { ReactNode } from 'react';

import type { PregnancyId } from '@/data/types';
import { useDb } from '@/data/store';
import { AppText, Screen, TopBar } from '@/ui';

/**
 * Renders a pregnancy's screen only once that pregnancy is loaded. While the Care Team data reloads (or after the
 * record leaves this clinician's set) the screen says so instead of crashing on a missing record.
 */
export function PregnancyGate({ id, title, children }: { id: PregnancyId; title: string; children: ReactNode }) {
  const loaded = useDb((s) => s.pregnancies.some((x) => x.id === id));
  if (!loaded)
    return (
      <Screen header={<TopBar back title={title} />}>
        <AppText>Not found.</AppText>
      </Screen>
    );
  return children;
}
