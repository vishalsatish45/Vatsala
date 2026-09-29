# [App Name TBD] — Product Requirements Document

**Mother–Baby Continuity-of-Care Assistant**

> **App name: to be decided.** `[App Name TBD]` is a placeholder used throughout this document and in [DESIGN.md](DESIGN.md) until the team picks a name.

| | |
|---|---|
| Version | 0.2 — revised to comply with Health-a-thon 2026 rules |
| Date | 2026-09-28 |
| Hackathon | Health-a-thon 2026 (Koita Foundation × IIT Bombay KCDH, with FOGSI) — **Maternal & Child Health track** |
| Primary user | Doctor / Care Team (obstetricians, paediatricians) · companion app for mothers & caregivers |
| Platform | React Native (Expo), Android-first |
| Login faces | **Care Team** · **Family** (mother + consented caregivers) |
| Status | Draft — design system & screen map in [DESIGN.md](DESIGN.md) |

> **What changed from v0.1:** the automatic risk-scoring engine is removed (clinical risk scoring, clinical decision support and interpretation of medical data are out of scope for the hackathon). Risk is now **tagged by a clinician**; the product's job is to make sure that tag, and everything the clinician planned, is followed through. Added: a measurable KPI, a proposed 60–90-day pilot plan, import from paper, Excel and PDFs, WhatsApp/SMS reminders, caregiver access, and the real hackathon timeline. The pilot plan is a *proposal for the pitch*; nothing about it is set up during the hackathon.

---

## Table of Contents

1. Executive Summary
2. Hackathon Fit & Scope Guardrails
3. First Principles — Why Care Breaks and What the Product Must Do
4. Mission & Core Principles
5. Target Users & Personas
6. Product Structure — Two Login Faces, One Record
7. MVP Scope
8. User Stories
9. Feature Specifications
   - 9A. Shared foundation
   - 9B. Care Team app
   - 9C. Family app (mother & caregiver)
   - 9D. Platform features
10. Care Protocols & Configuration (schedules, checklists, tag catalogue)
11. Data Model
12. Core Architecture & Patterns
13. Technology Stack
14. Developer Workflow (hot reload on phone)
15. Security, Privacy & Configuration
16. API Specification
17. Non-Functional Requirements
18. KPI, Success Criteria & Proposed Pilot
19. Implementation Phases (mapped to the hackathon timeline)
20. Future Considerations
21. Risks & Mitigations
22. Appendix — Glossary, Demo Script, Lessons from fix-my-day

---

## 1. Executive Summary

[App Name TBD] is an **assistive, operational** mobile platform that makes sure nothing planned for a mother and her baby gets lost. It covers pregnancy registration and antenatal care, delivery, postnatal care, newborn follow-up and immunization, and keeps it all as **one continuous, linked record** shared by the hospital care team and the family.

The clinical problem in maternal and child health is often not a lack of knowledge. It's a lack of **follow-through**. ANC visits miss routine checks because records are fragmented. High-risk pregnancies need closer follow-up, but the risk lives in paper notes. Referrals and investigations stall silently. Postnatal and newborn plans don't travel with the family. Mothers don't know when to come next or which warning signs matter. Every one of these is an **operational gap**, not a diagnostic one.

[App Name TBD] has **two login faces in one app**:

- **Care Team** (obstetricians, paediatricians): a prioritised worklist of care gaps, a one-screen "consultation-ready" patient view, ANC visit completeness checklists, clinician-set risk tags that drive follow-up intensity, investigation and referral tracking, a delivery record that automatically creates a linked newborn record, gated discharge checklists, and a follow-up engine that detects and helps recover missed visits.
- **Family** (the mother, plus caregivers she chooses to add): her next step, her visit schedule and what to prepare, her baby's vaccination schedule, simple self-logging and a **call-back request**, clinically reviewed warning-sign education, an emergency card, all in her language. Families without smartphones get the same reminders by **WhatsApp or SMS**.

**Core value proposition:** *"The clinician decides. [App Name TBD] makes sure it happens, from the first ANC visit to the baby's last vaccine."*

**Primary KPI:** the **on-time completion rate of scheduled maternal and newborn visits** (ANC, postnatal, newborn follow-up). In the hackathon it's computed live on the synthetic demo data; after the hackathon it would be measured against a paper-register baseline in a pilot.

**MVP goal:** by the grand finale (28 Nov 2026), a working React Native prototype, demonstrated live on real phones with synthetic data. In it:
1. A clinician registers a pregnancy (or imports it from an Excel register).
2. The clinician completes an ANC visit using the completeness checklist.
3. The clinician tags the pregnancy as high-risk, which tightens its follow-up schedule.
4. A referral and an investigation are tracked to closure.
5. A delivery automatically creates a linked baby record.
6. Discharge generates a postnatal, newborn and vaccination plan that the mother and her caregiver see and act on.
7. A missed visit surfaces on the worklist and is recovered.

---

## 2. Hackathon Fit & Scope Guardrails

### 2.1 Track & use cases covered

Track: **Maternal & Child Health**. [App Name TBD] is an end-to-end connected solution; the rules allow this. It covers all six published use cases for the track:

| Hackathon use case | Facing | Covered by |
|---|---|---|
| ANC visit completeness: *"visit checklists and gap alerts so the clinician sees what is still due before the mother leaves"* | Clinician | F-13 ANC checklist, F-16 investigation schedule, F-12 "still due" panel |
| High-risk pregnancy follow-up: *"tag risk, schedule reviews, and re-engage mothers who drop out of care"* | Clinician | F-14 risk tags, F-22 follow-up engine, F-23 missed-visit recovery |
| Postnatal and newborn handoff: *"clearer handoffs and due-date reminders for mother and baby"* | Clinician | F-18/F-19 linked baby record, F-21 discharge, F-22, F-29 handoff summary |
| Knowing when to come next: *"clear schedules and prep lists in language they understand"* | Patient | F-40 home, F-44 reminders, F-49 WhatsApp/SMS |
| Recognising warning signs: *"simple, visual guidance… educational only, not a diagnostic tool"* | Patient | F-42 warning-signs education + call-back request |
| Newborn care basics at home: *"practical day-by-day support that complements clinical visits"* | Patient | F-43 My Baby, F-47 day-by-day newborn guide |

**Primary user:** Doctor / Care Team. The Family app is the companion that closes the loop.

### 2.2 Out of scope (hackathon rule) and how [App Name TBD] stays clear

| Prohibited | [App Name TBD]'s design |
|---|---|
| Diagnosis | Never. The app records what clinicians document and never labels a condition itself. |
| Treatment recommendations | Never. Medication reminders only reflect prescriptions a clinician entered. |
| Clinical decision support | No suggestions of what to do clinically. The system only tracks **what the clinician already decided** (visits, tests, referrals, discharge items). |
| **Clinical risk scoring** | **No automatic risk levels.** Risk tags are selected by a clinician from a documentation list. The system never computes, suggests or changes a tag. |
| Interpretation of medical data | No thresholds on vitals or lab values. Values are displayed as documented. A result becomes "reviewed" only when a clinician reviews it. |
| Autonomous clinical advice | Patient-facing warning-sign content is **static, clinically reviewed education** that is the same for every user. It is never generated per input. Self-reports go to a **human call-back queue**. |

### 2.3 Required qualities (from "What makes a strong entry") and where they are met

| Quality | Where |
|---|---|
| High-frequency workflow pain | Every ANC/PNC visit, every discharge, every missed appointment |
| Easy for doctors and patients; clear next step | One-screen views; the Family app shows **one** next action |
| Near-term impact on low-cost channels | Android app + WhatsApp/SMS reminders (F-49) |
| Light first-phase integration; works with paper, Excel, PDFs, scans, WhatsApp | F-30 import from Excel/CSV, F-31 photo/PDF capture with AI transcription for clinician confirmation |
| Measurable operational KPI | §18.1 on-time visit completion rate |
| Multilingual & caregiver-friendly | English/Kannada/Hindi; caregivers are first-class users (F-05) |
| Human override on every automated step + audit trail | Every generated task can be edited or cancelled with a reason; every action is audited (F-60) |
| Pilot evidence in 60–90 days | §18.4 proposed pilot (post-hackathon, for the pitch) |
| Fake or anonymised data only | Synthetic dataset only, including in demos (§15.5) |

---

## 3. First Principles — Why Care Breaks and What the Product Must Do

We reduce the problem to its fundamentals. In maternal–child care, preventable harm most often follows one of **five operational failure paths**:

| # | Failure path | Example | What the product must do |
|---|---|---|---|
| 1 | **Routine care not completed** | An ANC visit ends without urine albumin or with the 24–28 week glucose test never ordered | Show *what is still due* before the mother leaves, using the hospital's own protocol |
| 2 | **Known risk not visible to the next person** | The OB knows she had a previous caesarean and high BP; the resident on the next visit doesn't | Let the clinician **tag** risk once, and carry the tag everywhere |
| 3 | **Plan made but not closed** | A cardiology referral is written on a slip; nobody knows if it happened | Every plan becomes a **task with an owner, due window and closure state** |
| 4 | **Patient doesn't return** | A tagged high-risk mother misses her 34-week visit | Detect the *absence* of an expected event and route recovery to a person |
| 5 | **Information lost at a handoff** | The paediatrician re-takes history; postnatal plans never reach home | **Link** records across handoffs (OPD → labour room → paediatrics → home) and give the family a copy of the plan |

None of these need the software to make a clinical judgement. They need the software to **remember, remind, route and reconnect**.

**Five product primitives.** Every feature is built from these:

1. **Record:** an immutable, timestamped fact as documented by a person (a BP value, a result, a delivery). Append-only; corrections supersede.
2. **Tag:** a label a clinician applies (e.g. "Previous caesarean", "High-risk: close follow-up"). Tags are documentation, not computation.
3. **Task:** an obligation with an owner, a due window and a status (scheduled → completed / missed / cancelled). Visits, tests, referrals, discharge items and vaccines are all tasks.
4. **Link:** a relationship that carries context across a handoff (mother ↔ pregnancy ↔ delivery ↔ baby; referral ↔ department; mother ↔ caregiver).
5. **Closure:** an explicit human act that ends a loop, with an audit entry.

**Central invariant:** *No orphan obligations.* Every task either closes or escalates to a person. If something expected doesn't happen, a named person finds out.

**Design constraints**
- **Clinicians have seconds.** A patient's status must be graspable in ~5 seconds: "what's due" before "what happened".
- **Automation must be overridable.** Every generated task can be edited, rescheduled or cancelled with a reason; nothing the system does is final without a human.
- **Families use shared, low-end Android phones or none at all.** Small app, offline reading, regional languages, generic notification text, WhatsApp/SMS fallback.
- **Clinics already have data in paper registers, Excel, PDFs and WhatsApp.** Meet them there: import and capture, don't demand re-typing everything.
- **Hackathon compliance is a hard boundary.** When in doubt, the software tracks and reminds; it doesn't judge.

---

## 4. Mission & Core Principles

**Mission:** Make sure every mother and baby receives the care their clinicians planned, on time, from the first antenatal visit to the last childhood vaccine.

**Core principles**

1. **The clinician decides; the system follows through.** No scoring, no suggestions, no interpretation. The system tracks, reminds and connects.
2. **Continuity over digitisation.** The value is in the connections between stages and people.
3. **One next step.** For the clinician: the next gap to close. For the family: the next thing to do.
4. **Meet the clinic where it is.** Paper, Excel, PDFs, WhatsApp: import and capture, with light integration.
5. **Minimum necessary, fully audited.** Role-based access, consent-driven caregiver sharing, and every important action logged.

---

## 5. Target Users & Personas

### 5.1 Care Team login (one login, role-based)

**Dr. Priya: Obstetrician (consultant / resident)**
- Context: an ANC OPD of 50–80 patients a day, with labour-room calls.
- Needs: see what's still due for this patient before she leaves; see who's tagged high-risk and overdue; know if referrals and results closed.
- Pain: case sheets, lab slips and referral notes scattered; patients silently lost to follow-up.

**Dr. Arjun: Paediatrician / Neonatologist**
- Context: attends deliveries, newborn rounds, and well-baby & immunization clinic.
- Needs: mother's documented history and delivery details at the baby's first exam; which newborns are due or overdue for follow-up and vaccines.
- Pain: re-taking history from a tired mother; newborns lost after discharge.

> Nurses, front-desk / care coordinators and administrators are not MVP personas. The roles `nurse`, `coordinator` and `admin` are reserved in the schema. In the pilot, a **care coordinator** is the natural owner of the missed-visit call list (§18.4).

### 5.2 Family login

**Lakshmi: Pregnant woman / new mother**
- 24 years old, second pregnancy, lives 18 km away, uses a shared ₹8,000 Android phone, prefers Kannada, moderate literacy.
- Needs: when to come next and what to bring; which warning signs matter; baby's vaccine dates; an easy way to ask the hospital to call her.

**Ravi: Caregiver (husband) / Kamala (mother-in-law)**
- Often the person who arranges travel, money and time off, and who reads messages when the mother can't.
- Needs: the same next steps and reminders; the baby's schedule; no access to sensitive clinical details the mother hasn't shared.
- Added **by the mother** (or by a clinician with her consent). Access can be revoked at any time.

**Families without smartphones** are served through WhatsApp/SMS reminders (F-49) linked to the same task list.

---

## 6. Product Structure — Two Login Faces, One Record

```
                          ┌───────────────────────────┐
                          │  [App Name TBD] (one app) │
                          │  Phone number + OTP login │
                          └─────────────┬─────────────┘
                                        │ role resolved server-side
                     ┌──────────────────┴──────────────────┐
                     ▼                                     ▼
          ┌─────────────────────┐              ┌──────────────────────┐
          │      CARE TEAM      │              │        FAMILY        │
          │ obstetrician        │   shared     │ mother               │
          │ paediatrician       │◄──record────►│ caregiver(s) she adds│
          │ (coordinator later) │              │ + WhatsApp/SMS only  │
          └─────────────────────┘              └──────────────────────┘
           documents, tags, plans                sees plan, next step
           closes care gaps                      self-logs, requests call-back
```

**One app with two login faces**: one codebase, one build and one APK for judges. Role enforcement lives in the database.

| Care Team action | Effect for the Family |
|---|---|
| Registers pregnancy | Mother's account pre-created against her phone; first OTP activates it |
| Completes ANC visit, schedules the next | Next step and reminders update (app + WhatsApp/SMS) |
| Orders an investigation | "Test due" with date window and prep instructions |
| Tags "high-risk: close follow-up" | Mother sees "Your doctor wants to see you more often"; visit cadence tightens (tag label not shown) |
| Schedules a referral | "Visit Cardiology OPD, 3 Oct, 11 AM, Block C" |
| Records delivery | "My Baby" appears with birth details and vaccine schedule |
| Completes discharge | Postnatal + newborn plan and medicine reminders appear |

| Family action | Effect for the Care Team |
|---|---|
| Logs home BP / weight / baby feeding | Appears on the timeline as *family-reported*, displayed as entered |
| Requests a call-back (optionally selecting warning signs she noticed) | Item appears in the **call-back queue** for a person to phone her |
| Misses a visit | Appears on the missed-visit recovery list |
| Adds or removes a caregiver | Logged; caregiver access starts or stops |

---

## 7. MVP Scope

Priority key: **P0** = must exist for the finale demo · **P1** = should exist if time allows · **P2** = post-hackathon / pilot phase.

### 7.1 In scope

**Shared**
- ✅ P0 Phone + OTP login for both faces; role resolved server-side
- ✅ P0 Staff pre-provisioning; mother accounts pre-created at registration
- ✅ P0 Family onboarding: language, consent, emergency contact
- ✅ P0 Caregiver access with the mother's consent (add / revoke)
- ✅ P0 Push notifications with privacy-safe text
- ✅ P0 Mother–Baby Continuity Timeline (the "wow" screen)
- ✅ P0 Audit trail, human override with reason on every generated task

**Care Team**
- ✅ P0 Worklist of care gaps (Now / Today / This week)
- ✅ P0 Pregnancy registration with MCH ID, GA/EDD calculation
- ✅ P0 Consultation-ready patient view: one screen, "still due" first
- ✅ P0 ANC visit entry with completeness checklist
- ✅ P0 Clinician risk tags → follow-up intensity
- ✅ P0 Investigation tracker: protocol schedule, due/overdue, result → review task
- ✅ P0 Referral tracker (requested → accepted → scheduled → seen → recommendations → closed)
- ✅ P0 Delivery record → automatically linked newborn record(s)
- ✅ P0 Newborn view with mother's documented history panel
- ✅ P0 Discharge checklist (mother + baby) that gates completion
- ✅ P0 Follow-up engine + missed-visit detection + recovery workflow
- ✅ P0 Immunization tracker (India UIP schedule)
- ✅ P0 Call-back queue for family requests
- ✅ P0 Import pregnancies from Excel/CSV register
- ✅ P1 AI consultation brief / handoff summary (documented facts only, cited, clinician-verified)
- ✅ P1 Photo/PDF capture of paper records → AI transcription into a draft form for clinician confirmation
- ✅ P1 Care-team notes, smart lists, growth measurements

**Family**
- ✅ P0 Home: pregnancy week or baby age + one next action + what to bring
- ✅ P0 My schedule: visits, tests, follow-ups, with prep lists
- ✅ P0 Self-log (home BP, weight, fetal movement, baby feeding/weight) + request a call-back
- ✅ P0 Warning-signs education (static, reviewed, visual) with call buttons
- ✅ P0 My Baby: birth details, vaccine schedule (given / due / overdue)
- ✅ P0 WhatsApp/SMS reminders (sandbox for demo)
- ✅ P1 Emergency card with QR (mother chooses fields)
- ✅ P1 Medicine reminders (from clinician-entered prescriptions)
- ✅ P1 Day-by-day newborn care guide and pregnancy education (English, Kannada, Hindi)
- ✅ P1 App PIN / biometric lock

**Technical**
- ✅ P0 Expo + expo-router + TypeScript strict
- ✅ P0 Supabase (Postgres, Auth, RLS, Realtime, Edge Functions, pg_cron) with migrations and generated types
- ✅ P0 Pure, unit-tested protocol/scheduling module (`shared/domain`)
- ✅ P0 Offline read + offline write queue for visit entries and self-logs
- ✅ P0 Synthetic demo dataset + one-command reseed; dev-only "time travel"
- ✅ P0 Dev-client builds with Fast Refresh; EAS Update to demo phones
- ✅ P0 KPI instrumentation (§18.1) built into the data model from day one

### 7.2 Out of scope

- ❌ **Any automatic risk scoring, threshold-based flags on vitals/labs, triage scoring or clinical suggestions** (hackathon rule, permanent design choice)
- ❌ AI-generated patient advice; AI output shown to families without clinician review
- ❌ Hospital command dashboard and population analytics (P2; pilot KPI report only)
- ❌ Full offline for registration, delivery and discharge transactions
- ❌ HIS / LIS / PACS / ABDM integrations (P2; phase-one integration is import and capture)
- ❌ Production WhatsApp Business API onboarding (sandbox in demo; production in the pilot)
- ❌ Nurse, coordinator and admin personas (roles reserved)
- ❌ Partograph, EPDS screening, developmental milestone assessment
- ❌ iOS build for the demo (the codebase supports it)
- ❌ Real patient data of any kind

---

## 8. User Stories

### Obstetrician

**US-1 Consultation-ready view**
As an obstetrician, I want to open a patient and immediately see what is still due, so that nothing routine is missed before she leaves.
*Example:* "Lakshmi · 32+2 wks · EDD 14 Nov · Tags: Previous caesarean · High-risk: close follow-up. **Still due:** urine albumin (this visit), OGTT (window closed 28+0), anaesthesia review before 36 wks. Last visit 14 Sep. Referral: Cardiology, seen, recommendations documented."
*Acceptance:* The "still due" panel, tags, last visit, open referrals and next appointment are visible on the first screen. Every item has a date.

**US-2 ANC completeness**
As an obstetrician, I want a visit checklist that shows which standard components haven't been recorded, so that I can complete them in the same visit.
*Acceptance:* When she saves with items unrecorded, the app lists them with **Record now / Not done today (reason) / Not applicable**. Nothing blocks her from saving, and every skipped item gets a reason.

**US-3 Tag risk and tighten follow-up**
As an obstetrician, I want to tag a pregnancy as high-risk and choose closer follow-up, so that the team schedules reviews and chases her if she drops out.
*Example:* Tag "Hypertensive disorder (documented)" + intensity "Close: every 2 weeks" → the next five visits are regenerated every 2 weeks; missed-visit grace falls from 7 to 2 days.
*Acceptance:* Only a clinician can set, change or remove tags. Every change records who, when and why.

**US-4 Referral closure**
As an obstetrician, I want to see whether my referral was accepted, scheduled, seen and answered, so that I don't rely on paper slips.
*Acceptance:* Status is visible on the patient view. A referral with no movement in 72 h appears on my worklist.

**US-5 Missed-visit recovery**
As a care team member, I want a list of mothers who missed a scheduled visit, prioritised by the follow-up intensity their clinician set, so that we can call them the same day.
*Example:* "Lakshmi · Close follow-up · visit due 15 Sep · not seen · 3 days · [Call] [WhatsApp reminder] [Reschedule] [Log outcome]".

### Paediatrician

**US-6 Handoff at birth**
As a paediatrician, I want the mother's documented history and delivery details on the newborn's record, so that I don't re-take history.
*Acceptance:* The panel shows the mother's tags, documented conditions, documented test results (as entered), delivery mode and indication, GA at birth and Apgar, each linked to its source.

**US-7 Newborn follow-up list**
As a paediatrician, I want to see which newborns are due or overdue for follow-up visits and vaccines.

### Family

**US-8 Know when to come next**
As a mother, I want to know my next visit, what to bring and how to prepare, in Kannada, so that I don't miss care.
*Example:* "Next: hospital visit · Mon 5 Oct · 10 AM · OPD Block B · Bring: MCP card, last reports · Come without breakfast (sugar test)." The same message arrives on WhatsApp.

**US-9 Warning signs and call-back**
As a mother, I want to learn the warning signs and quickly ask the hospital to call me, so that I get help in time.
*Acceptance:* The warning-signs screen is the same reviewed content for everyone: "If you notice any of these, go to the hospital now or call 108", with call buttons always visible. "Ask the hospital to call me" adds her to the call-back queue with anything she ticked. The app never tells her whether her symptom is serious.

**US-10 Caregiver**
As a mother, I want to add my husband so that he also gets visit reminders and the baby's vaccine dates.
*Acceptance:* She enters his number and chooses what he can see. He logs in with OTP into the Family face. She can remove him at any time.

### Technical

**US-11 Import from register**
As a clinic, we want to upload our existing ANC register in Excel, so that we can start without re-typing every patient.
*Acceptance:* Column mapping, row-level validation, a preview, and a clinician confirming the import. Imported rows are marked `source = import` in the audit.

**US-12 Offline entry**
As a clinician on poor Wi-Fi, I want visit entries to save offline and sync later without duplicates.

---

## 9. Feature Specifications

Each feature lists: **Purpose · Behaviour · Rules & edge cases · Acceptance · Priority**. Every feature that generates something automatically includes a **Human override** line.

### 9A. Shared Foundation

#### F-01 Authentication (Phone + OTP) — P0

- Welcome screen with two doors, **"Family (mother / caregiver)"** and **"Hospital care team"**. This is a UX hint only; the face is decided by the server-side role.
- +91 mobile number → 6-digit OTP (Supabase Auth phone provider). Auto-read on Android; resend after 30 s; rate-limited.
- Routing: `staff` row → Care Team; `mothers.user_id` or `caregivers.user_id` → Family.
- **Unknown number:** "This number isn't registered. Please ask your hospital." No self sign-up; accounts originate from the hospital or a mother's caregiver invite.
- **Person with two roles** (e.g. a pregnant doctor) → face chooser.
- **Demo:** Supabase test numbers with fixed OTPs, so the demo doesn't depend on SMS delivery.
- Sessions: Care Team locks after 10 min idle (PIN/biometric) and requires re-OTP every 12 h. Family sessions persist 30 days, with an optional app lock.

#### F-02 Identity & ID Scheme — P0

- Pregnancy: `MCH-<YYYY>-<6-digit>` (e.g. `MCH-2026-001245`). Every pregnancy gets its own ID.
- Baby: `<pregnancy ID>-B<n>` (e.g. `MCH-2026-001245-B1`; twins `-B2`). The ID itself shows the link.
- Generated server-side in a transaction; never reused; shown with a copy button and a QR on the patient header.

#### F-03 Family Onboarding & Consent — P0

1. Language (English / ಕನ್ನಡ / हिन्दी), shown in each script.
2. Plain-language consent in her language: what's stored, who sees it, how reminders work (app / WhatsApp / SMS), that the app doesn't give medical advice, how to add or remove caregivers. Consent version and timestamp are stored.
3. Confirm name, hospital and emergency contact.
4. Choose reminder channel(s): app notifications / WhatsApp / SMS.
5. Optional app PIN ("recommended if others use this phone").

Declining consent leaves the hospital record unaffected; the app shows only hospital contacts, and the refusal is recorded.

#### F-04 Notifications — P0

- Server push (Expo push → FCM) for events; on-device local notifications for appointment and medicine reminders (these work offline).
- **Privacy:** text never contains clinical details or names. Family: "Reminder: hospital visit tomorrow 10 AM". Care Team: "3 items need attention", with names visible only after unlock.
- Family: visit (1 day before + morning of), test window, vaccine (2 days before + day of), missed visit ("We missed you, please call to reschedule"), referral scheduled.
- Care Team: new call-back requests (immediate), daily 8 AM digest of care gaps, referral status changes.
- Quiet hours 21:00–07:00 for routine family reminders.

#### F-05 Caregiver Access — P0

- **Purpose:** Caregivers are first-class users (hackathon requirement; the social reality in India).
- **Add:** The mother adds a caregiver (name, relation, phone) or asks the clinician to add one; the mother confirms in her app, or verbal consent is recorded by the clinician.
- **Scopes the mother chooses:** schedule & reminders (default on) · baby's vaccines & visits (default on) · self-logs (off) · test status (off). Sensitive results are never shared with caregivers.
- **Caregiver can:** see the next steps, receive reminders, request a call-back on her behalf, and log baby feeding/weight.
- **Revoke:** instant; logged; the caregiver's session is invalidated.
- **Edge cases:** caregiver phone equals the mother's (a shared phone) → no separate account needed; a caregiver for multiple mothers (e.g. a mother-in-law) → switcher.

#### F-06 Mother–Baby Continuity Timeline — P0 (the "wow" feature)

- A vertical timeline with one maternal lane until delivery, then **splitting into two lanes** (mother postnatal · baby), or three for twins.
- Nodes: registration, ANC visits (completeness ring: 9/10 items), tests, referrals, tags applied, delivery, discharge, postnatal visits, newborn visits, vaccines.
- **Future nodes are shown ghosted** ahead of today, so the timeline shows the plan, not just history.
- **Gaps are visible:** a missed visit is a hollow red node; an overdue test is a dashed node.
- Care Team sees full detail with filters. The Family app sees a simplified, friendly version with no tags and no sensitive items.
- Data: server view `timeline_events`.

### 9B. Care Team App

#### F-10 Worklist — P0

Answers "what needs a human today?". Items are **operational care gaps**, grouped by when to act:

| Group | Contents |
|---|---|
| **Now** | Call-back requests from families (newest first; requests where the family ticked a listed warning sign are labelled and pinned) · missed visits for pregnancies the clinician set to "close follow-up" |
| **Today** | Patients scheduled today with items still due · results awaiting review · incoming referrals to accept · other missed visits |
| **This week** | Tests whose window closes within 7 days · stale referrals (> 72 h no movement) · discharge checklists incomplete · vaccines overdue |

- Paediatricians see the newborn equivalents.
- Header counters; realtime updates; search by name, phone, MCH ID or MRN; QR scan.
- Ordering is by **clinician-set follow-up intensity and due date**, never by any computed clinical score.
- **Human override:** any item can be snoozed, reassigned or closed with a reason.

#### F-11 Pregnancy Registration — P0

- **Identity:** name, age/DOB, phone (login), alternate phone, address, MRN, emergency contact, preferred language, reminder channel.
- **Obstetric summary:** G/P/L/A with consistency validation; previous pregnancies (year, outcome, mode + indication, documented complications).
- **Dating:** LMP (certain/uncertain) and/or dating scan. EDD = LMP + 280 days (Naegele) or the scan date as chosen by the clinician. The system **displays both and asks the clinician to pick the EDD source**; it never picks.
- **Documented history:** conditions, allergies, current medicines, previous surgeries, blood group & Rh (if known), height/weight.
- **Risk tags (optional at registration):** see F-14.
- **On save:** MCH ID assigned; the ANC visit schedule and investigation schedule are generated from the hospital protocol for the current GA; tasks created.
- **Late registration:** early-window tests are listed as "due now" (not failures).
- **Existing mother:** phone match → "Start a new pregnancy for Lakshmi?". Only one active pregnancy is allowed.
- **Human override:** generated visits and test windows can be edited, removed or added with a reason.

#### F-12 Consultation-Ready Patient View — P0

One screen, ordered for a busy OPD:
1. **Header:** name, age, MCH ID, G/P/L/A, GA ("32+2"), EDD, blood group, allergies, **clinician tags** (chips), follow-up intensity.
2. **Still due:** checklist items and tests due or overdue for this GA, open review tasks, and referral actions. Each item has "record / order / not done (reason) / N/A".
3. **Since last visit:** new results entered, referral updates, family self-logs and call-back requests, missed visits. This is a list of *events*, not interpretations.
4. **Latest documented values:** BP, weight, fundal height, FHR, Hb, as entered with dates and a simple trend line. No colour-coding or thresholds. Family-reported values carry a "home reading" badge.
5. **Investigations:** scheduled / ordered / resulted / reviewed.
6. **Referrals:** status.
7. **Plan:** next appointment; delivery plan documented (Y/N) for tagged pregnancies from 36 weeks, as a checklist item the hospital configures.
8. **AI consultation brief** (P1, F-27).

Opening the view writes an audit entry.

#### F-13 ANC Visit Entry with Completeness Checklist — P0

- **Fields:** date, GA (auto), weight, BP, pulse, pallor, oedema, fundal height, FHR, presentation (≥32 wks), fetal movements (as reported), urine albumin & sugar, complaints, IFA/calcium dispensed, Td dose, counselling given, advice, next visit (pre-filled from the schedule, editable).
- **Completeness checklist:** the hospital configures which components are expected at each visit (§10.2). The checklist shows ✓ for recorded items and ○ for missing ones. On save, missing items are listed with **Record now / Not done today + reason / N/A**.
- **No interpretation:** values are stored and displayed as entered. Sanity limits reject impossible entries (e.g. BP 900) purely for data quality.
- Fast entry: numeric keypads, chips, remembered units.
- Offline: queued with an idempotency key.
- **KPI capture:** each saved visit stores its completeness %, which feeds the secondary KPI.
- **Acceptance:** a routine visit can be entered in < 60 s.

#### F-14 Clinician Risk Tags & Follow-up Intensity — P0

- **Purpose:** Make the clinician's judgement about risk **visible to everyone** and turn it into follow-up actions (hackathon use case "High-risk pregnancy follow-up: tag risk, schedule reviews, re-engage").
- **Tags:** chosen by a clinician from the hospital's configurable **tag catalogue** (§10.4). Examples: Previous caesarean, Hypertensive disorder, Diabetes/GDM, Anaemia under treatment, Multiple pregnancy, Rh-negative, Previous stillbirth, Adolescent pregnancy, Other (free text). For babies: LBW follow-up, Preterm follow-up, Jaundice follow-up, Feeding support, Other.
- **Follow-up intensity** (set by the clinician): **Routine** · **Enhanced** · **Close**. Each maps to a hospital-configured visit cadence and missed-visit grace period (§10.1).
- **The system never** assigns, suggests, pre-ticks or removes a tag, and never changes intensity. There are no tag "recommendations" from values.
- **Effects of intensity:** ANC schedule regenerated (completed visits untouched), worklist ordering, missed-visit grace, and the family message "Your doctor wants to see you more often" (the tag names aren't shown to the family).
- **Audit:** who set or removed which tag, when, and why (a note is required on removal).
- **Acceptance:** setting "Close" regenerates the schedule instantly; tags appear on the patient header, the worklist, the newborn handoff panel and the referral bundle.

#### F-15 Care-Gap Alerts — P0

Alerts are **operational events only**. Nothing is triggered by a clinical value.

| Alert | Trigger | Owner |
|---|---|---|
| Call-back requested | Family taps "Ask the hospital to call me" | Care team (coordinator in the pilot) |
| Visit missed | Scheduled visit's `due_by + grace` passed without a visit | Treating team |
| No contact | Pregnancy tagged Close/Enhanced with no documented contact for 14/28 days | Treating team |
| Test window closing / closed | Protocol window within 7 days / passed without a result | Ordering clinician |
| Result awaiting review | Result entered, not yet marked reviewed | Ordering clinician |
| Referral stale | No status change for 72 h (24 h if marked urgent by the referrer) | Referrer + receiving dept |
| Discharge incomplete | Discharge started, checklist open > 12 h | Discharging clinician |
| Vaccine overdue | Dose > 7 days past due | Paediatric team |

- **Closing an alert** requires an outcome: *Contacted, will come* · *Rescheduled* · *Done elsewhere* · *Not needed (reason)* · *Unreachable* · *Escalated to…*. Some outcomes launch the next step (Rescheduled → scheduler).
- De-duplication: one open alert per gap; repeat events update it.
- Escalation: unclosed "Now" items after 2 h are re-notified and shown as escalated.

#### F-16 Investigation Tracker — P0

- **Schedule:** generated from the hospital's investigation protocol by GA (§10.2). This is ANC completeness, not clinical judgement.
- **Lifecycle:** `due` → `ordered` → `sample collected` (optional) → `resulted` → `reviewed` (a clinician marks it reviewed and chooses a follow-up: none / repeat / refer / discuss at next visit) | `not done` / `not applicable` (reason).
- **Catalogue (MVP):** Hb/CBC, blood group & Rh, urine routine, blood sugar, OGTT 75 g, HIV, syphilis, HBsAg, TSH, ultrasound (dating, anomaly, growth), indirect Coombs; newborn: bilirubin, blood sugar, TSH screen.
- **Result entry:** value + unit / positive-negative / structured scan findings + free text; optional photo or PDF of the report (F-31).
- **The system does not mark results normal or abnormal.** If the lab report itself carries a lab flag, it's stored as a transcribed field ("lab flag: H"), shown as documented.
- **Human override:** any scheduled test can be removed, re-dated or marked not applicable with a reason.

#### F-17 Referral Tracker — P0

- **Create:** to department, urgency (as chosen by the referrer), reason, question to answer, and an attached context bundle (tags, documented history, selected results).
- **Statuses:** `requested` → `accepted` → `scheduled` (date/time/place) → `seen` → `recommendations documented` → `closed` by the referrer | `declined` (reason) | `cancelled`.
- The receiving specialist uses the Care Team login with a department.
- The family sees scheduled referral appointments with place and prep.
- Metrics captured: request→seen and request→closed times.

#### F-18 Labour & Delivery Record — P0 (lean)

- **Admission:** date/time, GA, indication, admission notes, vitals. The patient appears on the Labour room list.
- **Delivery form:** date/time, mode (vaginal / assisted / LSCS elective / LSCS emergency), indication, number of babies, estimated blood loss, perineum, documented complications, medicines given, maternal condition. Per baby: sex, birth weight, GA at birth, liveborn/stillborn, Apgar 1 & 5, resuscitation, birth defects noted, breastfeeding within 1 h, vitamin K, birth-dose vaccines.
- **Effect (one transaction `record_delivery`):** delivery saved → baby record(s) with linked IDs → UIP vaccine schedule generated → pregnancy status `delivered` → paediatric team notified → Family app gets "My Baby".
- **Sensitive outcomes:** stillbirth or neonatal death suppresses all baby reminders and cheerful content; postnatal care continues gently; bereavement support contact shown.

#### F-19 Mother–Baby Linked Record — P0

- The baby's record is permanently linked to mother, pregnancy and delivery; navigation works both ways.
- **Mother's history panel** on the newborn view shows **documented facts only**: clinician tags, documented conditions, documented test results as entered (blood group/Rh, serology, sugar tests), medicines given in labour, delivery mode and indication, GA at birth, Apgar. Each item links to its source record.
- The panel informs the handoff; it makes no statement about what the baby needs.
- Paediatricians opening the full maternal record is allowed and audited.

#### F-20 Newborn View — P0

- Header: baby ID, sex, age, birth weight, latest documented weight, GA at birth, clinician-set baby tags and follow-up intensity.
- Sections: mother's history panel · birth details · observations as documented (weight, temperature, respiratory rate, feeding, jaundice assessment as recorded by the clinician) · investigations · immunizations · follow-up plan · timeline.
- No automatic flags from weight, Apgar or other values; the paediatrician tags the baby (e.g. "LBW follow-up"), which applies that tag's follow-up template.

#### F-21 Discharge Checklist — P0

- **Mother:** vitals documented · medicines & instructions documented · warning signs explained (tick + language) · postnatal visit(s) scheduled · family-planning counselling documented (or declined) · breastfeeding support given · tag-linked follow-ups scheduled (e.g. if tagged "Hypertensive disorder", the hospital template adds "BP check day 3–5"; if "GDM", "glucose test 6–12 weeks"). These are **templates chosen by the hospital and attached to clinician tags**, not system judgements.
- **Baby:** feeding documented · discharge weight documented · birth-dose vaccines documented or reason · newborn screening documented where applicable · jaundice assessment documented · follow-up scheduled · parent education given.
- **Gating:** "Complete discharge" stays disabled until every item is done or marked N/A / deferred **with a reason**.
- **Output:** a structured discharge summary; the family plan appears in the app and on WhatsApp/SMS.

#### F-22 Follow-up Engine — P0

- Generates tasks from protocols (§10): ANC visits by intensity, test windows, postnatal visits, newborn visits, tag-linked follow-up templates, vaccine doses, referral appointments.
- Task fields: kind, subject, due window, owner, intensity, status, completing record.
- **Auto-completion:** a matching documented encounter closes the task (e.g. a recorded vaccine dose).
- **Human override:** every generated task can be edited, re-dated, reassigned or cancelled with a reason; regeneration never deletes completed tasks.

#### F-23 Missed-Visit Detection & Recovery — P0

- A nightly job (pg_cron 01:00, plus an on-demand run) marks tasks `missed` when `due_by + grace` passes. Grace comes from intensity: Close = 2 days, Enhanced = 4, Routine = 7 (configurable).
- The recovery list offers **Call** (dialler), **Send WhatsApp/SMS reminder** (pre-approved template), **Reschedule**, and **Log outcome** (will come / delivered elsewhere / moved / unreachable / declined).
- After 3 unsuccessful attempts the status becomes `lost_to_follow_up` (visible, reactivatable).
- The family gets "We missed you, please call to reschedule".
- **KPI capture:** missed → contact time and missed → recovered visit are recorded (§18.1).

#### F-24 Immunization Tracker — P0

- India UIP defaults as data (§10.5); generated from DOB at delivery.
- Each dose: given (date, optional batch/site) · due · upcoming · overdue. Recording a dose closes its task and updates the family's app and reminders.
- Catch-up respects minimum intervals (schedule arithmetic, not clinical advice).

#### F-25 Call-back Queue — P0

- Receives family requests (from the app or by replying to a WhatsApp reminder).
- Each item shows: who, when, the warning-sign items she ticked (as reported), any self-log values she entered, preferred language and number.
- Ordering: newest first, with requests where a **listed warning sign was ticked by the family** pinned and labelled "Family reported warning sign". This is a transparent rule based on what the family selected, not an assessment.
- The staff member calls and closes with an outcome: *Advised to come in* · *Visit scheduled* · *Information given* · *Unreachable* · *Other*, plus a note. **The clinical judgement is made by the human on the call.**
- SLA timer shown (time since request); unanswered > 2 h escalates.

#### F-26 Care-Team Notes & Smart Lists — P1

- Threaded, immutable notes per pregnancy/baby with @department mentions.
- Smart lists: "Close follow-up due this week", "Due to deliver in 2 weeks", "Discharged this week, postnatal visit pending", "Overdue vaccines", "Results awaiting review", "Referrals waiting > 72 h".

#### F-27 AI Consultation Brief & Handoff Summary — P1

- **Purpose:** save time assembling the story (hackathon use case "Consultation readiness & patient journey review").
- **What it does:** turns the **documented** record into a short brief: what's changed since the last visit, what's still due, open referrals, and upcoming milestones. It's also used for the newborn handoff and the discharge summary draft.
- **What it never does:** assess, interpret values, infer conditions, recommend actions or rank urgency. The prompt forbids clinical adjectives ("high", "abnormal", "concerning") unless quoting a documented clinician note.
- **Safety design:**
  - Input: structured, **de-identified** record (no name, phone, address).
  - Output: JSON sentences, each with source record IDs. Sentences without sources are dropped.
  - Shown as **"AI draft, unverified"** until a clinician taps Verify; only verified text is saved.
  - Fully audited (who generated, who verified, what changed).
- *Example:* "32+2 wks. Tags: Previous caesarean; Hypertensive disorder (set 14 Sep by Dr. Priya). Since last visit (14 Sep): OGTT window closed without result; Cardiology referral seen 20 Sep, recommendations documented. Still due: urine albumin, anaesthesia review by 36 wks. Next visit scheduled 28 Sep."

#### F-28 Search & Lookup — P0

Name, phone, MCH ID, MRN, QR scan. Results show GA / baby age and tags. Opening a record is audited.

#### F-29 Structured Handoff Summary — P0

- A one-page summary at key handoffs (OPD → labour room, delivery → paediatrics, hospital → home, hospital → another facility): tags, documented history, what's done, what's due, contacts.
- Viewable in the app; shareable as a PDF (P1) for a mother moving to another facility.

#### F-30 Import from Excel / CSV Register — P0

- **Purpose:** light integration. Start from the register the clinic already keeps.
- Upload `.xlsx`/`.csv` (via web admin page or the app's document picker) → column mapping (saved per hospital) → row validation (missing phone, impossible dates, duplicates) → preview → clinician confirms → pregnancies created with `source = import`.
- Imported pregnancies get schedules from their GA; past windows are shown as "status unknown, confirm" rather than "missed".
- **Demo:** a synthetic ANC register spreadsheet with 50 rows.

#### F-31 Paper & PDF Capture with AI Transcription — P1

- Photograph an ANC card, a lab report or a register page, or pick a PDF.
- AI **transcribes** the visible text into a **draft form** (field, value, confidence, bounding box). It does not interpret the values.
- The clinician reviews side by side, corrects, and confirms. Nothing enters the record unconfirmed.
- The original image is stored with the record (encrypted), linked to the entries created from it.

### 9C. Family App (mother & caregiver)

#### F-40 Home — P0

- **Pregnancy:** greeting in her language · "Week 32" with a simple visual · **one Next Step card** (visit/test/referral with date, place, what to bring, how to prepare) · the next 3 items · buttons: *Ask the hospital to call me* · *Warning signs* · *My card* · *Call hospital*.
- **After delivery:** two cards (*Me*: postnatal week and next visit; *My Baby*: age and next vaccine) + the same buttons.
- Caregivers see the same, scoped by the mother's sharing choices.

#### F-41 My Pregnancy — P0

- A simplified timeline; visits done/upcoming; tests: done / due / "discuss at your visit"; her documented readings with labels "recorded at hospital" vs "you recorded"; medicines list.
- She doesn't see tag names or sensitive results; she sees "Your doctor wants to see you more often" when intensity is Enhanced/Close.

#### F-42 Self-Log, Warning Signs & Call-back — P0

- **Self-log:** home BP (if she has a monitor), weight, fetal movement count, medicines taken; after delivery: bleeding amount (as she describes it), wound, breastfeeding; baby: feeding, weight at a centre. Stored as **family-reported**, never overwriting clinical values, and shown to clinicians as entered.
- **Warning-signs screen:** static, clinically reviewed, illustrated content for pregnancy, after delivery and the newborn (e.g. bleeding, severe headache or blurred vision, fits, leaking water, baby moving less, high fever; baby not feeding, fits, fast breathing, cold, yellow in the first day). The **same message for everyone**: "If you notice any of these, go to the hospital now or call 108." Call buttons are always visible.
- **Ask the hospital to call me:** she can (optionally) tick which listed signs or concerns she noticed and add a voice note or text; the request goes to the call-back queue (F-25). If offline, the request is queued and the screen says "Not sent yet. If it is urgent, call 108 or the hospital now."
- **The app never evaluates what she entered**: no "this is serious" or "this is normal" messages.

#### F-43 My Baby — P0

- Birth details; age; vaccination card (given / due / overdue); upcoming baby visits; weights recorded at visits; baby self-log. Twins shown as tabs.

#### F-44 My Schedule & Reminders — P0

- All upcoming items for her and her baby: date, place, what to bring, preparation (e.g. fasting for OGTT, from the protocol's prep text).
- Local notifications scheduled from the list (these work offline).
- "I can't come": shows the hospital phone and records a reschedule request as a task note.

#### F-45 Emergency Card — P1

- The mother chooses which documented fields to include: first name, age, blood group, weeks pregnant / EDD, allergies, documented conditions in plain words, treating hospital + phone, emergency contact.
- QR encodes a plain compact text card, readable offline by any phone camera. Defaults exclude sensitive items.

#### F-46 Medicine Reminders — P1

- Created only from clinician-entered prescriptions (IFA, calcium, etc.): name, dose, times, duration. *Taken / Skipped*; adherence is visible to clinicians as data.

#### F-47 Education: Pregnancy, Postnatal & Day-by-Day Newborn Guide — P1

- Short illustrated cards by stage and by baby day (feeding, warmth, cord care, sleep, when to return, vaccination).
- **Content governance:** bundled, versioned files per language with `reviewed_by`, `reviewed_on` and `version`; sourced from national MCH material and reviewed by the team's doctor partner. AI may draft translations, which are **only published after clinician review**.

#### F-48 Hospital Contact — P0

Labour room, OPD, 108/102, address → Maps.

#### F-49 WhatsApp / SMS Reminders — P0 (sandbox)

- For every family task reminder, the channel(s) she chose: app push, WhatsApp, or SMS.
- **Pre-approved templates only**, in her language (e.g. "ನಮಸ್ಕಾರ Lakshmi, your hospital visit is on Mon 5 Oct at 10 AM, OPD Block B. Bring your MCP card. Reply 1 to confirm, 2 to ask for a call.").
- Replies: *1 = confirm* (marks the task confirmed) · *2 = call me* (creates a call-back item) · other text goes to the call-back queue.
- No clinical content beyond the scheduled item. No free-text AI replies.
- Demo: WhatsApp sandbox (e.g. Twilio or Gupshup sandbox) to team phones. Production WhatsApp Business onboarding happens in the pilot.

### 9D. Platform Features

#### F-60 Audit Trail — P0

- Append-only `audit_log`: actor, role, action (`view_record`, `create`, `update`, `tag_set`, `tag_removed`, `task_override`, `alert_closed`, `import`, `ai_draft_generated`, `ai_draft_verified`, `caregiver_added`, `caregiver_revoked`, `export`, `login`), entity, timestamp, app version.
- Writes captured by DB triggers; views by an RPC on record open.
- No update/delete for anyone. A per-patient "access history" is visible to the Care Team (P1).

#### F-61 Offline & Low-Connectivity — P0 (scoped)

- **Read:** persisted encrypted cache of the worklist, opened patients and all Family app data.
- **Write queue:** visit entries, newborn observations, self-logs, call-back requests, alert outcomes. Client UUID idempotency keys; inserts only; retries with backoff.
- Visible state: "Offline, showing data from 10:42" and per-item ⏳/✓.
- Not offline: registration, import, delivery, discharge (server transactions); disabled with an explanation.

#### F-62 Multilingual — P0 (Family), P2 (Care Team)

- Family UI in English, Kannada and Hindi for the MVP (Tamil, Telugu next); WhatsApp/SMS templates in the same languages.
- All strings via i18n keys. Localised dates and numbers. Care Team UI in English.

#### F-63 Role-Based Access — P0

| Role | Can see | Can write |
|---|---|---|
| Obstetrician | Maternal records in their hospital; baby records (read) | Maternal records, tags, referrals, delivery, maternal discharge, task overrides, alert outcomes |
| Paediatrician | Baby records; mother's history panel; full maternal record on explicit open (audited) | Newborn records, baby tags, immunizations, newborn discharge |
| Specialist (Care Team user with department) | Referrals to their department + bundle; record on explicit open (audited) | Referral status & recommendations |
| Mother | Her records and her babies' records (no sensitive results) | Self-logs, call-back requests, profile, caregivers, card choices, consent |
| Caregiver | Only the scopes the mother granted | Call-back requests; baby self-logs if granted |
| Coordinator / Nurse / Admin (reserved) | Defined in the pilot | Defined in the pilot |

Enforced by Postgres RLS, never by UI alone.

---

## 10. Care Protocols & Configuration

> All protocols are **hospital-configurable data**, seeded with defaults from national MCH guidance and reviewed by the team's doctor partner. They define *when things are due*. They contain **no clinical thresholds** and make **no clinical judgements**.

### 10.1 ANC visit cadence by follow-up intensity (clinician-selected)

| Intensity | Default cadence | Missed-visit grace |
|---|---|---|
| Routine | Every 4 wks to 28 wks · every 2 wks 28–36 · weekly from 36 wks | 7 days |
| Enhanced | Every 3 wks to 28 wks · every 2 wks 28–36 · weekly from 36 wks | 4 days |
| Close | Every 2 wks to 36 wks · weekly from 36 wks | 2 days |

Minimum national contacts (first ≤ 12 wks, 14–26, 28–34, 36–term) are always included. Completed visits are never regenerated.

### 10.2 ANC completeness: expected components

| Scope | Expected components (configurable) |
|---|---|
| Every visit | BP, weight, urine albumin, fundal height (≥ 20 wks), FHR (≥ 20 wks), fetal movements asked (≥ 28 wks), IFA/calcium dispensed, counselling topic, next visit scheduled |
| First visit | Full history, height, blood group & Rh, Hb, urine routine, HIV, syphilis, HBsAg, blood sugar, TSH (where available), dating scan ordered |
| 18–22 wks | Anomaly scan |
| 24–28 wks | OGTT 75 g, repeat Hb |
| 28 wks (if Rh-negative documented) | Indirect Coombs |
| 32–36 wks | Repeat Hb; presentation documented; birth preparedness counselling |
| ≥ 36 wks (if any tag present) | Delivery plan documented (place/team), as a documentation item |
| Td | Doses per national schedule |

### 10.3 Postnatal & newborn follow-up templates

| Template | Tasks |
|---|---|
| Standard postnatal (mother) | Day 3 · Day 7 · Week 6 |
| Standard newborn | Day 3 (if discharged < 48 h) · Day 7 · then with vaccine visits (6, 10, 14 wks, 9 months, 16–24 months) |
| Tag-linked templates (attached by the hospital to clinician tags) | e.g. "Hypertensive disorder" → BP visit day 3–5 · "GDM" → glucose test 6–12 wks · "LBW follow-up" → weekly weight visit × 4 · "Jaundice follow-up" → visit day 2–3 after discharge |

Tag-linked templates are **workflow templates the hospital defines**. The system applies them only because a clinician applied the tag, and every task can be overridden.

### 10.4 Tag catalogue (documentation labels, clinician-selected)

- **Maternal:** Previous caesarean · Hypertensive disorder · Diabetes / GDM · Anaemia under treatment · Heart disease · Kidney disease · Thyroid disorder · Epilepsy · Infection requiring newborn follow-up · Rh-negative · Multiple pregnancy · Previous stillbirth · Previous preterm birth · Previous PPH · Placental condition · Adolescent pregnancy · Advanced maternal age · Social support needed · Other (free text).
- **Newborn:** LBW follow-up · Preterm follow-up · Jaundice follow-up · Feeding support · NICU graduate · Other.
- Every tag has: code, label (en/kn/hi), optional linked follow-up template, and a `family_visible` flag (default false).

### 10.5 Immunization schedule (India UIP defaults, 0–24 months)

| Age | Vaccines |
|---|---|
| Birth | BCG, OPV-0, Hepatitis B birth dose |
| 6 weeks | OPV-1, Pentavalent-1, Rotavirus-1, fIPV-1, PCV-1 |
| 10 weeks | OPV-2, Pentavalent-2, Rotavirus-2 |
| 14 weeks | OPV-3, Pentavalent-3, Rotavirus-3, fIPV-2, PCV-2 |
| 9–12 months | MR-1, PCV booster, JE-1 (endemic districts), Vitamin A (1st) |
| 16–24 months | MR-2, DPT booster-1, OPV booster, JE-2 (endemic districts), Vitamin A (2nd) |

Stored as `vaccine_schedule` rows with minimum intervals and region flags.

### 10.6 Warning-signs content

Static, versioned content (per language, per stage), reviewed and signed by the doctor partner. The same content is shown to everyone; no logic selects messages based on input.

---

## 11. Data Model

All clinical tables are **append-friendly**: `created_by`, `created_at`, `source` (`clinician` | `family` | `import` | `capture` | `system`), `client_id` (idempotency), `superseded_by` + `entered_in_error_reason`. No physical deletes of clinical data.

### 11.1 Entity overview

```
hospitals ─┬─< departments
           ├─< staff (user_id, role, department_id)
           └─< protocols (kind, version, rows jsonb)  · tag_catalogue · vaccine_schedule · message_templates

mothers (user_id?, phone, lang, channels) ─┬─< pregnancies (mch_id, lmp, edd, edd_source, gpla, status, intensity)
                                           │       ├─< obstetric_history
                                           │       ├─< encounters (anc | admission | postnatal | other)
                                           │       │       ├─< maternal_vitals
                                           │       │       └─< checklist_items (component, status, reason)
                                           │       ├─< investigations
                                           │       ├─< referrals ─< referral_events
                                           │       ├─< prescriptions ─< med_doses_taken
                                           │       ├── delivery ─< babies (child_id, …, intensity)
                                           │       │                  ├─< newborn_observations
                                           │       │                  ├─< growth_measurements
                                           │       │                  └─< immunizations
                                           │       └─< discharge_checklists
                                           ├─< caregivers (user_id?, phone, relation, scopes[], status)
                                           ├─< medical_history / allergies / medications
                                           ├─< self_logs (subject, kind, data, reported_by)
                                           ├─< callback_requests (ticked_signs[], note, channel, status, outcome)
                                           ├─< consents
                                           └── emergency_card_prefs

tags          (subject_type, subject_id, tag_code, set_by, set_at, removed_by, removed_at, reason)
tasks         (kind, subject, due_from, due_by, owner_role, owner_department_id, intensity, status, generated_by, override_reason, completed_by_record)
alerts        (kind, subject, task_id?, status, outcome, outcome_note, closed_by, escalated_at)
message_log   (channel, template_id, to_phone_hash, task_id, status, reply)
documents     (subject, storage_path, mime, captured_by, transcription_json, confirmed_by)
imports       (file_name, mapping, rows_total, rows_created, rows_rejected, confirmed_by)
care_notes    (subject, author, body, version, mentions[])
ai_drafts     (subject, kind, content_json, source_ids[], status, verified_by)
audit_log     (actor, role, action, entity, entity_id, at, meta)
kpi_events    (kind, subject, task_id, at, meta)   -- visit_due, visit_completed_on_time, visit_missed, contact_made, recovered, checklist_completeness
```

### 11.2 Key tables (selected)

```sql
create table pregnancies (
  id uuid primary key default gen_random_uuid(),
  mch_id text unique not null,                       -- MCH-2026-001245
  mother_id uuid not null references mothers(id),
  hospital_id uuid not null references hospitals(id),
  lmp date, lmp_certain boolean,
  edd date not null,
  edd_source text check (edd_source in ('lmp','scan','clinician')),
  gravida int, para int, living int, abortions int,
  intensity text not null default 'routine'
    check (intensity in ('routine','enhanced','close')),  -- set only by clinicians
  intensity_set_by uuid, intensity_set_at timestamptz,
  status text not null default 'active'
    check (status in ('active','admitted','delivered','postnatal','closed',
                      'lost_to_follow_up','transferred','ended_early')),
  source text not null default 'clinician',
  created_by uuid, created_at timestamptz default now()
);
create unique index one_active_pregnancy on pregnancies(mother_id)
  where status in ('active','admitted');

create table tags (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('pregnancy','baby')),
  subject_id uuid not null,
  tag_code text not null references tag_catalogue(code),
  note text,
  set_by uuid not null references staff(user_id),     -- always a clinician
  set_at timestamptz not null default now(),
  removed_by uuid references staff(user_id),
  removed_at timestamptz, removed_reason text
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null,  -- anc_visit | investigation | referral_appt | pn_visit | nb_visit | vaccine | review_result | callback | discharge_item | template_followup
  subject_type text not null check (subject_type in ('pregnancy','baby')),
  subject_id uuid not null,
  ref_id uuid,
  due_from date, due_by date not null,
  owner_role text, owner_department_id uuid,
  intensity text not null default 'routine',
  generated_by text not null default 'protocol',     -- protocol | template | clinician | import
  status text not null default 'scheduled'
    check (status in ('scheduled','confirmed','completed','missed','cancelled','rescheduled','lost_to_follow_up')),
  override_reason text,
  completed_by_record uuid,
  created_at timestamptz default now()
);
```

### 11.3 Views

- `timeline_events`: the union of event-bearing tables for the continuity timeline.
- `worklist_items`: per-user care gaps grouped Now / Today / This week.
- `mother_history_panel`: documented maternal facts for a baby's handoff panel.
- `family_visible_*`: family-safe projections (no tags unless `family_visible`, no sensitive results), filtered by caregiver scopes.
- `kpi_visit_completion`: on-time completion by week, visit kind and intensity (§18.1).

---

## 12. Core Architecture & Patterns

### 12.1 High-level architecture

```
┌──────────────────────── React Native app (Expo) ───────────────────────┐
│ expo-router: (auth)/  (care)/  (family)/   ← route groups, role-guarded │
│ features/*  ← screens + hooks + queries per feature                    │
│ TanStack Query (server state, persisted) · Zustand (UI/session)        │
│ Outbox (offline writes) · i18n · notifications · document capture      │
│ shared/domain ← pure TS: GA/EDD, schedule & template generation,       │
│                 completeness calc, UIP arithmetic   (no clinical logic)│
└───────────────┬────────────────────────────────────────────────────────┘
                │ HTTPS (supabase-js) · Realtime
┌───────────────▼──────────────────── Supabase ──────────────────────────┐
│ Auth (phone OTP) · Postgres + RLS · Realtime · Storage (encrypted docs)│
│ RPCs: register_pregnancy, record_visit, set_tag, record_delivery, …    │
│ Edge Functions (Deno):                                                 │
│   schedule-engine  ← regenerate tasks on protocol/intensity/tag change │
│   nightly-sweep    ← missed tasks, stale referrals, escalations, KPIs  │
│   notify           ← push + WhatsApp/SMS via provider, templates only  │
│   messaging-webhook← inbound replies → confirm / call-back             │
│   import-register  ← Excel/CSV parse + validate                        │
│   ai-gateway (P1)  ← consultation brief, handoff draft, transcription  │
│ pg_cron → nightly-sweep                                                │
└────────────────────────────────────────────────────────────────────────┘
        │                            │                          │
 Expo Push → FCM          WhatsApp/SMS provider         LLM API (de-identified)
```

### 12.2 Key design decisions

1. **No clinical logic anywhere.** `shared/domain` contains only date and schedule arithmetic, completeness counting and template expansion. A lint rule and code review checklist forbid comparisons against clinical values (e.g. `bp_systolic >`) outside input sanity validation.
2. **One domain module, two runtimes.** `shared/domain` is dependency-free TS, imported by the app (`@domain`) and by Edge Functions. A Phase-0 spike verifies bundling; the fallback is a copy step.
3. **Transactions for multi-record events.** Registration, import confirm, tag changes (with schedule regeneration), delivery and discharge are Postgres functions.
4. **Append-only facts; overridable plans.** Records never change. Tasks are the only generated objects, and every generation or override is audited with `generated_by` / `override_reason`.
5. **Tasks as the universal obligation.** One table powers the worklist, missed detection, family reminders, WhatsApp/SMS and the KPIs.
6. **KPI by construction.** Every task state change writes a `kpi_events` row, so pilot measurement needs no extra work.
7. **Security in the database.** RLS on every table; role from `staff` / `mothers` / `caregivers`, never from the client.
8. **Feature folders; server state in TanStack Query; small Zustand stores; generated DB types; zod everywhere.**

### 12.3 Directory structure

```
<app-name-tbd>/
├── app/                                # expo-router routes (thin)
│   ├── _layout.tsx                     # providers, auth gate, role redirect
│   ├── (auth)/ welcome · phone · otp · choose-face
│   ├── (care)/
│   │   ├── _layout.tsx                 # staff-only guard; tabs
│   │   ├── index.tsx                   # worklist
│   │   ├── patients/…                  # search, [pregnancyId]/ view, visit/new, tags, timeline
│   │   ├── babies/[babyId]/…
│   │   ├── referrals/… · callbacks/… · import.tsx · register.tsx
│   └── (family)/
│       ├── _layout.tsx                 # mother/caregiver guard; tabs
│       ├── index.tsx                   # home / next step
│       ├── schedule/… · pregnancy/… · baby/[babyId]/… · log/… · warning-signs.tsx
│       ├── card.tsx · learn/… · caregivers.tsx
├── src/
│   ├── features/
│   │   auth · registration · patient-view · anc-visit · tags · alerts · investigations ·
│   │   referrals · delivery · newborn · discharge · tasks · immunization · timeline ·
│   │   callbacks · import · capture · self-log · caregivers · emergency-card ·
│   │   education · messaging · ai-brief
│   ├── lib/        supabase · query · outbox · env (zod) · i18n · notifications · audit
│   ├── ui/         design tokens + primitives (see DESIGN.md §3–4)
│   ├── state/      zustand stores
│   └── types/      database.types.ts (generated)
├── shared/domain/  gestation.ts · schedules/{anc,investigations,postnatal,newborn,vaccines}.ts ·
│                   templates.ts · completeness.ts        (100% unit-tested, no clinical logic)
├── supabase/
│   ├── migrations/ · functions/{schedule-engine,nightly-sweep,notify,messaging-webhook,import-register,ai-gateway}/
│   ├── seed.sql    # hospital, staff, protocols, tag catalogue, UIP, templates
│   └── config.toml
├── scripts/seed-demo.ts                # synthetic patients across every stage + sample Excel register
├── locales/{en,kn,hi}.json · content/{education,warning-signs}/{en,kn,hi}/*.md
├── __tests__/ · e2e/ (Maestro)
├── app.config.ts · eas.json · PRD.md
```

### 12.4 Patterns

- Query keys per feature; Realtime invalidates keys.
- Forms: react-hook-form + zod; the same schema documents the RPC payload.
- **No swallowed errors**: failures show a toast and go to the outbox if eligible.
- Feature flags in `app.config.ts` (e.g. `aiBrief`, `capture`, `whatsapp`) to hide unstable P1 features during the demo.
- Dev-only **time travel** to demo schedules and missed visits.

---

## 13. Technology Stack

Exact versions are pinned in Phase 0 to the **latest stable Expo SDK at project start** and its matching React Native / React.

| Layer | Choice | Why |
|---|---|---|
| Framework | **Expo** (dev client), New Architecture, TypeScript strict | Fast phone iteration; EAS cloud builds from Windows; OTA via EAS Update |
| Navigation | **expo-router** | Route groups per login face; typed deep links |
| Server state | **@tanstack/react-query v5** + persister | Caching, retries, offline read |
| UI state | **zustand** | Small, no provider re-render storms |
| Forms | **react-hook-form** + **zod** | Fast forms, shared schemas |
| Backend | **Supabase**: Postgres, Auth (phone OTP), RLS, Realtime, Storage, Edge Functions, pg_cron | Security in the DB; one managed backend |
| Local storage | **react-native-mmkv** (encrypted) + **expo-secure-store** | Cache/outbox + tokens |
| Notifications | **expo-notifications** | Push + local scheduling |
| Messaging | WhatsApp Business API / SMS via a provider (e.g. Twilio or Gupshup; MSG91 for SMS), behind the `notify` function | Low-cost channels; sandbox for the demo |
| Documents | **expo-image-picker**, **expo-document-picker**, **expo-camera** | Capture and import |
| Spreadsheet parsing | **SheetJS (xlsx)** in the `import-register` function | Excel/CSV import |
| i18n | **i18next** + **react-i18next** + **expo-localization** | |
| Animation / graphics | **react-native-reanimated**, **gesture-handler**, **react-native-svg** | Timeline split animation, trends |
| Styling & atmosphere | Design tokens + StyleSheet (see [DESIGN.md](DESIGN.md)); **expo-linear-gradient** (background), **expo-blur** (glass on iOS/high-end Android; translucent fallback elsewhere); fonts via **@expo-google-fonts**: Instrument Serif, DM Sans, Noto Sans/Serif Kannada & Devanagari | UI inspiration: rose-lavender glass + floating circular navbar, cream-serif components |
| Icons / QR | **lucide-react-native**, **react-native-qrcode-svg** | |
| App lock | **expo-local-authentication** | |
| Dates | **date-fns** | GA/age arithmetic |
| AI (P1) | LLM via the `ai-gateway` Edge Function (default: Anthropic **claude-sonnet-5**, provider-swappable; vision for transcription); optionally orchestrated with an agent framework (e.g. LangChain) as encouraged by the hackathon | Keys server-side; de-identified input; cited JSON output |
| Testing | **jest-expo**, **@testing-library/react-native**, **Maestro**, SQL tests for RLS | |
| Tooling | ESLint (+ custom rule banning clinical-value comparisons in domain code), Prettier, Husky, gitleaks | |
| Builds / OTA | **EAS Build** (dev + preview APK), **EAS Update** | |

---

## 14. Developer Workflow (hot reload on phone)

1. **Once:** `eas build --profile development --platform android` → install the dev-client APK on team phones (or `npx expo run:android` over USB). All native modules are added in Phase 0 so this happens once.
2. **Daily:** `npx expo start --dev-client` → same Wi-Fi → scan QR → **Fast Refresh** on save. On restrictive networks use `--tunnel`; USB fallback is `adb reverse tcp:8081 tcp:8081`.
3. **Two phones side by side:** one logged in as Care Team, one as Family. Realtime changes show on both. This is also the finale setup.
4. **Backend:** `supabase migration new` → `supabase db push` → `npm run db:types`; `supabase functions deploy <name>`.
5. **Demo data:** `npm run seed:demo` (patients at every stage + a 50-row synthetic Excel register).
6. **Ship to mentors/judges:** `eas update --branch preview`.
7. **Scripts:** `start`, `android`, `typecheck`, `lint`, `test`, `test:domain`, `db:push`, `db:types`, `seed:demo`, `e2e`.

---

## 15. Security, Privacy & Configuration

### 15.1 Authentication & authorization
- Phone OTP; accounts originate from the hospital (staff seeded; mothers created at registration or import; caregivers invited by the mother).
- Custom JWT claims (`app_role`, `hospital_id`, `mother_id`) via an auth hook for fast RLS.
- RLS: staff are scoped to their hospital; mothers to their own rows through `family_visible_*` views; caregivers to granted scopes; `audit_log` is insert-only.
- Care Team idle lock 10 min, re-OTP every 12 h; optional Family app lock.

### 15.2 Configuration
- `.env` holds only public values (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_ENV`), validated by zod at startup. It **fails fast** and has **no hard-coded fallbacks**.
- Server secrets (service-role key, LLM key, messaging credentials) live only in Supabase / EAS secrets.
- `.gitignore` for `.env*`, `google-services.json` and keystores; gitleaks pre-commit.

### 15.3 Data protection
- TLS in transit; encryption at rest; encrypted on-device cache; tokens in secure storage.
- No PHI in push, WhatsApp or SMS text beyond the appointment itself (date, place, first name).
- Phone numbers are hashed in `message_log`.
- `FLAG_SECURE` on Care Team patient screens (P1).
- LLM calls: de-identified structured data only, or document images cropped to the relevant region; a zero-retention provider setting where available; audited.

### 15.4 Privacy for shared phones & caregivers
- Sensitive results (HIV, syphilis, HBsAg, mental-health notes) are never shown in the Family app.
- Caregivers see only the scopes the mother grants. She can revoke at any time.
- Generic notifications; optional app PIN; emergency card fields are opt-in.

### 15.5 Consent, compliance & data policy
- Consent captured at onboarding (version, language, timestamp); withdrawal supported.
- Designed toward India's **DPDP Act 2023** principles and future **ABDM** alignment. The prototype **does not claim compliance**.
- **Hackathon data rule:** only fake or fully anonymised data, in development, with mentors and in demos. The synthetic dataset is generated by `seed-demo.ts`; no real names, phones or records.

### 15.6 Security scope
- **In scope (MVP):** OTP auth, RLS everywhere, audit, secure storage, env validation, secret scanning, PHI-free messaging.
- **Out of scope (MVP):** pen-testing, certifications, formal DPIA (planned before the pilot), MDM.

---

## 16. API Specification

The app reads through RLS-protected tables and views, and writes through **RPCs** (transactions) and **Edge Functions**.

### 16.1 RPCs

| RPC | Caller | Purpose |
|---|---|---|
| `register_pregnancy(payload)` | OB | Create/find mother, pregnancy + MCH ID, history, schedules, tasks |
| `record_visit(payload)` | OB | Encounter + vitals + checklist items (idempotent); completeness %; closes matching task |
| `set_tag(subject, tag_code, note)` / `remove_tag(tag_id, reason)` | Clinician | Tag change → template tasks via `schedule-engine` |
| `set_intensity(subject, intensity, note)` | Clinician | Change follow-up intensity → regenerate future visits |
| `override_task(task_id, action, data, reason)` | Staff | Edit / re-date / reassign / cancel any generated task |
| `order_investigation(...)` / `enter_result(...)` / `review_result(id, followup)` | Clinician | Investigation lifecycle |
| `close_alert(alert_id, outcome, note)` | Staff | Close a care-gap alert with an outcome |
| `create_referral(...)` / `update_referral(id, status, data)` | Staff | Referral lifecycle |
| `admit_for_delivery(...)` / `record_delivery(payload)` | OB | Admission; delivery → babies → vaccine schedule → notify |
| `complete_discharge(subject, checklist)` | OB/Peds | Gating validation; follow-up plan |
| `record_immunization(baby_id, vaccine_code, given_on, meta)` | Peds | Dose + close task |
| `confirm_import(import_id, mapping)` | OB | Create pregnancies from a validated import |
| `confirm_capture(document_id, fields)` | Clinician | Write confirmed transcription into records |
| `get_worklist()` · `get_timeline(subject)` | Staff/Family | Read models |
| `submit_self_log(payload)` · `request_callback(payload)` | Family | Family inputs (idempotent) |
| `add_caregiver(payload)` · `revoke_caregiver(id)` | Mother | Caregiver management |
| `log_record_access(entity, id)` | Staff | Audit a view |

### 16.2 Edge Functions

| Function | Trigger | Purpose |
|---|---|---|
| `schedule-engine` | RPCs on registration, intensity/tag change, delivery, discharge | Expand protocols and templates into tasks (pure `shared/domain`) |
| `nightly-sweep` | pg_cron 01:00 + dev "run now" | Missed tasks, stale referrals, no-contact gaps, escalations, KPI rollups |
| `notify` | Task and alert events | Push / WhatsApp / SMS using approved templates; quiet hours; logging |
| `messaging-webhook` | Provider callback | Inbound "1" → confirm task; "2"/text → call-back request |
| `import-register` | Upload | Parse xlsx/csv, validate, preview |
| `ai-gateway` (P1) | Staff request | Consultation brief, handoff draft, document transcription; de-identify → LLM → validate cited JSON → `ai_drafts` |

### 16.3 Example payloads

**`record_visit`**
```json
{
  "client_id": "8f3c2a8e-1b7d-4c1e-9a55-0d7e2f1c9b10",
  "pregnancy_id": "b1e0…",
  "visit_at": "2026-09-28T10:15:00+05:30",
  "vitals": { "weight_kg": 61.4, "bp_systolic": 146, "bp_diastolic": 94, "fundal_height_cm": 31, "fhr_bpm": 142 },
  "checklist": [
    { "component": "urine_albumin", "status": "not_done", "reason": "kit unavailable" },
    { "component": "ifa_dispensed", "status": "done" }
  ],
  "next_visit_on": "2026-10-05"
}
```
**Response**
```json
{
  "encounter_id": "e71a…",
  "completeness": { "done": 8, "expected": 10, "not_done": ["urine_albumin"], "na": [] },
  "still_due": [
    { "task_id": "t12…", "kind": "investigation", "label": "OGTT 75 g", "due_by": "2026-09-20", "status": "missed" }
  ],
  "closed_tasks": ["t09…"]
}
```

**`set_intensity`**
```json
{ "subject": { "type": "pregnancy", "id": "b1e0…" }, "intensity": "close",
  "note": "Documented hypertensive disorder; review 2-weekly" }
```
**Response**
```json
{ "regenerated_visits": 5, "next_visit_on": "2026-10-05", "missed_grace_days": 2 }
```

**`request_callback`**
```json
{ "client_id": "…", "mother_id": "m77…", "requested_by": "caregiver:c21…",
  "ticked_signs": ["baby_moving_less"], "note_audio_path": "callbacks/…/note.m4a",
  "channel": "app" }
```

**Inbound WhatsApp webhook → call-back**
```json
{ "from_hash": "sha256:…", "template_id": "anc_reminder_kn_v2", "task_id": "t31…", "reply": "2" }
```

---

## 17. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Cold start ≤ 3 s on a 3 GB RAM Android; worklist ≤ 1.5 s on 4G; patient view ≤ 1 s from cache |
| Real-time | Call-back request visible on the worklist ≤ 5 s (online) |
| Offline | Family app readable offline; queued writes sync ≤ 30 s after reconnect; no duplicates |
| Messaging | Reminder dispatched within 5 min of its scheduled time; delivery status logged |
| App size | APK ≤ 40 MB |
| Devices | Android 9+ (API 28+) |
| Accessibility | Font scaling to 130%; touch targets ≥ 44 dp; icons + text alongside every colour; illustrated warning signs for low literacy |
| Localisation | All Family strings and templates in en/kn/hi; no truncation |
| Reliability | Transactions for multi-record events; no silent failures |
| Scalability | `hospital_id` everywhere; ready for multiple hospitals |
| Maintainability | Files ≤ ~400 lines; `shared/domain` 100% branch coverage |
| Compliance guard | CI lint rule + review checklist: no clinical-value comparisons outside input sanity checks; no AI text reaches families |

---

## 18. KPI, Success Criteria & Proposed Pilot

### 18.1 Primary operational KPI

**On-time visit completion rate:** the percentage of scheduled maternal and newborn visits (ANC, postnatal, newborn follow-up) completed within their due window (+ grace).

```
on_time_rate = visits completed within window / visits due in period
```

- **Why this KPI:** it directly measures follow-through, the problem [App Name TBD] exists to solve, and it's countable from paper registers for a baseline.
- **In the hackathon:** computed automatically from `kpi_events` on the synthetic demo data and shown on a KPI screen, which proves the measurement is built in.
- **After the hackathon (pilot):** baseline from 4 weeks of a site's existing ANC/PNC registers (a manual count of due vs attended, same window definitions), then automatic weekly measurement by visit kind and intensity.

### 18.2 Secondary KPIs

| KPI | Definition |
|---|---|
| ANC visit completeness | Mean % of expected checklist components recorded per visit |
| Missed-visit recovery | % of missed visits for Close/Enhanced pregnancies that reach contact within 48 h, and % completed within 7 days |
| Postnatal handoff completion | % of discharges with a complete checklist and a completed Day-7 visit (mother and baby) |
| Vaccine timeliness | % of doses given within 7 days of the due date (0–14 weeks) |
| Referral closure | Median request → recommendations documented (days) |
| Call-back response time | Median request → call made |

### 18.3 Hackathon success criteria (definition of done for the finale)

The full demo story (Appendix B) runs live on two physical Android phones against the live backend, with synthetic data, no manual DB edits, in ≤ 7 minutes.

- ✅ OTP login routes Care Team and Family (mother and caregiver) correctly; cross-face access blocked by RLS
- ✅ Excel register import creates pregnancies with schedules
- ✅ ANC visit shows completeness gaps and "still due" items
- ✅ Tagging + intensity "Close" regenerates visits and changes missed-visit grace
- ✅ Investigation window closing/closed and result-review tasks appear
- ✅ Referral completes its lifecycle between two logged-in users
- ✅ Delivery creates linked baby record(s) with the mother's history panel
- ✅ Discharge is gated and generates the postnatal, newborn and vaccine plan
- ✅ Family app shows next step + prep in Kannada; the WhatsApp sandbox reminder arrives; reply "2" creates a call-back
- ✅ Call-back request from the Family app appears on the worklist in ≤ 5 s and closes with an outcome
- ✅ Time travel produces missed visits; recovery workflow logs outcomes
- ✅ The KPI screen shows the on-time rate computed from demo events
- ✅ Audit log records views, tag changes, overrides, AI verification
- ✅ **Compliance check:** a walkthrough with the doctor partner confirms no screen scores, interprets or recommends

**Quality indicators:** 100% unit coverage of `shared/domain` schedules; RLS test suite (mother A can't read mother B; caregiver only sees granted scopes); Maestro E2E on the demo path; zero `any` in the domain; strict TypeScript.

**UX goals:** a new clinician records a visit without training; a mother with moderate literacy finds her next visit and asks for a call-back within 30 s in her language.

### 18.4 Proposed pilot (post-hackathon — presented in the pitch, not executed now)

The hackathon asks strong entries to show *a credible path* to early evidence in a real care setting within 60–90 days. This is that path. Nothing below is required to build or demo the prototype.

| Weeks | Activity |
|---|---|
| −2 to 0 | Site agreement with a partner hospital (e.g. via the FOGSI network); approvals / ethics as required; protocol and template configuration with the OB lead; staff accounts; **baseline count** of on-time visits from paper registers (last 4 weeks) |
| 0–1 | Import the current ANC register (Excel/photos); train 2 OBs, 1 paediatrician and 1 coordinator (≤ 1 hour each); onboard mothers at their next visit (QR to install; WhatsApp/SMS for non-smartphone families) |
| 1–12 | Live use in one ANC OPD + postnatal ward + well-baby clinic; the coordinator owns the missed-visit and call-back lists; weekly KPI review with the OB lead |
| 4, 8, 12 | Checkpoints: on-time rate vs baseline, completeness, recovery, clinician time-on-task, family feedback (in language), messaging costs |
| 12 | Pilot report: KPI change, adoption, issues, decision to scale |

**Target scale:** ~200 pregnant women and their newborns in one hospital. **Target effect to test:** a measurable rise in the on-time visit completion rate over the baseline; the pilot reports the actual measured change.

**Running cost estimate (pilot):** Supabase Pro tier, SMS/WhatsApp per-message fees (≈ 6–10 reminders per mother per month), LLM usage for briefs (P1). All low-cost channels, no hardware.

---

## 19. Implementation Phases (mapped to the hackathon timeline)

| Hackathon milestone | Date |
|---|---|
| Build sprint & final submission | 5 Oct – 8 Nov 2026 |
| Top 30 announced | by 14 Nov 2026 |
| Grand finale (live demo, IIT Bombay) | 28 Nov 2026 |

### Phase 0: Foundation (Sprint week 1: 5–11 Oct)
- ✅ Expo project, route groups `(auth)`, `(care)`, `(family)`; dev client on all phones (all native modules added now)
- ✅ Supabase: first migrations, RLS skeleton, generated types, OTP with test numbers, role redirect
- ✅ `shared/domain`: GA/EDD, ANC schedule by intensity, UIP arithmetic + tests; bundling spike
- ✅ env validation, query + persister, i18n scaffold, lint (incl. clinical-comparison rule), CI
- ✅ Seed v0
- **Validation:** Care Team and Family phones land in the right face; a deep link across faces is rejected.

### Phase 1: Care Team core (Sprint week 2: 12–18 Oct)
- ✅ Registration, Excel import, consultation-ready patient view, ANC visit + completeness
- ✅ Tags + intensity + schedule regeneration
- ✅ Investigation tracker, referral tracker
- ✅ Worklist + care-gap alerts + audit
- **Validation:** import 50 rows → worklist shows due and overdue items; tagging "Close" tightens the schedule.

### Phase 2: Family app & messaging (Sprint week 3: 19–25 Oct)
- ✅ Onboarding, consent, language, caregivers
- ✅ Home / next step / schedule with prep; My Pregnancy
- ✅ Self-log, warning-signs content, call-back request + queue
- ✅ Push + local reminders; WhatsApp/SMS sandbox with reply handling
- ✅ Kannada + Hindi strings (reviewed by the doctor partner)
- **Validation:** a WhatsApp reminder arrives; reply "2" puts the mother in the call-back queue on the Care Team phone.

### Phase 3: Delivery, baby & follow-up (Sprint week 4: 26 Oct – 1 Nov)
- ✅ Admission + delivery → linked baby; newborn view + mother's history panel
- ✅ Discharge checklist with gating; follow-up engine; tag-linked templates
- ✅ Missed-visit detection + recovery; immunization tracker; My Baby
- ✅ Continuity timeline with the delivery split
- ✅ KPI events + KPI screen
- **Validation:** end-to-end demo story runs with time travel.

### Phase 4: Polish, P1 & final submission (Sprint week 5: 2–8 Nov)
- ✅ UI polish pass against DESIGN.md
- ✅ P1 as time allows: AI consultation brief, paper/PDF capture, emergency card, medicine reminders, education, notes
- ✅ Maestro E2E, RLS tests, compliance walkthrough with the doctor partner
- ✅ Final submission package (build, video, deck)
- **Validation:** three clean end-to-end runs; submission sent by 8 Nov.

### Phase 5: Finale preparation (9–27 Nov)
- ✅ Hardening from mentor/jury feedback; pilot proposal slide
- ✅ Demo rehearsals on two phones + backup video + offline fallback; hotspot backup
- ✅ Pitch: "The clinician decides. [App Name TBD] makes sure it happens."

---

## 20. Future Considerations

- Coordinator, nurse and admin roles; a hospital operations dashboard (follow-up load by department, recovery rates).
- ABDM/ABHA linking; HIS/LIS integration via FHIR; U-WIN for immunization records; RCH portal / MCP card data exchange.
- ASHA/ANM handoff for home-based newborn care visits.
- IVR voice reminders and voice-first logging for low literacy; more languages.
- Transfer-of-care between facilities with a shareable handoff summary.
- Growth charts (display of documented measurements), developmental milestone *reminders*.
- Multi-hospital / district deployment.
- Any future clinical-support capability would require separate regulatory and clinical validation, and is intentionally outside this product.

---

## 21. Risks & Mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Scope violation** (a feature reads as risk scoring, CDS or data interpretation) → disqualification | No computed risk anywhere; clinician-only tags; values shown as documented; static warning-sign content; human call-back; CI lint rule; compliance walkthrough with the doctor partner before each submission; wording review ("still due", never "abnormal") |
| 2 | **Scope creep** (fix-my-day had ~40 features) | P0/P1/P2 discipline; vertical slice first; feature flags; no P1 until the P0 demo path passes E2E |
| 3 | **Live demo failure** (OTP, network, WhatsApp sandbox) | Test OTP numbers; offline cache; hotspot; pre-recorded backup video; messaging feature-flagged with an in-app fallback |
| 4 | **Privacy on shared phones / caregivers** | Sensitive results never shown to the family; caregiver scopes; generic messages; app PIN |
| 5 | **AI errors in briefs or transcription** | Cited sentences only; de-identified input; unverified until a clinician verifies; transcription always confirmed field-by-field; feature-flagged |
| 6 | **Messaging cost and deliverability** | Templates only; channel choice per family; per-message costs tracked in the pilot |
| 7 | **Native build friction on Windows** | Expo + EAS cloud builds; all native modules in Phase 0; Android-only demo |
| 8 | **Team availability across a 5-week online sprint** | Weekly milestones above; doctor partner check-in weekly (content review, compliance) |

---

## 22. Appendix

### A. Glossary

| Term | Meaning |
|---|---|
| ANC / PNC | Antenatal / postnatal care |
| GA | Gestational age (weeks+days, e.g. 32+2) |
| EDD / LMP | Expected date of delivery / last menstrual period |
| G/P/L/A | Gravida, Para, Living children, Abortions |
| LSCS | Lower-segment caesarean section |
| OGTT | Oral glucose tolerance test |
| UIP | India's Universal Immunization Programme |
| MCP card | Mother and Child Protection card |
| Intensity | Clinician-selected follow-up level: Routine / Enhanced / Close |
| Tag | Clinician-applied documentation label (e.g. "Previous caesarean") |
| Care gap | An expected event (visit, test, referral step, vaccine) not completed in its window |
| RLS | Row-Level Security (Postgres) |
| DPDP Act | Digital Personal Data Protection Act, 2023 |
| ABDM / ABHA | Ayushman Bharat Digital Mission / Health Account |

### B. Finale demo script (synthetic data)

1. **Care Team phone (Dr. Priya):** the worklist shows *Now 2 · Today 9 · This week 6*.
2. **Import** a 50-row synthetic ANC register (Excel) → pregnancies created with schedules; overdue items appear.
3. Open **Lakshmi (MCH-2026-001245), 32+2 wks**. "Still due": urine albumin, OGTT (window closed), anaesthesia review before 36 wks.
4. Record the visit. Completeness shows 9/10; urine albumin marked "not done: kit unavailable".
5. **Tag** "Previous caesarean" and "Hypertensive disorder (documented)" and set intensity **Close**. The next visits regenerate every 2 weeks.
6. **Refer** to Cardiology. On the second phone, logged in as Cardiology, accept, schedule, document recommendations. The referral closes.
7. **Family phone (Lakshmi, Kannada):**
   - Next step shows "Visit Mon 5 Oct, 10 AM · bring MCP card · come fasting".
   - The **WhatsApp** reminder arrives on her husband's phone (caregiver). He replies "2".
   - A call-back appears on the Care Team worklist. It's called and closed with "Visit scheduled".
8. **Time travel** to 37+1. Record the **delivery**:
   - Emergency LSCS, girl, 2,380 g, Apgar 6/8.
   - Baby **MCH-2026-001245-B1** appears on the paediatrician's phone with the mother's history panel. The paediatrician tags "LBW follow-up".
   - Weekly weight visits are generated from the hospital template.
9. **Discharge** is blocked until "warning signs explained" is ticked. Completing it generates the postnatal, newborn and vaccine plan. The Family app now shows **Me + My Baby**.
10. Time travel +10 days. The **Day-7 baby visit is missed**. It goes to the recovery list → WhatsApp reminder → rescheduled.
11. **KPI screen:** on-time visit completion for the demo cohort, and recovery time.
12. Close on the **Continuity Timeline**, splitting into mother and baby at delivery: *"The clinician decides. [App Name TBD] makes sure it happens."*

### C. Lessons from fix-my-day → how [App Name TBD] does better

| fix-my-day | [App Name TBD] |
|---|---|
| Bare RN CLI; Codemagic for iOS; custom hot-updater | Expo dev client + EAS Build + EAS Update |
| No navigation library; ~20 `isXVisible` flags | expo-router route groups, typed deep links |
| 2,800-line `AppContext`; 2,400-line `api.ts` | Feature folders; TanStack Query; small zustand stores |
| Env loading broken → hard-coded Supabase fallbacks | zod-validated env, fail fast; secrets server-side only |
| No migrations; hand-maintained types | `supabase/migrations` + generated types |
| Fire-and-forget writes, swallowed errors | Outbox with idempotency keys and visible sync state |
| Tests for pure services only | Domain 100% + RLS tests + Maestro E2E |
| ~40 features, many unverified | P0/P1/P2 discipline, vertical slice first |
| Stale, oversized docs | This PRD and DESIGN.md as the source of truth |

**Kept:** Supabase, a single AI gateway with rate limiting and fallbacks, pure tested domain logic, design tokens, lucide icons, Reanimated, and the two-phone real-device loop.

### D. Open questions

1. Which WhatsApp/SMS provider for the demo sandbox (Twilio vs Gupshup vs MSG91)?
2. AI provider preference (Claude default vs Gemini as in fix-my-day).
3. ~~UI inspiration~~: done, see [DESIGN.md](DESIGN.md).
