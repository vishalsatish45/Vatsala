# Vatsala: the care journey, screen by screen

How one mother moves through the app, from registration to the end of the baby's 2-year vaccine schedule, and what each person taps at each stage. Labels in **bold** are the exact on-screen words. Synthetic demo data only.

## Who's who (demo logins, OTP `123456`)

| Phone | Person | Opens |
|---|---|---|
| 9000000001 | Dr. Priya Rao, obstetrician, OB Unit A | Care Team app |
| 9000000005 | Dr. Meera S, obstetrician, OB Units A and B | Care Team app (also a demo mother account) |
| 9000000002 | Dr. Arjun Menon, paediatrician, Paediatrics Unit | Care Team app |
| 9000000007 | Dr. Kiran Shah, Cardiology specialist (referrals only) | Care Team app |
| 9000000003 | Lakshmi K, pregnant mother | Family app |
| 9000000004 | Ravi K, Lakshmi's husband (caregiver) | Family app, sees what Lakshmi shares |
| 9000000006 | Meena T, mother who has delivered | Family app |

Login: **Phone** → OTP → if the number is both staff and family, **Which would you like to open?** → **Hospital care team** or **Mother / family**.

## The stages at a glance

```
 0. (nothing yet)       The mother has no app account until a doctor registers her pregnancy.
        │
 1. Registration        Obstetrician registers her. MCH ID issued, antenatal visits and tests planned,
        │               OB unit assigned, paediatric unit pre-assigned (sees her from 34 weeks).
        │               ── her phone number becomes her login → she onboards in the Family app.
 2. Antenatal care      Visits, tests, tags, referrals, prescriptions, call-backs, home readings.
        │               Change doctor/team, re-date, correct her details any time.
 3. Admission           Admit to the labour room (exact time + reason).
        │
 4. Delivery            Record the birth. Each baby gets a child ID, vaccine schedule, discharge
        │               checklist, and is assigned to the paediatric unit automatically.
 5. Discharge           Mother's and each baby's checklist → Complete discharge → postnatal and
        │               newborn follow-up visits are scheduled.
 6. Postnatal / baby    Paediatrician: observations, vaccines (0–24 months), reassignment.
        │               Family app switches to "My baby".
 7. Close               Obstetrician closes the mother's episode after her discharge.
```

**Is there a stage before pregnancy?** No. The app starts at the first antenatal contact, when a doctor registers the pregnancy. There's no preconception or "trying to conceive" stage, and a mother can't sign up herself. Her account exists only because a doctor registered her phone number. A second pregnancy later reuses the same mother record (see 1.4).

---

## 1. Registration: the obstetrician registers her

Only obstetricians see these actions.

1. In the Care Team app, tap the round **+** in the middle of the bottom bar → **Quick actions** → **Register pregnancy**.
2. **Step 1, Mother:**
   - Full name, age, village, **Preferred language**.
   - Her **mobile number. This becomes her app login.**
   - Emergency contact: name, relation and phone.
   - **More details (RCH id, address, ABHA …)**, optional: RCH ID, ABHA number or address, alternate phone, husband's name, date of birth (or **Estimated**), district, state and PIN.
   - **Next.**
3. **Step 2, Dating**, under **Date by — you choose**, pick one:
   - **LMP:** a date picker, marked certain or uncertain.
   - **Scan:** scan date, **GA at scan · weeks** **+ days**.
   - **Clinician:** the EDD you decide.
   - Optional **Dating note**. **Registered on** can be back-dated if she was first seen earlier.
   - **Next.**
4. **Step 3, Obstetric summary:**
   - G, P, L, A, and **Fetuses (as documented)**.
   - **Previous pregnancies (documented):** **Add a previous pregnancy** for each one, with **Year**, **Gestation**, **Outcome** (live birth, stillbirth, miscarriage, MTP, ectopic, molar, neonatal death), **Mode of delivery** (including assisted), complications and a note.
   - **History:** conditions (with **Other condition**), allergies, **Current medicines**, blood group, height.
   - **Tags (optional)** with a **Tag note**. Tags set how closely she's followed up; the app never scores risk.
   - **Obstetric unit:** pick one if you belong to more than one.
   - **Create & schedule.**
5. Result: **Pregnancy registered.** She gets an MCH ID, her antenatal visits and tests are scheduled, your unit is her obstetric team, and the paediatric unit is pre-assigned.

**1.4 Returning mother:** if the phone number is already on record at this hospital, you'll see **This number is on record here**:
- **Yes — same woman, use her record** prefills her details. One mother record, a new pregnancy.
- **No — someone else**: use a different number.

**If the server refuses** (say, a typo the form missed): the form shows **Last registration not saved** → **Restore the form**, so nothing typed is lost.

**Bulk:** **Quick actions → Import register** (a CSV file). Each row is reported as created, with its MCH ID, or rejected, with the reason.

## 1b. The mother starts using the app

1. She opens Vatsala → **Phone** (the number you registered) → OTP.
2. Onboarding:
   - **Choose your language.**
   - **Before we begin**, the consent notice → **I agree**.
   - **Your details**: she can only view them; corrections go through the hospital.
   - **How should we remind you?** App, WhatsApp or SMS → **Start**.
3. She sees her pregnancy week, her next visit and tests.

## 2. Antenatal care: managing the patient

Open her from the **Patients** tab (search by name, phone or MCH ID), or from a **Worklist** item.

**Her record (Patient screen), top to bottom:** the summary with her tags, EDD and allergies; **Case File** (AI brief); **Still due**; **Latest documented**; **Since last visit**; **Plan**; **Documented history**; referrals; prescriptions; visits; notes.

| To do this | Tap |
|---|---|
| Record a visit | **Record visit** (top) → vitals, checklist, complaints, counselling, next visit → **Save visit** |
| Enter or review a test | **Still due** → the test → **Mark as ordered** → **Save result** → **Mark reviewed** with a follow-up, or **Or mark not done** with a reason |
| Set follow-up intensity and tags | **Edit tags** → **Tags & follow-up** → **Save** |
| Prescribe (feeds the family's medicine reminders) | Prescriptions card → **Prescribe** → medicine, dose, **Times of day** → **Save prescription** |
| Refer to a department | Plan → **Refer** → department, urgency, reason, question → **Send referral** |
| Share a test result with that department | Referral → **Share** on the result |
| **Correct her details** (name, phone, address, IDs, contact) | Plan → **Edit details** → **Save corrections**. A corrected phone moves her login to the new number. |
| **Change her doctor or obstetric team** | Plan → **Care team** → **Change obstetric team** → pick a unit, a doctor or **Team (no named doctor)**, and a **Reason (recorded)** → **Reassign** |
| **Change the paediatric team** for this pregnancy | Plan → **Care team** → **Change paediatric team** (paediatricians only) |
| Re-date the pregnancy | Plan → **Re-date (EDD)**. Both EDDs are shown; you choose. Future visits are re-planned. |
| Capture a paper card (AI transcription) | Plan → **Capture paper record** → photo → confirm each field → save |
| See who opened her record | Plan → **Who viewed this record** |
| Post a note for the team | Bottom → **Add a note for the care team** → **Post note** |
| Correct a recorded fact | **Entered in error** on that visit, result, note or history item |
| End care early (miscarriage, transfer and so on) | Plan → **End of pregnancy care** → **How the pregnancy ended (as documented)** → date → **Continue** → **Confirm** |

**Daily work tabs:**
- **Worklist:** due and overdue visits and tests, and "Family reported warning sign" items.
- **Call-backs:** requests from families. Open one → **Call [number]** → **Close call-back** with the outcome.
- **Referrals:** incoming and outgoing. The specialist confirms, sets the appointment and writes the assessment.

**What the mother does meanwhile:**
- **Home:** her week, next visit and **I can't come**.
- **Schedule:** all visits and tests.
- **My pregnancy:** her records.
- **Learn.**
- **Record a reading:** BP, weight, baby's movements, contractions. Her team sees these on her record.
- The round middle button: **Ask the hospital to call me**, with warning signs, a note and a voice note.
- **My Card:** an emergency card with a QR code; she chooses what it shows.
- Her avatar (top-left of Home) → gear icon (Settings) → **Add family member**, then choose what each person can see (**Visits & reminders**, **Baby's vaccines & visits**, **Your readings**, **Test results**).

The paediatric unit sees her pregnancy under **Patients** from **34 weeks**.

## 3. Admission

1. Her record → Plan → **Admit / record delivery** → **Admit to the labour room?**
2. **Time of admission** (exact) and **Reason (as documented)** → **Admit**. An IP number is issued.
3. She now appears under **Profile** (your avatar, top-left of the Worklist) → **Labour room** → **Admitted**, with admission time, IP number and reason. **Record delivery** is one tap from there.
4. If she goes home undelivered: Plan → **End admission (no delivery)** → **Time the admission ended** → **End admission**.

## 4. Delivery

**Record delivery** (from the labour room, or her record's Plan):

- **Time and place of birth:**
  - **Date (DD-MM-YYYY)** and **Time (24-hour)**, or **Set to now**.
  - **Place of birth:** this facility, other facility, home or in transit.
  - **Attended by.**
- **Labour and delivery:**
  - **Onset of labour**, **Mode**, and the indication (for an LSCS or assisted delivery).
  - **Estimated blood loss**, **Perineum (as documented)** with "Other" text.
  - **Complications (documented)** and **Medicines given**, each with "Other" text.
  - **Mother's condition after delivery.**
  - **Number of babies**: 1–4.
- **Each baby:**
  - **Outcome**, and fresh or macerated for a stillbirth.
  - **Sex:** Girl, Boy or **Undetermined**.
  - Birth weight, length, head circumference, Apgar at 1 and 5 minutes.
  - Resuscitation, birth defects, breastfed within 1 hour, vitamin K, birth doses.
- **Save delivery.**

**What happens automatically on Save:**
- The pregnancy is marked delivered and the remaining antenatal visits are cancelled.
- Each baby gets a record with a child ID (`MCH-…-B1`, `-B2` …) and the full 0–24-month vaccine schedule (birth doses marked given if ticked).
- **Each live baby is assigned to the paediatric unit.** Its team gets a "baby born" notification. **No manual transfer is needed.**
- Discharge checklists open for the mother and each live baby.
- The family gets "baby arrived" (if they share baby details), and the Family app switches to **My baby**.

The **Delivery recorded** screen shows every baby (**Open baby ›**, **Discharge checklist**) and **Mother** → **Back to [name]**.

## 5. Discharge

The mother and each baby have **separate** checklists. Find them in any of these places:
- **Labour room → Delivered — awaiting discharge**, with buttons for the mother and each baby.
- The **Delivery recorded** screen.
- The mother's record → Plan → **Discharge checklist**.
- The baby page → **Follow-up** → **Discharge checklist**.
- The Worklist discharge item.

On the checklist:
1. Mark each item **Done**, **N/A** or **Defer**. N/A and Defer ask for a **Reason**, with "Other" text.
2. **Completing the discharge:** set the **Time of discharge**, and check **Follow-up visits this will schedule**. It says plainly if a visit's window has already passed.
3. **Complete discharge.** The admission closes, and the follow-up visits appear in the Family app.

## 6. Baby care: the paediatrician

Log in as Dr. Arjun (9000000002):

- **Patients** lists **Baby of [mother]** with the child ID. Tap it to open the baby page.
- **Birth record:** time of birth, weight, length, Apgar scores and the delivery details as documented.
- **Care team → Change paediatric team** to assign a named paediatrician or another unit, with a reason. This is how a baby moves to a specific paediatrician.
- **Record observation:**
  - **Time of observation.**
  - Weight, length, head circumference, temperature, respiratory rate.
  - **Feeding (as observed)**, **Jaundice assessment (as recorded)**, **Note.**
  - **Save observation.**
- **Vaccines:**
  - Tap a dose → **Record [vaccine]** → given on (exact date), **Where** (here, or elsewhere / from card), batch, expiry, manufacturer, **Site** and route. Or not given, with a **Reason**.
  - A wrong entry → **Entered in error**, which puts the dose back to due.
- **Prescribe**, **Edit tags**, **Discharge checklist**.
- **Record a baby's death:** **Date and time (as documented)**, which can't be before the birth → **Continue** → **Confirm**. All the baby's reminders stop, and the family app stops showing baby content.

Paediatric access to a baby lasts to the end of the 0–24-month schedule.

## 7. Closing the mother's episode

After **her** discharge is complete: her record → Plan → **Close episode** → **Continue** → **Confirm**. Before her discharge, the chip reads **Close episode (after discharge)** and the screen sends you to the checklist first. Once closed, she leaves the obstetric lists; her baby stays with the paediatric team.

## Other Care Team tools

- **Emergency access** to a patient outside your list: **Patients** → **Patient not in my list** → **MCH ID** (or **Scan her card**) → **Reason (required)** → **Open record with emergency access**. Access lasts 24 hours at most, is shown with a banner, and is audited.
- **Handoff:** a printable summary of documented facts, from the top of her record.
- **Notifications:** the bell on the Worklist, covering call-backs, referral steps and babies born.
