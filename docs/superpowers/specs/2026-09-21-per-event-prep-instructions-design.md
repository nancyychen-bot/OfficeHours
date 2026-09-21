# Per-event prep-email instructions — design

**Date:** 2026-09-21
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

Cities want to add their own logistics to the pre-event guest emails — how to
check in, where to go, which entrance, parking, etc. Today all guest email copy
comes from a single global source (built-in template defaults + the global
`email_overrides` table, keyed only by template `key`). If cities edited that
shared copy directly, they would overwrite each other — the instructions would
"get mixed up across cities."

## Goal

Let each event carry its own free-form instructions block that appears in that
event's prep-reminder emails only, with **no possibility of one city's text
leaking into another's email**.

## Decisions (locked during brainstorming)

- **Grain:** per **event** (dated). Keyed on the event row's id, matching how
  `events.address` and `events.wifi_*` already work. This makes cross-city
  bleed structurally impossible.
- **Emails:** the **three prep-reminder** emails only —
  `prep_reminder__guest`, `prep_reminder_day_before__guest`,
  `prep_reminder_day_before_paid__guest`.
- **Field shape:** a **single free-form block** per event (lightweight markdown:
  `**bold**`, `[label](url)`, bare URLs — the same subset the templates already
  render).
- **Approach:** placeholder injected into the shared template (Approach A).
  Rejected: per-event full-body overrides (B — reintroduces the mixing/tone-drift
  risk); a separate `event_instructions` table (C — YAGNI vs. a column).

## Architecture

Isolation boundary = the event id. One nullable column on `events` holds the
text; a `{{eventInstructions}}` placeholder in the three prep templates renders
it; the value is looked up per booking from the booking's event row. The shared
template structure/tone remains the single source of truth; organizers can only
fill the block, not restructure the email.

```
events.prep_instructions ──► getFields() (per booking, event row already loaded)
                                   │
                                   ▼
                       CommsFields.eventInstructions
                                   │  buildVars(): label + text, or ""
                                   ▼
        prep_* template body  …  {{eventInstructions}}  …
                                   │  renderTemplate()
                                   ▼
                         guest email (this event only)
```

### 1. Data model

```sql
-- 0050_events_prep_instructions.sql
alter table events add column if not exists prep_instructions text;
comment on column events.prep_instructions is
  'Per-event free-form logistics shown in prep-reminder emails (check-in, where to go). Null/empty = none.';
```

- Nullable; `null`/empty ⇒ no block (default for all existing events).
- Real migration wired end-to-end (unlike the currently-orphaned `wifi_*`
  columns, which this design does **not** touch).

### 2. Rendering

- `CommsFields` gains `eventInstructions: string | null`.
- `lib/email/comms.ts` `toCommsFields` initializes it to `null`;
  `defaultDeps.getFields` — which already loads the event row for `public_url` —
  sets `f.eventInstructions = ev?.prep_instructions ?? null` (one added line, no
  extra query).
- `buildVars` maps `{{eventInstructions}}`:
  - **present:** a fixed lead-in label + the organizer's text, so it always
    reads consistently regardless of input:

    ```
    📍 **Getting there & checking in**
    <organizer's text>
    ```
  - **absent/empty:** `""`.
- Placement in each of the 3 prep template bodies: on its own line,
  blank-line-separated, **after** the "fully charged laptop" line and **before**
  the "cancel your registration" line (the logistics slot).
- **Collapse-when-empty is free:** `toParagraphs` treats a blank/empty line as a
  paragraph separator and never emits an empty `<p>`, so an event with no
  instructions renders byte-for-byte the same email as today (no dangling label,
  no gap). Guaranteed by test, not assertion.

The lead-in label text ("Getting there & checking in") is a one-line constant,
trivially changed later.

### 3. Editor UI

- Home: the existing **`/readiness`** page, which already renders one card per
  upcoming event per city — organizers see and edit their own city's events in
  place, with no cross-city list to get lost in.
- New client component `components/hub/EventInstructionsEditor.tsx` per event
  card: a `<textarea>` pre-filled with the current value, a **Save** button, and
  a subtle "Updated <relative-time>" stamp.
- New route `POST /api/hub/event-instructions` `{ eventId, instructions }`:
  auth-gated (same pattern as `readiness/ack` and `readiness/register-untracked`);
  updates only `events.prep_instructions` for the named event; trims
  whitespace-only input to `null`.
- A **"Preview prep email"** toggle renders `prep_reminder__guest` for that
  event via the existing `renderTemplate` so the organizer sees the block in
  context (catches broken links / "where does this show up" before it ships).

### 4. Rollout — live-override + legend

The T-3 (`prep_reminder__guest`) and day-before-Free
(`prep_reminder_day_before__guest`) templates have **live copy overrides in the
`email_overrides` DB table**, which supersede the code defaults in production.
Therefore the rollout must add `{{eventInstructions}}`:

1. to the **three code-default bodies** in `lib/email/templates.ts`; **and**
2. to the **two live `email_overrides` rows** (T-3 and day-before-Free), in the
   same logistics slot; **and**
3. to the **`PLACEHOLDERS` legend** shown in `/settings/emails`, described as
   *per-event, filled from the readiness page* — so whoever edits global copy
   doesn't try to hardcode instructions there.

### 5. Error handling & testing

- **Empty/absent** → clean omission; test asserts today's exact output for an
  event with no instructions, across all 3 prep kinds.
- **Isolation** → render two events with different `prep_instructions`; assert
  each email contains only its own text.
- **Injection-safe** → `inlineFormat` HTML-escapes before applying markdown;
  test that `<script>` in the field renders inert.
- **Present** → renders under the lead-in label, in the logistics slot, for all
  3 prep kinds; markdown link/bold works.
- **API route** → rejects unauthenticated; updates only the named event;
  whitespace-only ⇒ `null`.
- **No change** to send/cron logic, dedup, or any non-prep email — existing
  template tests stay green.

## Out of scope (v1)

- Confirmation / day-of / cowork / unmatched emails.
- Per-city defaults or inheritance.
- Structured/labeled sub-fields.
- Wiring up the orphaned `wifi_network` / `wifi_password` columns.

## Files touched (anticipated)

- `supabase/migrations/0050_events_prep_instructions.sql` (new)
- `lib/email/templates.ts` — `CommsFields`, `buildVars`, 3 prep bodies,
  `PLACEHOLDERS`, lead-in label constant
- `lib/email/comms.ts` — `toCommsFields` + `getFields` injection line
- `lib/db/events.ts` — ensure `prep_instructions` is selected on the event row
- `app/api/hub/event-instructions/route.ts` (new)
- `components/hub/EventInstructionsEditor.tsx` (new) + wire into
  `app/readiness/page.tsx`
- DB data change: append `{{eventInstructions}}` to 2 live `email_overrides` rows
- `tests/comms-templates.test.ts` — new cases above
```
