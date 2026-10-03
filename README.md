# Vatsala

Vatsala is an Android app that helps a hospital follow a mother and her baby from the first antenatal visit
to the baby's last vaccine at two years. The hospital team and the family use the same app and see the
same plan.

Built for Health-a-thon 2026 (Koita Foundation × IIT Bombay KCDH, with FOGSI), Maternal & Child Health track.

## The problem

Most gaps in maternal and child care aren't about medical knowledge. They come from plans that nobody
follows through:

- An antenatal visit ends and the 24–28 week glucose test was never ordered.
- The obstetrician knows about a previous caesarean, but the resident at the next visit doesn't.
- A cardiology referral goes out on a paper slip and nobody finds out whether it happened.
- A mother who needs close follow-up misses her 34-week visit and no one notices.
- After discharge, the baby's vaccine dates live on a card at home and the hospital loses sight of them.

Vatsala turns every visit, test, referral, discharge item and vaccine into a task with an owner and a due
date. When a task slips, a named person sees it on their worklist.

## What's in the app

When you sign in with your phone number, the app opens one of two views ("faces").

### Care Team (obstetricians, paediatricians, specialists)

- **Worklist:** what's overdue, due today and due this week, including call-back requests and warning signs
  reported by families. Each item opens the screen where you deal with it.
- **Registration:** a three-step form (mother, dating, obstetric history). It issues an MCH ID, plans the
  antenatal visits and tests from the hospital's schedule, assigns the obstetric unit and pre-assigns the
  paediatric unit. A returning mother keeps one record across pregnancies. Registers can also be imported
  from a CSV file.
- **Patient record:** what's still due, the latest documented values, the plan, history, referrals,
  prescriptions and visits. From here you record a visit, enter and review test results, set the
  clinician's tags and follow-up intensity, prescribe, refer, re-date the pregnancy, or change the doctor or
  team (a reason is recorded).
- **Labour room and delivery:** admit with a time and reason, record the birth (up to four babies), and every
  baby gets a child ID, the full vaccine schedule and a paediatric team automatically.
- **Discharge:** separate checklists for the mother and each baby. Completing them schedules the postnatal
  and newborn follow-up visits.
- **Baby care:** observations, vaccine doses with batch and site, and reassignment to a named paediatrician.
- **Referrals and call-backs:** each has an owner and a status until someone closes it.
- **Supporting tools:** emergency access to a patient outside your list (24 hours, with a reason, audited),
  a printable handoff summary, an audit log of who opened a record, and a KPI screen for on-time visit
  completion.

### Family (the mother, and the family members she adds)

- **Home:** her week of pregnancy (or her baby's age), her doctor, and the one next thing to do.
- **Schedule:** every visit and test, with what to bring and how to prepare. "I can't come" tells the
  hospital.
- **My pregnancy / My baby:** her records and her baby's vaccine card.
- **Ask the hospital to call me:** she can tick the warning signs she noticed and add a voice note. The
  request lands on the Care Team's call-back list.
- **Home readings** (BP, weight, baby's movements, contractions) that her team can see, medicine reminders
  from her prescriptions, a newborn guide, and an emergency card with a QR code.
- **Ask:** questions about her own schedule and the education cards. It answers only from her record and
  those cards, gives no medical advice, and tells her to go to the hospital or call 108 if she mentions a
  warning sign.
- **Family members:** she chooses who can see what (visits, baby, readings, results).
- Available in English, Kannada and Hindi.

## What it doesn't do

The hackathon rules exclude diagnosis, treatment advice, clinical decision support, risk scoring and
interpretation of medical data. Vatsala sticks to that:

- Risk is a tag that a clinician chooses. The app never calculates, suggests or changes one.
- Vitals and lab values are shown exactly as recorded, without thresholds or colours. Colours only show
  task status (due, done, missed).
- Warning-sign content is the same fixed education for everyone. A reported sign goes to a person for a
  call back, not to an algorithm.
- The AI features only draft: a consultation brief built from documented facts with a source for every
  line, and a transcription of a photographed paper card. A clinician checks each draft before it's saved.

Every patient in the app is synthetic.

## Try it

You'll need an Android phone (64-bit) with internet. Install the APK, then sign in with one of these numbers
and the code **123456**:

| Number | Who | Opens |
|---|---|---|
| 9000000001 | Dr. Priya Rao, obstetrician | Care Team |
| 9000000002 | Dr. Arjun Menon, paediatrician | Care Team |
| 9000000007 | Dr. Kiran Shah, cardiologist (referrals) | Care Team |
| 9000000003 | Lakshmi K, pregnant | Family |
| 9000000004 | Ravi K, Lakshmi's husband | Family |
| 9000000006 | Meena T, recently delivered | Family |
| 9000000005 | Dr. Meera S, a doctor who is also pregnant | Both |

A five-minute walkthrough:

1. Sign in as **Lakshmi**. Tap the round **+** button, choose *Ask the hospital to call me*, tick a sign and
   send it.
2. Sign out (tap the avatar, top left) and sign in as **Dr. Priya**. Lakshmi's request is at the top of the
   worklist. Open it, call her and close it with an outcome.
3. Open Lakshmi from **Patients**. Look at *Still due*, record a visit, or tap *Admit / record delivery*.
4. After a delivery, sign in as **Dr. Arjun**. The baby is already on his list, with the vaccine schedule.
5. Sign in as **Meena** to see the Family view after a birth: *My baby* and the vaccine card.

Demo builds also include tools under the Care Team profile: move the clock forward to watch visits turn
overdue, simulate going offline, and reset the demo data.

[flow.md](flow.md) walks through every stage screen by screen.

## How it's built

- **App:** Expo SDK 57 / React Native 0.86, Expo Router and TypeScript. State lives in Zustand and TanStack
  Query, and forms use React Hook Form with Zod.
- **Backend:** Supabase (Postgres with row-level security, phone OTP sign-in, Realtime, Storage, Edge
  Functions and pg_cron).
- **Schedules:** antenatal, postnatal and India UIP vaccine dates are plain date arithmetic in
  [`shared/domain/`](shared/domain), with no dependencies and full test coverage.

A few decisions we made early:

- **The database decides who sees what.** Every read goes through row-level security and every write goes
  through a Postgres function. Each function checks the caller's role and access to that specific patient
  before it touches anything. An unknown patient and a forbidden one return the same "not found".
- **Records aren't edited in place.** A wrong entry is marked "entered in error" and replaced, and every
  change is audited.
- **It works on a weak signal.** The app updates the screen straight away and queues the write. The queue is
  encrypted on the phone and retried with a key that stops the same action being applied twice.
- **Notifications say nothing sensitive.** Scheduled jobs send visit and vaccine reminders and escalate call-backs that nobody has picked up.
  Push text never includes names or clinical details.
- **AI only sees de-identified facts.** Names, numbers and result values are removed before anything goes to
  the model, and replies that try to interpret or advise are replaced with "ask the hospital to call you".

```
src/app/         screens: (auth), care/ (Care Team), family/ (Family)
src/features/    feature logic: auth, care, family, ai, sync, push, storage, voice
src/data/        store, Supabase adapters, offline queue
src/ui/          design system
src/locales/     en, kn, hi
shared/domain/   schedule arithmetic
supabase/        migrations, Edge Functions, seed data, SQL tests
```

## Running it locally

```bash
npm install
cp .env.example .env     # AUTH_MODE=mock runs everything on the phone with the demo accounts
npm run android          # builds the dev app and installs it on a USB-connected phone
```

To use a Supabase backend instead, set `EXPO_PUBLIC_AUTH_MODE=supabase` with your project URL and anon key,
then apply `supabase/migrations` and `supabase/seed.sql`.

Tests: `npm test` runs 343 unit tests, `npm run typecheck` checks types, and `supabase/tests/` has 21 SQL test
files for access rules, every database function and the scheduled jobs.

## Not done yet

- WhatsApp and SMS reminders: families can choose them, but only app notifications are sent so far.
- The Kannada and Hindi text, and the health-education content, still need review by native speakers and
  clinicians.
- The APK is signed with a development key. It's fine for testing, but not ready for the Play Store.

## More

- [PRD.md](PRD.md): requirements, scope and features
- [DESIGN.md](DESIGN.md): design system and screen list
- [flow.md](flow.md): the care journey, step by step
