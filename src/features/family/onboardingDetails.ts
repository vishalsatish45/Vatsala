/**
 * ON-03 "Your details", shown BEFORE consent. In Supabase mode her record is not loaded yet (family_context answers
 * PT404 until the notice is accepted), so the step reads the small pre-consent function `family_onboarding_info`
 * (20261005001050): her name, the signed-in person's own number, the hospital and doctor's names, and — mother only —
 * her MCH id and EDD. Nothing clinical. The demo (mock mode) shows the same from the on-device seed.
 */
import { useQuery } from '@tanstack/react-query';

import { loadOnboardingDetails, RemoteError, type OnboardingDetails } from '@/data/remote';
import { useDb } from '@/data/store';
import { familyWho } from '@/data/sync';
import { isRemote, supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';

import { useFamily } from './useFamily';

export const onboardingKeys = {
  details: (accountId: string) => ['family', 'onboarding-details', accountId] as const,
};

export type ShownDetails = OnboardingDetails & {
  /** The signed-in person's name (the caregiver's own, or hers). */
  name: string;
  /** Demo only: the seed has her emergency contact; the pre-consent read does not send it. */
  emergency?: string;
};

export type DetailsState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  /** The server does not let this account see her (a caregiver the mother removed): no retry loop. */
  | { status: 'noAccess' }
  | { status: 'ready'; details: ShownDetails };

export function useOnboardingDetails(): DetailsState {
  const account = useSession((s) => s.account);
  const { mother, pregnancy, isCaregiver, accountName } = useFamily();
  const hospitalName = useDb((s) => s.hospital?.name);
  const q = useQuery({
    queryKey: onboardingKeys.details(account?.id ?? ''),
    enabled: isRemote && !!account?.family,
    queryFn: () => loadOnboardingDetails(supabase(), familyWho(account!)),
    staleTime: 60_000,
    // "Not visible" will not change by asking again.
    retry: (n, e) => !(e instanceof RemoteError && e.code === 'PT404') && n < 2,
  });

  if (!isRemote) {
    const role = isCaregiver ? 'caregiver' : 'mother';
    const ec = mother?.emergencyContact;
    return {
      status: 'ready',
      details: {
        role,
        name: isCaregiver ? accountName : (mother?.name ?? ''),
        motherName: mother?.name ?? account?.family?.motherName ?? '',
        phone: (isCaregiver ? account?.phone : mother?.phone) || undefined,
        mchId: isCaregiver ? undefined : pregnancy?.mchId || undefined,
        hospitalName,
        doctorName: pregnancy?.assignedDoctor?.name,
        // The EDD may not be recorded yet (dating comes later from the doctor).
        edd: !isCaregiver && pregnancy?.edd ? pregnancy.edd : undefined,
        emergency: !isCaregiver && ec?.name ? `${ec.name} · ${ec.phone}` : undefined,
      },
    };
  }
  if (q.data) return { status: 'ready', details: { ...q.data, name: q.data.role === 'caregiver' ? accountName : q.data.motherName } };
  if (q.error instanceof RemoteError && q.error.code === 'PT404') return { status: 'noAccess' };
  if (q.isError) return { status: 'error', retry: () => void q.refetch() };
  return { status: 'loading' };
}
