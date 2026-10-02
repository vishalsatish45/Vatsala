import { NoAccess } from '@/features/family/NoAccess';
import { useFamily } from '@/features/family/useFamily';

/** A removed caregiver lands here: "no longer shared" and sign out — none of her information (family/_layout.tsx). */
export default function FamilyNoAccess() {
  const { isCaregiver, mother } = useFamily();
  return <NoAccess caregiver={isCaregiver} motherName={mother?.name} />;
}
