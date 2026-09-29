import { Apple, Baby, BedDouble, CalendarCheck, Heart, Milk, ShieldCheck, ShoppingBag, Sun, type LucideIcon } from 'lucide-react-native';

import type { LearnCard } from './learn';

export const LEARN_ICONS: Record<LearnCard['icon'], LucideIcon> = {
  apple: Apple,
  calendar: CalendarCheck,
  bag: ShoppingBag,
  milk: Milk,
  baby: Baby,
  shield: ShieldCheck,
  bed: BedDouble,
  heart: Heart,
  sun: Sun,
};
