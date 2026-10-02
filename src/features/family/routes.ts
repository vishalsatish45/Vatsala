/**
 * Every Family route besides onboarding, (tabs) and no-access. `src/app/family/_layout.tsx` puts them all behind
 * consent; a route file missing from this list would open without it (a test checks the list against the files).
 */
export const FAMILY_ROUTES = [
  'callback',
  'card',
  'caregiver',
  'consent',
  'day/[ids]',
  'item/[id]',
  'learn/[slug]',
  'log',
  'medicines',
  'newborn-guide',
  'notifications',
  'profile',
  'settings',
  'signs',
  'test/[id]',
] as const;
