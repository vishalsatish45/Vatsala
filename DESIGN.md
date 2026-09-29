# [App Name TBD] — Design System & Screen Map

| | |
|---|---|
| Version | 0.1 |
| Date | 2026-09-28 |
| Companion to | [PRD.md](PRD.md) v0.2 (feature IDs `F-xx` refer to the PRD) |
| Platform | React Native (Expo), Android-first |

---

## 1. Inspiration Sources

| Source | What we take | What we leave |
|---|---|---|
| **A: Background & navbar** · `Screenshot 2026-09-28 203708.png` (pink/lavender pregnancy app) | Rose → lavender mesh-gradient background; soft blurred "blob" behind the hero; frosted-glass surfaces; **floating navbar of 4 glass circle buttons + a larger rose centre button with a glow**; glass circle back/share buttons in the top corners; the huge hero number ("24th") with pill chips under it | Photo-heavy cards everywhere (kept for Learn only); white body text on pink (fails contrast) |
| **B: UI elements** · `Screenshot 2026-09-28 200607.png` (cream serif tracker) | Serif display headings; segmented pills (active = dark pill); underline tabs; icon + label chips; 2×2 stat tiles (icon badge + label + big number + small unit); week day-strip with filled / hatched / outlined states; completion rings; list rows with trailing chevron and an expandable 4-column stats row; gradient promo card with line illustration and an in-card button; bar chart with a highlighted bar + dotted average line; hatched line-chart area | Leaderboards/rankings (not appropriate for patients); orange as the primary colour (becomes a secondary highlight) |
| **C: Secondary** · purple "Pregnancy Monitor" | Horizontal **week scrubber** (12W · 16W · 20W …) over a timeline card; list rows with a thumbnail + week chip + circular arrow button | Purple palette |

**The blend in one sentence:** *Screen A's atmosphere (rose-lavender glass world, floating circular navbar) with Screen B's components (serif headings, hairline cards, pills, tiles, rings, hatching), restyled in rose instead of orange.*

---

## 2. Design Principles

1. **Calm, warm, trustworthy.** The rose/lavender glass world feels caring, not clinical, for families. The Care Team gets the same world at a quieter volume.
2. **One hero, one next step.** Every screen has one big thing (week number, next visit, "3 need you now"). Everything else is secondary.
3. **Status is operational, never clinical** (hackathon rule, PRD §2.2). Colours mark **task status** (done / due / overdue / missed / upcoming), never the meaning of a clinical value. Vitals and results are always shown in neutral ink. Every coloured status also carries an icon and a word.
4. **Hatching means "not happened".** Taken from Screen B's striped day cells, hatched fill is our universal sign for *missed* (past) or *planned* (future, lighter hatch). This makes gaps visible at a glance on the timeline, day-strips and rings.
5. **Readable first.** Glass is decoration. Text always sits on a surface opaque enough for AA contrast, and Indic scripts get proper fonts and line heights.
6. **Cheap on low-end Android.** Blur is faked with translucent fills on Android (§3.7). Gradients are drawn once per screen.

---

## 3. Design Tokens

All tokens live in `src/ui/tokens.ts` and are consumed through `useTheme()`. Two **moods** share one token set: `family` (full-strength Screen A atmosphere) and `care` (softened, denser, more opaque surfaces for clinical legibility).

### 3.1 Colour

```ts
// src/ui/tokens.ts
export const palette = {
  // Atmosphere (Screen A)
  rose50:  '#FDF1F6',
  rose100: '#F9DDE9',
  rose200: '#F6B8CF',   // gradient top
  rose300: '#EE9CBD',   // blob core
  rose500: '#E0709A',   // PRIMARY (centre nav button, active states)
  rose600: '#C9557F',   // primary pressed / text-on-light accent
  lav100:  '#EEE8FB',
  lav200:  '#D9CCF3',   // gradient bottom
  lav400:  '#B9A6EE',   // secondary accent (tags, info)
  // Neutrals (Screen B)
  cream:   '#FBF7F2',
  beige:   '#F1EBE3',   // inactive pill fill
  hairline:'#EDE4DC',   // card borders
  white:   '#FFFFFF',
  ink:     '#2E1F2A',   // primary text (plum-black), active pill fill
  inkSoft: '#6E5A67',   // secondary text
  inkFaint:'#A5949E',   // tertiary text, upcoming status
  // Warm highlight (Screen B's orange, demoted)
  peach:   '#F6B28A',
  amber:   '#F28C38',   // chart highlight / "today" marker
  // Operational status (never used for clinical values)
  done:    '#4E9E78',   // sage
  due:     '#D9962B',   // amber-ochre
  overdue: '#D6524B',   // coral
  info:    '#7C6FE0',
};

export const moods = {
  family: {
    bgGradient: ['#F6B8CF', '#F3D2E3', '#D9CCF3'],   // top → bottom
    blob: { color: '#EE9CBD', opacity: 0.85, radius: 0.75 }, // behind hero
    glass: 'rgba(255,255,255,0.55)',
    glassStrong: 'rgba(255,255,255,0.78)',
    glassBorder: 'rgba(255,255,255,0.75)',
    card: '#FFFFFF',
  },
  care: {
    bgGradient: ['#FBEAF1', '#F7F1F6', '#EFEAFA'],   // same hues, ~70% lighter
    blob: { color: '#F6C9DB', opacity: 0.6, radius: 0.55 },
    glass: 'rgba(255,255,255,0.80)',
    glassStrong: 'rgba(255,255,255,0.92)',
    glassBorder: 'rgba(255,255,255,0.90)',
    card: '#FFFFFF',
  },
} as const;
```

**Semantic roles**

| Role | Token | Use |
|---|---|---|
| `text.primary` | ink | All body text, all clinical values |
| `text.secondary` | inkSoft | Labels, captions |
| `text.onPrimary` | white | Only on rose500 and larger than 18 sp bold |
| `accent.primary` | rose500 | Centre nav button, primary buttons, active tab, progress fill |
| `accent.secondary` | lav400 | Clinician tags, info chips |
| `highlight` | amber | "Today" marker in day-strips, highlighted chart bar |
| `status.done / due / overdue / missed / upcoming` | done / due / overdue / overdue + hatch / inkFaint + light hatch | Task & visit status only |

**Dark mode:** not in the MVP. Tokens are structured so a `dark` mood can be added later.

### 3.2 Typography

| Style | Font | Size / line | Use | From |
|---|---|---|---|---|
| `display` | **Instrument Serif** Regular | 34 / 40 | Screen titles ("Your next visit", "Needs you today") | B |
| `title` | Instrument Serif | 24 / 30 | Section headings ("Weight breakdown" style) | B |
| `hero` | **DM Sans** Bold | 64 / 68, tracking −1 | Big numbers: pregnancy week, baby age, worklist count | A |
| `stat` | DM Sans Bold | 34 / 38 (+ unit at 14 Medium) | Stat tiles ("61.4 kg", "146/94") | A + B |
| `headline` | DM Sans SemiBold | 17 / 22 | Card titles, row titles | — |
| `body` | DM Sans Regular | 15 / 22 | Body | — |
| `label` | DM Sans Medium | 13 / 18 | Chips, pills, field labels | B |
| `caption` | DM Sans Regular | 12 / 16 | Timestamps, meta | — |

- **Indic scripts:** Kannada uses **Noto Sans Kannada** (body) and **Noto Serif Kannada** (display). Hindi uses **Noto Sans Devanagari** and **Noto Serif Devanagari**. Line height is +20% for Indic, and nothing is truncated on titles.
- Fonts are loaded with `@expo-google-fonts/*` and `expo-font` during splash.
- Numbers use tabular figures in tiles and tables.

### 3.3 Spacing, radius, elevation

```ts
export const space  = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 12, md: 16, lg: 20, card: 24, sheet: 32, pill: 999 };
export const elevation = {
  card:  { shadowColor: '#C9557F', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  float: { shadowColor: '#C9557F', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  glow:  { shadowColor: '#E0709A', shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },  elevation: 10 }, // centre nav button
};
```

- Screen gutter is 20. Card padding is 16–20. Gap between cards is 12.
- Minimum touch target is 44 dp (the nav circles are 48 dp; the centre button is 64 dp).

### 3.4 Iconography & illustration

- **lucide-react-native**, 1.75 px stroke, 22 px in nav, 18 px in chips. Icons are rose600 on glass and ink on white.
- Chips and tiles use **small colour-badged icons** (Screen B: an icon inside a 28 px tinted rounded square).
- **Line illustrations** in Screen B style (hand-drawn strokes + sparkles) for Next Step cards, empty states and onboarding. These are simple SVGs in `src/ui/illustrations/`.
- Warning-signs content uses **clear, culturally appropriate illustrations**. Photos are only used in Learn cards (Screen A middle).

### 3.5 Motion

- Press feedback: scale 0.96 with a spring (Reanimated) + light haptic.
- Screen transitions: native stack defaults. Sheets slide up with a spring.
- **Signature motion:** the continuity timeline *splits* into mother and baby lanes with a 500 ms eased branch animation when it scrolls into the delivery node.
- Hero blob drifts slowly (20 s loop, ±12 px). This is disabled when the system "reduce motion" setting is on and on low-RAM devices.

### 3.6 Patterns: hatching

- `hatch.missed`: 45° stripes in overdue at 35% opacity over beige, for past items that didn't happen.
- `hatch.planned`: 45° stripes in inkFaint at 15% opacity, for future items.
- Implemented as a reusable SVG `<Pattern>` in `src/ui/patterns.tsx`.

### 3.7 Glass implementation (performance)

- **iOS & high-end Android:** `expo-blur` `BlurView` (intensity 30–40) behind the glass fill.
- **Default Android:** no blur. A translucent fill (`glass` / `glassStrong`) + a 1 px `glassBorder` + a soft inner highlight (a top 1 px white line at 60%). This looks almost identical over our soft gradient and costs nothing.
- The background gradient uses `expo-linear-gradient`. The blob is a single `react-native-svg` radial gradient, drawn once per screen by `<Atmosphere>`.

---

## 4. Component Library (`src/ui/`)

| Component | Description | From | Used in |
|---|---|---|---|
| `Atmosphere` | Full-screen gradient + optional hero blob; `mood="family" \| "care"` | A | Every screen root |
| `GlassSurface` | Frosted card (radius 24, glass fill, border, float shadow) | A | Hero cards, sheets, nav |
| `Card` | **Frosted glass card** — white → translucent vertical gradient, soft white rim, top sheen, radius 28 (replaced B's hairline white cards on 2026-09-29) | A | Lists, forms, tiles |
| `GlassIconButton` | 44 dp glass circle with icon (back, share, bell, scan) | A | Top bars |
| `TopBar` | Glass back button · centred title · glass action button | A | All stack screens |
| `HeroNumber` | Big number + caption + pill chips row ("24th · 2nd Trimester · Monday · March 31") | A | Family home, baby home, worklist header |
| `FloatingNavBar` | 4 × 48 dp glass circles + centre 64 dp rose gradient button with glow; labels hidden, a11y labels set; the active tab gets a rose-filled circle | A | Tab layouts (both faces) |
| `ActionSheet` | Opens from the centre button: 2×2 grid of large tiles with icon badge | B ("Following" tiles) | Centre-button actions |
| `SegmentedPills` | Pill group; active = ink fill + white text, inactive = beige | B | Filters (Now/Today/This week; Pregnancy/After birth/Baby) |
| `UnderlineTabs` | Text tabs with a 2 px rose underline | B | Patient view sections |
| `Chip` | Pill with icon badge + label; selectable / toggle / static | B | Self-log items, tags, warning-sign ticks, meta |
| `TagChip` | Lavender chip for **clinician tags**; small "tag" icon | — | Patient header, worklist rows |
| `IntensityPill` | Neutral pill: Routine · Enhanced · Close, with 1/2/3-dot icon (no red) | — | Patient header, rows |
| `StatTile` | Glass tile: centred label, oversized number (48 sp) + small unit ("7 wks", "14 Nov"); neutral colours only; optional "home reading" badge + date | A | Latest documented values, birth details, KPI |
| `ProgressBar` | Rounded bar with label and % ("24/40 weeks · 60%") | A | Pregnancy progress, checklist progress |
| `CompletionRing` | Ring with centre text (9/10) or "?" for unknown; segments hatched when missing | B | ANC visit completeness, discharge checklist, day rings |
| `DayStrip` | Horizontal week of day tokens: done (filled rose), today (amber ring + marker ▼), missed (hatch.missed), planned (hatch.planned), none (outline) | B | Family schedule, Care Team patient visits |
| `WeekScrubber` | Horizontal GA scale (12W…40W) with a draggable knob on the current week | C | Family pregnancy timeline |
| `ListRow` | Glass row (strong fill) · leading avatar/initials/thumbnail · title · subtitle · trailing meta · chevron or circular arrow button; **expandable** to show a 4-column stat row | B + C | Worklist, patient lists, tests, vaccines |
| `StatusBadge` | Icon + word + colour: ✓ Done · ◷ Due · ! Overdue · ✕ Missed · ○ Upcoming | — | Everywhere a task appears |
| `NextStepCard` | Peach → rose gradient card, line illustration top-right, title + meta, full-width white button inside | B | Family home, Care Team patient "Still due" top item |
| `StoryCard` | Photo card with glass caption panel ("Lungs are Maturing") in a stacked deck | A (middle) | Learn, weekly education |
| `VoicePill` | Rose gradient pill with mic badge ("Start talking") → recording state with waveform | A (middle) | Call-back voice note, dictation |
| `AskCard` | Glass card: prompt + suggestion chips + mic row | A (right) | Family "Ask the hospital to call me" entry |
| `BarChart` | Beige bars, one highlighted rose/amber bar with a value bubble, dotted average line with a dark tag | B | KPI screen (weekly on-time %) |
| `TrendLine` | Thin line with a hatched area and neutral colours; points labelled with dates | B | Documented BP/weight trend (no thresholds, no colour bands) |
| `TimelineLane` / `TimelineNode` | Vertical lanes with nodes (icon, date, GA/age stamp, StatusBadge); lane split at delivery | — | Continuity timeline |
| `ChecklistRow` | Item + state (✓ / ○ / N/A / Not done + reason) + quick actions | B (chip style) | ANC completeness, discharge |
| `SyncBadge` / `OfflineBanner` | ⏳ Pending · ✓ Synced; glass banner "Offline, showing data from 10:42" | — | Global |
| `EmptyState` | Line illustration + serif line + one action | B | Empty lists |
| `Sheet` | Bottom sheet (radius 32, glassStrong) | A | Overrides, outcomes, pickers |
| `Field` / `NumericField` | Large numeric input tile (StatTile-styled while editing), unit suffix | B | Visit entry, self-log |

**Compliance rule baked into components:** `StatTile`, `TrendLine` and `Field` accept **no status/colour prop**. Clinical values physically cannot be coloured. `StatusBadge` only accepts task statuses.

---

## 5. Navigation

### 5.1 Floating navbar (both faces)

```
        ╭────╮ ╭────╮   ╭────────╮   ╭────╮ ╭────╮
        │ ◯  │ │ ◯  │   │   +    │   │ ◯  │ │ ◯  │      ← 48 dp glass circles, 64 dp rose centre with glow
        ╰────╯ ╰────╯   ╰────────╯   ╰────╯ ╰────╯
         tab1   tab2    actions       tab3   tab4
```

- Floats 12 dp above the home indicator with no bar background (Screen A). Content scrolls underneath, and the last scroll item gets 110 dp bottom padding.
- Active tab: the circle fills rose500 with a white icon. Inactive: glass with a rose600 icon.
- Accessibility: each circle has an `accessibilityLabel`. A long-press shows the label as a tooltip.
- Hidden on forms and on full-screen flows (visit entry, delivery, onboarding).

### 5.2 Family face tabs

| Slot | Icon | Destination |
|---|---|---|
| 1 | `home` | **Home** (FH-01) |
| 2 | `calendar-days` | **Schedule** (FH-10) |
| ● centre | `plus` | **Actions sheet:** Ask the hospital to call me · Log a reading · Warning signs · My card |
| 3 | `baby` / `heart-pulse` | **My Pregnancy** (FH-20) before delivery → **My Baby** (FH-30) after delivery (both via a switcher when both exist) |
| 4 | `book-open` | **Learn** (FH-50) |

Profile & settings: an avatar in the Home top bar.

### 5.3 Care Team face tabs

| Slot | Icon | Destination |
|---|---|---|
| 1 | `layout-list` | **Worklist** (CT-01) |
| 2 | `users` | **Patients** (CT-10) |
| ● centre | `plus` | **Actions sheet:** Register pregnancy · Record visit (pick patient) · Scan patient QR · Import register |
| 3 | `phone-call` | **Call-backs** (CT-40), with a badge count |
| 4 | `git-pull-request-arrow` | **Referrals** (CT-50) |

Profile, KPI, labour room and settings: an avatar in the Worklist top bar → Profile hub (CT-80).

### 5.4 Route map (expo-router)

```
app/
├── (auth)/welcome · phone · otp · choose-face
├── (onboarding)/language · consent · details · channels · lock           (family first run)
├── (family)/
│   ├── (tabs)/index · schedule · journey · learn
│   ├── schedule/[taskId]
│   ├── pregnancy/{timeline, visits/[id], tests/[id], readings, medicines}
│   ├── baby/[babyId]/{index, vaccines, visits, log}
│   ├── actions/{callback, log/[kind], warning-signs, card}
│   ├── learn/[slug]
│   └── me/{profile, caregivers, caregivers/add, channels, language, lock, consent, contact}
└── (care)/
    ├── (tabs)/index · patients · callbacks · referrals
    ├── register/{identity, obstetric, dating, history, tags, review}
    ├── import/{upload, mapping, preview, done}
    ├── capture/{camera, review/[docId]}                                     (P1)
    ├── p/[pregnancyId]/{index, timeline, tests, referrals, notes, visit/new, tags, discharge, handoff, brief}
    ├── b/[babyId]/{index, observe/new, vaccines, tags, discharge}
    ├── labour/{index, admit/[pregnancyId], deliver/[pregnancyId], delivered/[deliveryId]}
    ├── referrals/{new, [id]}
    ├── kpi
    └── me/{profile, access-history, dev}
```

---

## 6. Screen Map: Family Face

Legend: **P0** must for demo · **P1** if time · Features refer to PRD IDs.

### 6.1 Auth & onboarding

| ID | Screen | Purpose | Key content & components | Features | P |
|---|---|---|---|---|---|
| AU-01 | Welcome | Pick a door | Atmosphere(family) + blob; serif "Care for you and your baby, every step"; two large GlassSurface buttons: **Family (mother / caregiver)** · **Hospital care team**; language switch pill | F-01 | P0 |
| AU-02 | Phone | Enter number | +91 prefilled; big numeric field; "We'll send a 6-digit code" | F-01 | P0 |
| AU-03 | OTP | Verify | 6 glass boxes; auto-read; resend timer; error states (unknown number → "Ask your hospital to register you") | F-01 | P0 |
| AU-04 | Choose face | Dual-role users | Two cards: Care Team / Family | F-01 | P0 |
| ON-01 | Language | Choose language | Three big cards in their own script: English · ಕನ್ನಡ · हिन्दी | F-03, F-62 | P0 |
| ON-02 | Consent | Plain-language consent | Illustrated sections (what's stored, who sees it, reminders, "the app doesn't give medical advice"); "I agree" / "Not now" | F-03 | P0 |
| ON-03 | Your details | Confirm name, hospital, emergency contact | Card form; hospital shown read-only | F-03 | P0 |
| ON-04 | Reminders | Choose channels + notification permission | Toggle chips: App · WhatsApp · SMS; permission explainer | F-03, F-04, F-49 | P0 |
| ON-05 | App lock | Optional PIN / biometric | "Recommended if others use this phone" | F-03 | P1 |

### 6.2 Home

**FH-01 Home (pregnancy mode)**: P0 · F-40, F-44
```
[avatar]                                   (bell)
            Pregnancy week                      ← Atmosphere(family) + blob
               32nd                             ← HeroNumber
   ( 3rd trimester ) ( Monday ) ( 28 Sep )      ← pill chips
╭──────────────────────────────────────────╮
│ Next step                    ✦ (illustr.)│   ← NextStepCard
│ Hospital visit · Mon 5 Oct · 10:00 AM    │
│ OPD Block B · Bring MCP card, reports    │
│ Come without breakfast (sugar test)      │
│ [        See details        ]            │
╰──────────────────────────────────────────╯
 Coming up                                   ← title (serif)
 ▢ Sugar test (OGTT) · before 12 Oct   ◷ Due >
 ▢ Cardiology OPD · 3 Oct 11 AM        ○    >
╭─────────────╮ ╭─────────────╮
│ 📞 Ask the  │ │ ⚠ Warning   │              ← quick tiles (ActionSheet style)
│ hospital to │ │ signs       │
│ call me     │ │             │
╰─────────────╯ ╰─────────────╯
      ( ◯ ) ( ◯ )  (  +  )  ( ◯ ) ( ◯ )     ← FloatingNavBar
```
- Pregnancy progress `ProgressBar` ("32/40 weeks · 80%") under the chips (Screen A left).
- If intensity is Enhanced/Close: a soft info line "Your doctor wants to see you more often".
- Caregiver view: the same, with the mother's name in the hero caption ("Lakshmi · week 32") and a switcher if they're linked to more than one mother.

**FH-02 Home (after delivery)**: P0 · F-40, F-43
- The hero switches to the baby: "**12** days" (HeroNumber) with chips (girl · 2.38 kg at birth · born 9 Nov).
- Two NextStepCards stacked: **For you** (postnatal Day-7 visit) and **For baby** (Penta-1 due 21 Dec).
- The quick tiles are the same.
- **Bereavement variant:** no baby hero. A calm "Taking care of you" hero; only the postnatal plan and a support contact.

### 6.3 Schedule

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| FH-10 | Schedule | SegmentedPills (**Week · Month · All**); `DayStrip` (done / today / missed / planned hatching); list of items as `ListRow` with StatusBadge, mother/baby icon, place | F-44 | P0 |
| FH-11 | Item detail | Title (serif), date/time/place card, **What to bring** chips, **How to prepare** list, "Add to calendar", "Open in Maps", "I can't come" → confirmation + hospital phone | F-44 | P0 |

### 6.4 My Pregnancy (tab 3 before delivery)

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| FH-20 | My Pregnancy | Screen C-style `WeekScrubber` timeline card (12W…40W, knob at 32); UnderlineTabs **Journey · Tests · Readings · Medicines** | F-41, F-06 | P0 |
| FH-21 | Journey | Simplified continuity timeline (family version: no tags, no sensitive items); future nodes hatched-planned; missed visits hatched-missed with "Call to reschedule" | F-06 | P0 |
| FH-22 | Tests | ListRows (Screen C style: icon thumbnail + week chip + circular arrow): Done · Due (window) · "Discuss at your visit". Sensitive tests show only "Done" | F-41 | P0 |
| FH-23 | Readings | StatTiles 2×2 (Weight · BP · …) with "recorded at hospital" / "you recorded" badges + dates; neutral `TrendLine`; "Add a reading" | F-41, F-42 | P0 |
| FH-24 | Medicines | Rows with time chips, Taken / Skipped | F-46 | P1 |

### 6.5 My Baby (tab 3 after delivery)

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| FH-30 | Baby home | Screen A-left layout: glass hero "**6** weeks · Tiny body, big changes"; `StatTile` pair **Birth weight 2.38 kg** · **Latest weight 3.9 kg** (documented, dated); next visit + next vaccine cards; twin tabs if needed | F-43 | P0 |
| FH-31 | Vaccine card | Age groups (Birth · 6 wks · 10 wks · 14 wks · 9 mo · 16–24 mo) as Cards; each dose a Chip with StatusBadge (Given ✓ date · Due · Overdue · Upcoming) | F-24, F-43 | P0 |
| FH-32 | Baby visits | Same pattern as Schedule filtered to baby | F-43 | P0 |
| FH-33 | Baby log | Chips: Feeding well / poorly / not feeding · weight at a centre · note; saved as family-reported | F-42 | P0 |

### 6.6 Centre actions

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| FA-00 | Actions sheet | 2×2 big tiles: **Ask the hospital to call me** · **Log a reading** · **Warning signs** · **My card** | — | P0 |
| FA-01 | Ask for a call | `AskCard` (Screen A right): "Tell the hospital what's happening"; optional Chips of listed signs/concerns; `VoicePill` voice note or text; **Send**. The call buttons (**108**, **Hospital**) stay pinned at the bottom | F-42, F-25 | P0 |
| FA-02 | Request sent | Illustration; "The hospital will call you on 98xxxx"; time sent; offline state: ⏳ "Not sent yet. If it's urgent, call 108 or the hospital now" | F-42, F-61 | P0 |
| FA-10 | Log: choose | Tiles: Blood pressure · Weight · Baby's movements · After-birth recovery · Baby feeding | F-42 | P0 |
| FA-11 | Log: entry | Big `NumericField` tiles (BP sys/dia, weight) or counters (movements); date/time; saved confirmation with **no evaluation text** | F-42 | P0 |
| FA-20 | Warning signs | SegmentedPills **Pregnancy · After birth · Baby**; illustrated cards grid; banner: "If you notice any of these, go to the hospital now or call 108"; sticky call buttons; "Ask the hospital to call me" link | F-42, 10.6 | P0 |
| FA-30 | My card | Glass card with the chosen fields + large QR; "Edit what's shown" | F-45 | P1 |
| FA-31 | Card: edit fields | Toggle rows per field (sensitive defaults off) | F-45 | P1 |

### 6.7 Learn

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| FH-50 | Learn | UnderlineTabs **This week · Pregnancy · After birth · Newborn**; `StoryCard` deck for the current week (Screen A middle: "Lungs are maturing"), topic rows below | F-47 | P1 |
| FH-51 | Article | Photo/illustration header, serif title, short sections, audio (P2), "Reviewed by Dr. … on …" footer | F-47 | P1 |
| FH-52 | Newborn day-by-day | `DayStrip` by baby age; one card per day (feeding, warmth, cord, when to return) | F-47 | P1 |

### 6.8 Me (profile)

| ID | Screen | Key content | Features | P |
|---|---|---|---|---|
| FM-01 | Profile hub | Name, hospital, MCH ID + QR, rows to the screens below, sign out | — | P0 |
| FM-02 | Caregivers | Caregiver cards with scopes as Chips; Add; Remove (confirm sheet) | F-05 | P0 |
| FM-03 | Add caregiver | Name, relation chips, phone, scope toggles, confirm | F-05 | P0 |
| FM-04 | Reminder channels | Toggles App / WhatsApp / SMS; quiet hours info | F-04, F-49 | P0 |
| FM-05 | Language | Same as ON-01 | F-62 | P0 |
| FM-06 | App lock | PIN/biometric | F-03 | P1 |
| FM-07 | Consent | Version, date, withdraw | F-03 | P0 |
| FM-08 | Hospital contact | Labour room, OPD, 108/102, Maps | F-48 | P0 |

---

## 7. Screen Map: Care Team Face

The Care Team uses `Atmosphere mood="care"`: the same rose-lavender world but lighter, with more opaque cards and denser rows (row height 64 vs 72).

### 7.1 Worklist (tab 1)

**CT-01 Worklist**: P0 · F-10, F-15, F-23, F-25
```
[avatar]  Good morning, Dr. Priya        (scan)(bell)
             Needs you today
                  17                              ← HeroNumber (care mood, smaller blob)
      ( Now 2 ) ( Today 9 ) ( This week 6 )       ← SegmentedPills (active = ink)
╭──────────────────────────────────────────────╮
│ (LK) Lakshmi K · MCH-2026-001245        ›    │   ← ListRow
│      Call-back requested · 12 min ago        │
│      [Family reported warning sign]          │   ← label chip (ticked by family)
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│ (SR) Sunita R · 34+1 · ●●● Close        ›    │
│      ✕ Missed visit · due 15 Sep · 3 days    │
│  ▾ GA 34+1 │ Last visit 1 Sep │ Tries 1 │ Ph │   ← expandable 4-col row (Screen B)
│  [Call] [WhatsApp] [Reschedule] [Outcome]    │
╰──────────────────────────────────────────────╯
      ( ◯ ) ( ◯ )  (  +  )  ( ◯ ) ( ◯ )
```
- Search field (glass) under the hero; the QR scan button in the top bar.
- Row kinds: call-back · missed visit · result to review · referral to accept · test window closing · discharge incomplete · vaccine overdue. Each has an icon badge and StatusBadge.
- Swipe actions: Snooze · Reassign · Close with outcome (→ CT-91).
- Paediatrician: the same screen, filtered to newborn items by default.

### 7.2 Patients (tab 2)

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| CT-10 | Patients | Search; SegmentedPills **Pregnant · Delivered · Babies**; smart-list chips (Close follow-up due this week · Due to deliver in 2 wks · Results to review · Overdue vaccines); ListRows with GA/age, TagChips (max 2 + "+n"), IntensityPill | F-26, F-28 | P0 (smart lists P1) |

### 7.3 Patient (pregnancy)

**CT-20 Patient view**: P0 · F-12, F-14, F-06
```
(‹)             Lakshmi K                  (⋯)
      MCH-2026-001245 · 24 y · G2P1L1              ← caption
             32+2 weeks                            ← HeroNumber (care)
   ( EDD 14 Nov ) ( B+ ) ( ⚠ Allergy: penicillin )
   [Previous caesarean] [Hypertensive disorder]    ← TagChips (lavender)
   ( ●●● Close follow-up )  [Edit tags]            ← IntensityPill
 Overview   Timeline   Tests   Referrals   Notes   ← UnderlineTabs
╭──────────────────────────────────────────────╮
│ Still due                         ◔ 3 items  │   ← Card + CompletionRing
│ ○ Urine albumin · this visit    [Record][N/A]│   ← ChecklistRow
│ ! OGTT · window closed 20 Sep   [Order][N/A] │
│ ◷ Anaesthesia review · by 36 wks   [Refer]   │
╰──────────────────────────────────────────────╯
 Since last visit (14 Sep)                         ← serif title
 • Cardiology: seen 20 Sep, recommendations ›
 • Home BP logged 2× (family-reported) ›
 • Call-back 25 Sep, closed: visit scheduled ›
 Latest documented                                 ← serif title
 ╭──────────╮ ╭──────────╮
 │ ⚖ Weight │ │ ♡ BP     │                        ← StatTiles (neutral)
 │ 61.4 kg  │ │ 146/94   │
 │ 28 Sep   │ │ 28 Sep   │
 ╰──────────╯ ╰──────────╯
 [ ✦ Consultation brief (AI draft) ]               ← P1
 [      Record visit      ]                        ← primary button (sticky)
```

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| CT-21 | Timeline tab | Full continuity timeline, filter chips (All · Visits · Tests · Referrals · Tags · Baby); split lanes after delivery | F-06 | P0 |
| CT-22 | Tests tab | Grouped Due / Ordered / Resulted (to review) / Reviewed; row actions Order · Enter result · Mark reviewed; "+ Order test" | F-16 | P0 |
| CT-23 | Enter result | Value + unit or Pos/Neg or scan findings; attach photo (P1); lab flag as transcribed | F-16 | P0 |
| CT-24 | Review result | Result as entered; follow-up choice chips (None · Repeat · Refer · Discuss next visit); note | F-16 | P0 |
| CT-25 | Referrals tab | Referral cards with a status stepper (Requested → Accepted → Scheduled → Seen → Recommendations → Closed) | F-17 | P0 |
| CT-26 | Notes tab | Threaded notes, @department | F-26 | P1 |
| CT-27 | Tags & intensity | Sheet: tag catalogue as selectable Chips (grouped Maternal/Obstetric/Social), note field; intensity SegmentedPills Routine · Enhanced · Close; preview "5 visits will be rescheduled every 2 weeks"; removal requires a reason | F-14 | P0 |
| CT-28 | Consultation brief | Sheet: **"AI draft, unverified"** banner; sentences with source chips (tap → record); Verify / Discard | F-27 | P1 |
| CT-29 | Handoff summary | One-page structured summary; Share PDF (P1) | F-29 | P0 |
| CT-30 | Record visit | Full-screen form. Top: `CompletionRing` live (e.g. 6/10). Sections as Cards: Vitals (NumericField tiles), Examination chips, Tests & dispensing checklist, Complaints chips, Counselling chips, Next visit (DayStrip picker, pre-filled). Offline SyncBadge | F-13 | P0 |
| CT-31 | Visit saved: gaps | Sheet listing unrecorded items: Record now · Not done today (reason chips) · N/A; then "Done" → summary (completeness %, still due, tasks closed) | F-13 | P0 |
| CT-32 | Override task | Common sheet: re-date / reassign / cancel + required reason | F-22 | P0 |

### 7.4 Registration & import (centre actions)

| ID | Screen | Key content | Features | P |
|---|---|---|---|---|
| CT-60 | Actions sheet | Tiles: Register pregnancy · Record visit · Scan patient QR · Import register · (P1) Capture paper record | — | P0 |
| CT-61 | Register: identity | Name, age/DOB, phone (existing-patient check), MRN, address, emergency contact, language, channels | F-11 | P0 |
| CT-62 | Register: obstetric | G/P/L/A steppers with validation; previous pregnancies repeatable Cards | F-11 | P0 |
| CT-63 | Register: dating | LMP + certainty; dating scan; **both EDDs shown side by side; the clinician picks the source** | F-11 | P0 |
| CT-64 | Register: history | Condition chips, allergies, medicines, surgeries, blood group, height/weight | F-11 | P0 |
| CT-65 | Register: tags (optional) | Same as CT-27 | F-14 | P0 |
| CT-66 | Register: review | Summary cards; **Create** → success with MCH ID + QR + "Show the mother how to install" (QR to the app) | F-11, F-02 | P0 |
| CT-70 | Import: upload | Pick .xlsx/.csv; sample template download | F-30 | P0 |
| CT-71 | Import: mapping | Column → field pickers; saved mapping per hospital | F-30 | P0 |
| CT-72 | Import: preview | Valid / warning / rejected counts; row list with reasons; Confirm | F-30 | P0 |
| CT-73 | Import: done | Created N pregnancies; "Past windows marked 'confirm status'" | F-30 | P0 |
| CT-74 | Capture: camera | Frame guide for ANC card / lab report / register page | F-31 | P1 |
| CT-75 | Capture: review | Image on top, extracted fields below with confidence; edit; confirm each field | F-31 | P1 |

### 7.5 Call-backs (tab 3)

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| CT-40 | Call-back queue | SLA timer per row ("12 min"); pinned rows labelled *Family reported warning sign*; row shows who requested (mother / caregiver / WhatsApp reply), language | F-25 | P0 |
| CT-41 | Call-back detail | Ticked items as reported, voice note player, text, recent self-logs (as entered), patient summary link; **Call** button | F-25 | P0 |
| CT-42 | Call outcome | Sheet: outcome chips (Advised to come in · Visit scheduled · Information given · Unreachable · Other) + note | F-25 | P0 |

### 7.6 Referrals (tab 4)

| ID | Screen | Key content | Features | P |
|---|---|---|---|---|
| CT-50 | Referrals | SegmentedPills **Incoming · Outgoing**; rows with status stepper mini-dots and age | F-17 | P0 |
| CT-51 | New referral | Department chips, urgency pills, reason, question, context bundle checklist | F-17 | P0 |
| CT-52 | Referral detail | Stepper, bundle, actions per role (Accept / Schedule / Document recommendations / Close / Decline) | F-17 | P0 |

### 7.7 Labour, delivery, baby, discharge

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| CT-55 | Labour room | List of admitted mothers (ListRows with admitted time, GA) | F-18 | P0 |
| CT-56 | Admit | Indication chips, notes, vitals tiles | F-18 | P0 |
| CT-57 | Record delivery | Stepper: Delivery details → Baby 1 (→ Baby 2) → Review. Sensitive-outcome handling | F-18 | P0 |
| CT-58 | Delivered | Celebration-light screen (or neutral for loss): baby IDs `-B1` with QR; "Paediatrics notified"; buttons **Open baby** · **Mother's discharge** | F-18, F-19 | P0 |
| CT-90 | Baby view | Hero "Day 2 · Girl"; **Mother's history** glass panel (tags, documented conditions, results as entered, delivery details, each ›source); StatTiles (birth weight, latest weight, GA at birth, Apgar 6/8, all neutral); UnderlineTabs Overview · Timeline · Vaccines · Tests | F-19, F-20 | P0 |
| CT-92 | Baby observation | Form like CT-30 (weight, temperature, RR, feeding, jaundice assessment as recorded) | F-20 | P0 |
| CT-93 | Baby tags & intensity | Like CT-27 with the newborn catalogue | F-14 | P0 |
| CT-94 | Vaccines | Same layout as FH-31 plus **Record dose** sheet (date, batch, site) | F-24 | P0 |
| CT-95 | Discharge checklist | Two tabs **Mother · Baby**; `CompletionRing` + ChecklistRows (done / N/A / deferred + reason); **Complete discharge** disabled until resolved; success shows the generated follow-up plan | F-21, F-22 | P0 |

### 7.8 Common sheets

| ID | Sheet | Features |
|---|---|---|
| CT-91 | Close alert with outcome | F-15 |
| CT-32 | Override task (re-date / reassign / cancel + reason) | F-22 |
| CT-96 | Missed-visit outcome (will come / delivered elsewhere / moved / unreachable / declined) | F-23 |
| CT-97 | Send WhatsApp/SMS reminder (template preview in the mother's language) | F-49 |

### 7.9 Profile hub & KPI

| ID | Screen | Key content & components | Features | P |
|---|---|---|---|---|
| CT-80 | Profile hub | Name, role, department; rows: KPI · Labour room · Access history · Settings · Sign out | — | P0 |
| CT-81 | KPI | Serif "On-time visits"; HeroNumber "78%"; `BarChart` by week (highlighted current week, dotted average); StatTiles: ANC completeness · Missed → contacted < 48 h · Day-7 completion · Vaccine timeliness; SegmentedPills Week · Month | §18 | P0 |
| CT-82 | Access history | Audit list for a patient/record | F-60 | P1 |
| CT-83 | Dev tools (dev builds only) | **Time travel** (+1 d / +7 d / set date), run nightly sweep, reseed demo | §12.4 | P0 |

---

## 8. Cross-Cutting UI States

| State | Treatment |
|---|---|
| Loading | Skeleton cards in glass (shimmer disabled with reduce-motion) |
| Empty | `EmptyState` (line illustration + serif line + one action) |
| Offline | Glass `OfflineBanner` at the top; queued items show a SyncBadge; server-only actions are disabled with an explanation |
| Error | Inline card with retry; never silent |
| Permission denied | Friendly explainer + "Open settings" |
| Sensitive outcome (loss) | Neutral palette (no blob, softer gradient), no celebratory copy, no baby reminders |
| Caregiver view | Small "Viewing as Ravi (caregiver)" pill under the hero; hidden sections show nothing (no "locked" teasers) |

---

## 9. Copy & Tone

- **Family:** warm, short, second person, in her language. "Your next visit", "Bring your MCP card", "The hospital will call you". Never "normal", "abnormal", "risk", "serious" or "safe".
- **Care Team:** crisp and operational. "Still due", "Missed visit", "Window closed", "Awaiting review". Never "high-risk score", "critical value" or "abnormal" (unless quoting a documented note).
- Numbers are always paired with a date ("146/94 · 28 Sep"). Family-entered values are labelled "you recorded" / "family-reported".

---

## 10. Accessibility

- Contrast: text on glass meets AA (glass fills of at least 0.55 over our light gradient; ink text). White text only on rose500 at ≥ 18 sp bold (hero numbers use ink on family mood when contrast would fail).
- Supports font scaling to 130%. Tiles wrap units below values when needed.
- Every icon-only button (nav circles, glass buttons) has an `accessibilityLabel`.
- Status is never conveyed by colour alone (icon + word).
- Illustrated warning signs have text labels in the selected language.

---

## 11. Build Order for the UI

1. **Tokens + fonts + `Atmosphere` + `GlassSurface` + `FloatingNavBar`** (Phase 0). The two faces get their look on day one.
2. Core primitives: `Card`, `TopBar`, `HeroNumber`, `SegmentedPills`, `UnderlineTabs`, `Chip`/`TagChip`/`IntensityPill`, `StatusBadge`, `ListRow`, `StatTile`, `Sheet`.
3. Phase 1 screens: CT-01, CT-10, CT-20…CT-32, CT-60…CT-73, CT-50…CT-52.
4. Phase 2: `NextStepCard`, `DayStrip`, `AskCard`, `VoicePill` → AU/ON/FH/FA screens, CT-40…CT-42.
5. Phase 3: `TimelineLane` (split animation), `CompletionRing`, `BarChart` → CT-55…CT-58, CT-90…CT-95, CT-81, FH-30…FH-33.
6. Phase 4: `StoryCard`, `WeekScrubber`, `TrendLine`, P1 screens, polish pass.

**Screen count:** shared auth 4 · Family ≈ 37 · Care Team ≈ 50, including sheets and sub-steps.
