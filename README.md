# Vatsala

**Mother–baby continuity of care, from pregnancy to the baby's second birthday.**
Health-a-thon 2026 · Maternal & Child Health track

In maternal and child health, care often slips through the gaps between visits rather than inside them. A
routine test is skipped because the record is on paper, a missed visit goes unnoticed, a referral is never
closed, or the baby's vaccines drift after discharge. Vatsala makes sure that everything planned for a
mother and her baby actually happens.

One Android app, two faces:

- **Care Team** (obstetricians, paediatricians, specialists): a worklist of what is overdue or due now
  (call-backs, missed visits, results to review, open referrals), a one-screen patient view, visit
  recording, delivery and discharge, referrals between departments, and a timeline that splits into mother
  and baby lanes after the birth.
- **Family** (the mother and the caregivers she chooses): her next step, her visit schedule and what to bring,
  her baby's vaccine card, warning signs to watch for, and "ask the hospital to call me". Available in
  English, Kannada and Hindi.

### What it deliberately does not do

No diagnosis, no treatment advice, no risk scoring and no interpretation of clinical values. **Clinicians**
set the risk tags, and the app makes sure the follow-up they chose actually happens. Colours mark task status
(due, done, missed), never a clinical value. AI features only draft text (a consultation brief, a
transcription of a paper record) that the clinician checks and confirms.

All patient data is **synthetic**.

## Try it

Install the APK on an Android phone (64-bit, internet needed), then log in with a demo number and the code
**123456**:

| Number | Who | Face |
|---|---|---|
| 9000000001 | Dr. Priya Rao, obstetrician | Care Team |
| 9000000002 | Dr. Arjun Menon, paediatrician | Care Team |
| 9000000007 | Dr. Kiran Shah, cardiology | Care Team (referrals) |
| 9000000003 | Lakshmi K, pregnant | Family |
| 9000000004 | Ravi K, Lakshmi's husband | Family (caregiver) |
| 9000000006 | Meena T, recently delivered | Family |
| 9000000005 | Dr. Meera S, a doctor who is also pregnant | Both |

**The full loop:** as Lakshmi, tap **+** → *Ask the hospital to call me* → Send. Sign out, log in as
Dr. Priya, and the call-back is at the top of her worklist.

More in [DEMO_GUIDE.md](DEMO_GUIDE.md) and the screen-by-screen journey in [flow.md](flow.md).

## How it's built

| Layer | |
|---|---|
| App | Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript |
| State & data | Zustand, TanStack Query, an offline outbox with idempotency keys, Zod-validated responses |
| Backend | Supabase (Postgres, phone OTP auth, row-level security, Realtime, Storage, Edge Functions, pg_cron) |
| Schedules | `shared/domain/`: pure, dependency-free date arithmetic for ANC, postnatal and India UIP vaccine schedules, fully unit-tested |
| AI drafts | Edge Functions that send de-identified facts to an LLM and return cited drafts for clinician review |

Every write goes through a database function that checks the caller's role and access to that patient.
Visibility is enforced by row-level security in Postgres, not by the app. Database behaviour is covered by
SQL tests in `supabase/tests/`.

```
src/app/          screens (expo-router): (auth), care/ (Care Team face), family/ (Family face)
src/features/     feature code    src/ui/  design system    src/locales/  en · kn · hi
shared/domain/    schedule arithmetic (pure TS, 100% tested)
supabase/         migrations, Edge Functions, seed, SQL tests
```

## Run from source

```bash
npm install
cp .env.example .env      # EXPO_PUBLIC_AUTH_MODE=mock runs entirely on the phone with demo accounts
npm run android           # builds the dev app and installs it on a USB-connected Android phone
npm test                  # unit tests  ·  npm run typecheck
```

## Documents

- [PRD.md](PRD.md): product requirements, scope guardrails and features
- [DESIGN.md](DESIGN.md): design system and screen map
- [flow.md](flow.md): the care journey, screen by screen
