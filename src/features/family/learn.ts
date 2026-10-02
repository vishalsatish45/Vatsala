/**
 * Health-education cards (PRD F-47). General, non-diagnostic content drawn from national
 * MCH guidance themes. Status: DRAFT — pending clinical review by the doctor partner.
 * Titles/bodies are English for now; translations follow review.
 */
import { LEARN_TX } from './learnI18n';

export type LearnCard = {
  slug: string;
  stage: 'pregnancy' | 'afterBirth' | 'newborn';
  /** About caring for the baby (feeding …): never pushed when no living baby is shared with this account. */
  aboutBaby?: boolean;
  weeks?: [number, number];
  tone: 'rose' | 'peach' | 'lavender';
  icon: 'apple' | 'calendar' | 'bag' | 'milk' | 'baby' | 'shield' | 'bed' | 'heart' | 'sun';
  title: string;
  summary: string;
  body: string[];
};

export const LEARN: LearnCard[] = [
  {
    slug: 'ifa-nutrition',
    stage: 'pregnancy',
    tone: 'peach',
    icon: 'apple',
    title: 'Eating well & your iron tablets',
    summary: 'Small, frequent meals and the tablets your doctor gave you.',
    body: [
      'Eat a variety of foods every day — grains, dal, green leafy vegetables, fruits, milk or curd, and eggs or meat if you eat them.',
      'Take the iron (IFA) and calcium tablets exactly as your doctor prescribed. Taking them at different times of the day can help.',
      'Drink plenty of clean water.',
      'If tablets upset your stomach, tell your doctor at your next visit — do not stop on your own.',
    ],
  },
  {
    slug: 'why-visits',
    stage: 'pregnancy',
    tone: 'rose',
    icon: 'calendar',
    title: 'Why every hospital visit matters',
    summary: 'Each visit has checks that are due at that stage.',
    body: [
      'At each visit the team checks different things that are due at that week of pregnancy.',
      'Some tests can only be done in a certain window — this app reminds you before the window closes.',
      'If you cannot come, use “I can’t come” so the hospital can give you a new date.',
    ],
  },
  {
    slug: 'birth-preparedness',
    stage: 'pregnancy',
    weeks: [30, 42],
    tone: 'lavender',
    icon: 'bag',
    title: 'Getting ready for delivery',
    summary: 'Plan the place, transport, money and who comes with you.',
    body: [
      'Know which hospital you will go to and how you will get there. Save 108 and the hospital number.',
      'Keep a bag ready: your MCP card, reports, ID, clothes for you and the baby, and sanitary pads.',
      'Decide who will come with you and who will look after the home.',
    ],
  },
  {
    slug: 'rest-support',
    stage: 'pregnancy',
    tone: 'rose',
    icon: 'bed',
    title: 'Rest and family support',
    summary: 'Share the work at home and rest when you can.',
    body: ['Try to rest during the day, lying on your side.', 'Ask family members to help with heavy work.', 'You can add a family member in “Me” so they also get your visit reminders.'],
  },
  {
    slug: 'breastfeeding',
    stage: 'afterBirth',
    aboutBaby: true,
    tone: 'peach',
    icon: 'milk',
    title: 'Breastfeeding in the first days',
    summary: 'Start early and feed often — day and night.',
    body: [
      'Start breastfeeding as soon as possible after birth.',
      'The first thick yellow milk is very good for your baby.',
      'Feed whenever the baby wants, day and night. Ask the hospital for help if feeding is difficult.',
    ],
  },
  {
    slug: 'recovery',
    stage: 'afterBirth',
    tone: 'lavender',
    icon: 'heart',
    title: 'Looking after yourself after delivery',
    summary: 'Rest, eat well and go to your check-ups.',
    body: ['Go to your check-ups after delivery — the app shows the dates.', 'Keep taking the medicines your doctor prescribed.', 'It is common to feel tired. Talk to the hospital if you feel very low.'],
  },
  {
    slug: 'warmth',
    stage: 'newborn',
    tone: 'peach',
    icon: 'sun',
    title: 'Keeping your baby warm',
    summary: 'Skin-to-skin, a cap and socks, and a warm room.',
    body: ['Hold your baby skin-to-skin on your chest.', 'Dress the baby in one more layer than you, with a cap and socks.', 'Do not bathe the baby in the first days unless the hospital advises.'],
  },
  {
    slug: 'cord-care',
    stage: 'newborn',
    tone: 'rose',
    icon: 'baby',
    title: 'Caring for the cord',
    summary: 'Keep it clean and dry.',
    body: ['Keep the cord clean and dry. Do not apply anything on it.', 'Wash your hands before touching the baby.', 'See the warning signs page for when to contact the hospital.'],
  },
  {
    slug: 'vaccines',
    stage: 'newborn',
    tone: 'lavender',
    icon: 'shield',
    title: 'Your baby’s vaccines',
    summary: 'Given free at the hospital on set ages — keep the card safe.',
    body: ['Vaccines are given at birth, 6, 10 and 14 weeks, 9 months and later.', 'The app reminds you before each date.', 'Bring the baby’s vaccine card to every visit.'],
  },
];

/** Article text in the reader's language (kn/hi drafts pending review); falls back to English. */
export function learnText(card: LearnCard, lang: string): { title: string; summary: string; body: string[] } {
  const tx = lang === 'kn' || lang === 'hi' ? LEARN_TX[card.slug]?.[lang] : undefined;
  return tx ?? { title: card.title, summary: card.summary, body: card.body };
}
