import type { Account } from './types';

/**
 * Synthetic demo directory used when EXPO_PUBLIC_AUTH_MODE=mock.
 * Hackathon rule: fake data only — these people do not exist.
 */
export const DEMO_OTP = '123456';

const HOSPITAL = 'Demo District Hospital';

export const DEMO_ACCOUNTS: Account[] = [
  {
    id: 'demo-staff-priya',
    phone: '9000000001',
    name: 'Dr. Priya Rao',
    faces: ['care'],
    care: { role: 'obstetrician', department: 'Obstetrics', hospital: HOSPITAL },
  },
  {
    id: 'demo-staff-arjun',
    phone: '9000000002',
    name: 'Dr. Arjun Menon',
    faces: ['care'],
    care: { role: 'paediatrician', department: 'Paediatrics', hospital: HOSPITAL },
  },
  {
    id: 'demo-staff-kiran',
    phone: '9000000007',
    name: 'Dr. Kiran Shah',
    faces: ['care'],
    care: { role: 'specialist', department: 'Cardiology', hospital: HOSPITAL },
  },
  {
    id: 'demo-mother-lakshmi',
    phone: '9000000003',
    name: 'Lakshmi K',
    faces: ['family'],
    family: { role: 'mother', motherName: 'Lakshmi K', hospital: HOSPITAL },
  },
  {
    id: 'demo-caregiver-ravi',
    phone: '9000000004',
    name: 'Ravi K',
    faces: ['family'],
    family: { role: 'caregiver', motherName: 'Lakshmi K', hospital: HOSPITAL },
  },
  {
    id: 'demo-mother-meena',
    phone: '9000000006',
    name: 'Meena T',
    faces: ['family'],
    family: { role: 'mother', motherName: 'Meena T', hospital: HOSPITAL },
  },
  {
    id: 'demo-dual-meera',
    phone: '9000000005',
    name: 'Dr. Meera S',
    faces: ['care', 'family'],
    care: { role: 'obstetrician', department: 'Obstetrics', hospital: HOSPITAL },
    family: { role: 'mother', motherName: 'Dr. Meera S', hospital: HOSPITAL },
  },
];

export function findDemoAccount(phone: string): Account | undefined {
  return DEMO_ACCOUNTS.find((a) => a.phone === phone);
}
