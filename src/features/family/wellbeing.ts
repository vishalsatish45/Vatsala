/**
 * Diet and exercise cards for the Family face ("My diet & exercises"). General health education in the style of the
 * Learn cards (learn.ts): nothing personal, nothing prescriptive — every card sends her back to her own doctor for
 * anything specific. English only for now. Status: DRAFT — pending clinical review by the doctor partner.
 */
import { LEARN, type LearnCard } from './learn';

export type WellbeingCard = LearnCard & { kind: 'diet' | 'exercise' };

export const WELLBEING: WellbeingCard[] = [
  // ── Diet · pregnancy ──
  {
    slug: 'diet-plate',
    kind: 'diet',
    stage: 'pregnancy',
    tone: 'peach',
    icon: 'apple',
    title: 'A balanced plate every day',
    summary: 'Variety, small frequent meals and home-cooked food.',
    body: [
      'Try to include grains (rice, roti, ragi), dal or pulses, vegetables, fruit, and milk or curd every day.',
      'If you eat them, eggs, fish or meat add protein. Cook them well.',
      'Small meals more often can be easier than three large ones, especially if you feel sick or full.',
      'Your doctor may give you advice for your own needs — follow that first.',
    ],
  },
  {
    slug: 'diet-iron',
    kind: 'diet',
    stage: 'pregnancy',
    tone: 'rose',
    icon: 'heart',
    title: 'Foods with iron',
    summary: 'Green leafy vegetables, pulses, ragi and more.',
    body: [
      'Foods with iron include green leafy vegetables, dal and pulses, ragi, and eggs or meat if you eat them.',
      'Fruit such as guava, orange or amla with a meal helps the body take in iron.',
      'Keep tea and coffee away from meal times.',
      'Take the tablets your doctor prescribed exactly as written — food does not replace them.',
    ],
  },
  {
    slug: 'diet-water-safety',
    kind: 'diet',
    stage: 'pregnancy',
    tone: 'lavender',
    icon: 'shield',
    title: 'Clean water and safe food',
    summary: 'Boiled or filtered water, washed and well-cooked food.',
    body: [
      'Drink plenty of clean water — boiled or filtered.',
      'Wash fruit and vegetables well; eat food freshly cooked and hot.',
      'Avoid raw or half-cooked eggs and meat, and unboiled milk.',
    ],
  },
  {
    slug: 'diet-avoid',
    kind: 'diet',
    stage: 'pregnancy',
    tone: 'peach',
    icon: 'shield',
    title: 'Things to keep away from',
    summary: 'Alcohol, tobacco and medicines not from your doctor.',
    body: [
      'No alcohol, smoking, gutka or chewing tobacco.',
      'Keep tea and coffee to a little each day.',
      'Do not take any medicine, tonic or herbal product unless your doctor has prescribed it.',
    ],
  },
  // ── Diet · after birth ──
  {
    slug: 'diet-after-birth',
    kind: 'diet',
    stage: 'afterBirth',
    tone: 'peach',
    icon: 'apple',
    title: 'Eating well after birth',
    summary: 'Regular meals and plenty of water help you recover.',
    body: [
      'Eat regular meals with grains, dal, vegetables, fruit and milk or curd.',
      'Drink plenty of clean water through the day.',
      'Keep taking any tablets your doctor prescribed for after the birth.',
    ],
  },
  {
    slug: 'diet-breastfeeding',
    kind: 'diet',
    stage: 'afterBirth',
    aboutBaby: true,
    tone: 'rose',
    icon: 'milk',
    title: 'Food and water while breastfeeding',
    summary: 'A little more food, and water at every feed.',
    body: [
      'Many mothers feel more hungry while breastfeeding — a little more food through the day helps.',
      'Keep a glass of water near you when you feed your baby.',
      'Ask your doctor before taking any medicine or herbal product while breastfeeding.',
    ],
  },
  // ── Exercise · pregnancy ──
  {
    slug: 'exercise-walking',
    kind: 'exercise',
    stage: 'pregnancy',
    tone: 'lavender',
    icon: 'sun',
    title: 'Gentle walking',
    summary: 'A short walk most days, at a comfortable pace.',
    body: [
      'A gentle walk most days can help you feel more active. Walk at a pace where you can still talk.',
      'Wear comfortable footwear and walk on even ground, in the cooler part of the day.',
      'Rest whenever you feel tired. Ask your doctor before starting any new exercise.',
    ],
  },
  {
    slug: 'exercise-breathing',
    kind: 'exercise',
    stage: 'pregnancy',
    tone: 'rose',
    icon: 'heart',
    title: 'Breathing and relaxing',
    summary: 'A few calm minutes of slow breathing.',
    body: [
      'Sit comfortably with your back supported.',
      'Breathe in slowly through your nose, then breathe out slowly through your mouth. Repeat a few times.',
      'This can help you relax, and is useful to practise before labour.',
    ],
  },
  {
    slug: 'exercise-posture',
    kind: 'exercise',
    stage: 'pregnancy',
    tone: 'peach',
    icon: 'bed',
    title: 'Back care and rest',
    summary: 'Sitting, lifting and lying comfortably.',
    body: [
      'Sit with your back supported and your feet on the floor or a small stool.',
      'To pick something up, bend your knees rather than your back, and avoid lifting heavy loads.',
      'Many women find lying on their side with a pillow between the knees comfortable later in pregnancy.',
    ],
  },
  {
    slug: 'exercise-pelvic-floor',
    kind: 'exercise',
    stage: 'pregnancy',
    tone: 'lavender',
    icon: 'heart',
    title: 'Pelvic floor exercises',
    summary: 'Gentle squeezes you can do anywhere.',
    body: [
      'Gently squeeze the muscles you would use to stop passing urine, hold for a few seconds, then relax.',
      'Repeat a few times, a few times a day. Do not hold your breath.',
      'You can continue these after your baby is born. Ask your doctor or nurse to show you how.',
    ],
  },
  {
    slug: 'exercise-stop',
    kind: 'exercise',
    stage: 'pregnancy',
    tone: 'rose',
    icon: 'shield',
    title: 'When to stop',
    summary: 'Stop and get help if something feels wrong.',
    body: [
      'Stop exercising and rest if you feel dizzy, short of breath or unwell.',
      'If you have bleeding, pain in your belly, leaking fluid, or your baby is moving less, go to the hospital now or call 108.',
    ],
  },
  // ── Exercise · after birth ──
  {
    slug: 'exercise-after-birth',
    kind: 'exercise',
    stage: 'afterBirth',
    tone: 'lavender',
    icon: 'sun',
    title: 'Moving again after birth',
    summary: 'Short walks, rest and gentle pelvic floor exercises.',
    body: [
      'Start with short, gentle walks around the house and rest often.',
      'Pelvic floor exercises can be started again gently.',
      'After a caesarean birth, ask your doctor before doing anything more than walking.',
    ],
  },
];

/** Any article the Family face can open (Learn, diet, exercise) by its slug. */
export function findArticle(slug: string): LearnCard | undefined {
  return LEARN.find((c) => c.slug === slug) ?? WELLBEING.find((c) => c.slug === slug);
}

/**
 * The diet or exercise cards for where she is now: pregnancy cards while pregnant (or before any birth), recovery
 * cards after a birth, and baby-care cards (breastfeeding) only when a living baby is shared with this account.
 */
export function wellbeingFor(kind: WellbeingCard['kind'], opts: { birthHappened: boolean; withBaby: boolean }): WellbeingCard[] {
  return WELLBEING.filter(
    (c) => c.kind === kind && (opts.birthHappened ? c.stage === 'afterBirth' : c.stage === 'pregnancy') && (!c.aboutBaby || opts.withBaby),
  );
}
