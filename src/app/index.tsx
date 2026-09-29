import { Redirect } from 'expo-router';

import { homeHref, useSession } from '@/state/session';

export default function Index() {
  const account = useSession((s) => s.account);
  const face = useSession((s) => s.face);
  return <Redirect href={homeHref({ account, face })} />;
}
