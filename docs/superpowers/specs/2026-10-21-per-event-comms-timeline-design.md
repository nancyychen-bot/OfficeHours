# Per-event comms timeline (run-of-show) — design

**Date:** 2026-10-21
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

Organizers (ambassadors like the Sydney team) don't know **what comms go out
when, what has already been sent, and what was said**. The system sends ~26 kinds
of email across crons and reactive triggers, but the only retrospective surface
is `/settings/emails/log` (grouped by kind, backward-looking). There is no
forward-looking, per-event view of "here's the run-of-show: what fires when,
what's done, what still needs a human." This gap let Sydney reach event day with
**35 claimed guests who had never been told their 1:1 time** (slots set manually
in Notion never fired the `assigned` invite) — invisible until someone ran a
script by hand.

## Goals

- A per-event page that shows the **run-of-show**: every scheduled comm and every
  manual operator step, in time order, each with **live status** (done / pending /
  overdue / needs-action) and a link to **what was said**.
- Surface the high-value derived signal **"have guests been told their time?"** so
  a Sydney-style gap screams days early.
- Read-only v1. Reflects whatever comms exist — it visualizes, it does not send.

## Decisions (locked during brainstorming)

- **Placement:** new per-event page at **`/events/[eventId]`**, reached from the
  Dashboard event list and from each Readiness card. Lives in the existing hub
  (same auth), next to the email log and readiness.
- **Scope:** full run-of-show — automated comms **and** manual steps (assign,
  check-in), plus a couple of **info** rows that state what's automatic (e.g. Luma
  approval on assign) to defuse the recurring "do I approve in Luma?" confusion.
- **Interactivity:** **read-only** v1. No resend/trigger/mark-done buttons.
- **Approach:** **hybrid** — a declarative milestone **catalog** supplies the
  forward schedule; `email_log` + live DB state supply status. (Rejected: deriving
  purely from `email_log`, which can only show what already sent — no "not yet"
  rows.)
- **Time display:** schedule rules are known and fixed (`SEND_HOUR = 9am local`
  for prep/agenda/day-of-guest; noon local for decline-pending), so each scheduled
  milestone shows a **rule-derived expected local time** ("~9:00am local, event
  day"), swapped for the **actual sent timestamp** (event-local) once it fires. No
  fabricated times.
- **Comms rationalization (Part A, below):** the −3d and −1d prep emails duplicate
  the "activate Notion AI" ask. Differentiate: −3d stays prep/activation; −1d
  becomes **logistics-only**, which collapses the Free/paid −1d split into one
  template. The day-of 1:1 reminder and the on-claim invite stay separate (distinct
  jobs; the day-of is the Sydney backstop).

---

## Part A — Comms rationalization (independent; do first)

Functionally independent of the timeline (the page reflects whatever exists), but
it's the change that motivated the audit, so ship it first.

**Today**, a Free-plan 1:1 guest can receive four pre-event emails: `prep_reminder`
(−3d), `prep_reminder_day_before` (−1d), `day_of_guest` (day-of), `assigned`
(on-claim). The two prep emails carry near-identical activation steps 48h apart.

**Change:**
- Keep **`prep_reminder`** (−3d) as the activation email (needs lead time for the
  Business trial). Unchanged.
- Rewrite the **−1d** email as **logistics-only** — address, doors/arrival time,
  what to bring, plus the per-event `{{eventInstructions}}` block — and drop the
  repeated activation steps.
- With the trial step gone from −1d, the **Free/paid split disappears**: collapse
  `prep_reminder_day_before` + `prep_reminder_day_before_paid` into a **single**
  day-before logistics kind sent to **all approved guests**.

**Implementation notes:**
- Keep kind **`prep_reminder_day_before`** as the single day-before kind; retire
  `prep_reminder_day_before_paid` (template, `RECIPIENTS`, `TemplateKey`, and its
  `sendPrepDayBeforePaidForLeadWindow`). Leaving the retired value in the
  `email_log` CHECK constraint is harmless — no new migration needed.
- `lib/events/prep.ts`: `sendPrepDayBeforeForLeadWindow` now targets **all**
  approved guests (remove the plan filter); delete the `_paid` function.
- `app/api/cron/prep-reminder/route.ts`: drop the `_paid` call.
- **Live override:** the day-before-Free template has a live row in
  `email_overrides` (see the per-event-prep-instructions design). Update that row
  to the new logistics copy, or delete it so the new code default wins.
- Confirm the exact current Free-vs-paid body difference before collapsing, in case
  it carries more than the trial step.

---

## Part B — The timeline page

### 1. Milestone catalog (pure data)

A declarative array in **`lib/events/timeline.ts`** — the single source of truth
for the forward schedule, decoupled from cron code and unit-testable:

```ts
type Phase = "before" | "day_of" | "after";
type Source =
  | { type: "email"; kind: CommsKind; rule?: SendRule }  // status from email_log
  | { type: "assigned_slots" }                            // unassigned requested-slot count
  | { type: "guests_notified" }                           // claimed w/o assigned|day_of_guest
  | { type: "checked_in" }                                // checked-in vs claimed
  | { type: "info"; detail: string };                     // static, e.g. "automatic"

interface Milestone {
  id: string;
  label: string;
  phase: Phase;
  audience: "guests" | "experts" | "organizer";
  source: Source;
}
```

Catalog (v1), ordered within each phase by rule time then declaration:

| id | label | phase | source |
|---|---|---|---|
| `prep` | Prep: activate Notion AI → guests | before | email `prep_reminder` @ −3d/9am |
| `assign` | Experts assigned to all 1:1 slots | before | `assigned_slots` |
| `guests_notified` | Guests told their 1:1 time | before | `guests_notified` |
| `luma_auto` | Luma approval on assign — automatic | before | info |
| `day_before` | Day-before logistics → guests | before | email `prep_reminder_day_before` @ −1d/9am |
| `agenda` | Day-of agenda → experts | day_of | email `day_of_agenda` @ 0d/9am |
| `day_of_guest` | Day-of 1:1 reminder → guests | day_of | email `day_of_guest` @ 0d/9am |
| `checkin` | Check in guests at the door | day_of | `checked_in` |
| `no_show` | No-show sweep — automatic | day_of | info |
| `feedback` | Feedback request → guests | after | email `feedback_request` |
| `feedback_reminder` | Feedback reminder → non-responders | after | email `feedback_reminder` @ +2d |

A test asserts every `email` source references a real `CommsKind`.

### 2. Status derivation

**`lib/events/timeline-status.ts`** resolves each milestone against live data into
a `MilestoneStatus`:

```
status: "done" | "scheduled" | "overdue" | "needs_action" | "pending" | "info"
count?:  { done: number; total: number }       // e.g. 33/35 notified
at?:     string                                  // actual sent time (event-local) or expected time
link?:   string                                  // "/settings/emails/log?event=…&kind=…"
```

- **email** — aggregate `email_log` rows for the event's bookings at that `kind`:
  any `sent` ⇒ **done** (`at` = earliest `sent` `created_at`, event-local; `count`
  = recipients sent). Else if the rule window hasn't arrived ⇒ **scheduled** (`at` =
  rule-derived expected local time). Else (window passed, nothing sent) ⇒
  **overdue**. Reactive kinds with no rule and no sends ⇒ **pending**.
- **assigned_slots** — count bookings with a requested slot still `unassigned`;
  0 ⇒ **done**, else **needs_action** (`count` = assigned/total).
- **guests_notified** — claimed bookings (`assigned`|`checked_in`) with **no**
  `assigned` and **no** `day_of_guest` `sent` row ⇒ the unnotified set;
  empty ⇒ **done**, else **needs_action** (this is the Sydney alarm).
- **checked_in** — `checked_in` vs claimed count; informational pre-event,
  **done** when all claimed are checked in on the day.
- **info** — static **info** row with its `detail`.

All derivation is pure over fetched rows (event, bookings, email_log counts) → one
event query + one bookings query + one grouped `email_log` query. No writes.

### 3. Page & rendering

- **`app/events/[eventId]/page.tsx`** — server component, hub-auth-gated
  (`force-dynamic`). Loads event + bookings + `email_log` counts, builds the
  catalog, derives status, renders.
- **`components/hub/Timeline.tsx`** — three phase sections (Before / Day-of /
  After). Each row: status chip (✅ done · ⏳ scheduled · ⚠️ overdue/needs-action ·
  ⬜ pending · ℹ️ info), label, audience, the time (`at`), a count when present, and
  a **"what was said"** link for email rows (deep-links the existing log filtered to
  event+kind). Header shows event name, date, timezone, claimed-1:1 count.
- **Entry points:** a row link on the Dashboard event list (`app/page.tsx`) and a
  "View timeline →" link on each Readiness card (`app/readiness/page.tsx`).

### 4. Time display

Expected local time per scheduled milestone = `event_date + offsetDays` at
`targetHour`, formatted in `event.timezone` (reuse `lib/events/schedule.ts`
helpers). Once fired, show the real `email_log.created_at` in event-local time.
Non-scheduled rows (manual/info/reactive) show a phase label, not a clock time.

## Non-goals / Out of scope (v1)

- No actions from the page (resend, trigger, mark-done) — read-only.
- No Notion mirror of the timeline.
- No editing the schedule from the UI; the catalog is code.
- Reactive one-off comms (reassign, cancel, already-claimed, unclaim-denied) stay
  in the existing log, not the timeline — the timeline is the *predictable* run.
- No new cron/alerting off `guests_notified` yet (Readiness already emails Nancy;
  wiring this signal into it is a fast follow, not v1).

## Files touched (anticipated)

**Part A** — `lib/email/templates.ts` (rewrite −1d body as logistics; retire
`prep_reminder_day_before_paid` template + `TemplateKey`), `lib/email/comms.ts`
(`RECIPIENTS`), `lib/events/prep.ts` (single day-before send to all approved),
`app/api/cron/prep-reminder/route.ts`, the live `email_overrides` day-before row,
`tests/prep.test.ts`.

**Part B** — `lib/events/timeline.ts` (new, catalog), `lib/events/timeline-status.ts`
(new, derivation), `app/events/[eventId]/page.tsx` (new),
`components/hub/Timeline.tsx` (new), `app/page.tsx` + `app/readiness/page.tsx`
(entry links), `lib/db/*` (reuse `booking_details` + `email_log` reads; add a
grouped-count helper if needed), `tests/timeline.test.ts` (new).

## Testing

- **Catalog integrity** — every `email` milestone maps to a real `CommsKind`.
- **Derivation (pure)** — fixtures for: nothing sent + window future ⇒ scheduled;
  window past + nothing ⇒ overdue; partial sends ⇒ done with `done/total`;
  claimed-but-unnotified ⇒ `needs_action` (the Sydney case); all-assigned ⇒ done.
- **Time formatting** — expected local time respects event timezone (Sydney vs NYC);
  fired rows show real `created_at`.
- **Part A** — day-before renders logistics (no activation steps), one template for
  all approved guests; `prep_reminder` (−3d) unchanged; existing prep tests updated.
