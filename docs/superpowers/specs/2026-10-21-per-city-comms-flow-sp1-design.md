# Per-city comms flow — SP1 (flow page + city registry) — design

**Date:** 2026-10-21
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

Email copy is **global**: `email_overrides` is keyed by template name only, one copy
for every event/city, and every template is **hardcoded English**. But cities need
to diverge — Seoul's emails should be in Korean, a city may want a different
feedback/credits link, etc. There is also no single place to *see* the whole comms
flow — what a guest or expert could receive, when, and whether it's been localized.

## The 3-sub-project decomposition (locked)

This is too large for one spec. It splits into three, built in order:

- **SP1 (this doc) — Flow model + per-city flow page (read-only).** Pick a city; see
  the guest + expert comms flow as a vertical journey, click a node to preview that
  email's **template** for the city, and see a city-scoped **sent log**. No send-path
  changes. Also establishes the **canonical city registry** everything else needs.
- **SP2 — Per-city override engine + edit-from-node.** Extend overrides to
  `(template, city)` with precedence *city > global > default*; edit a node's copy /
  links per city; per-city draft→publish.
- **SP3 — Localization seed.** A locale per city + a "translate the defaults into
  `<locale>`" action (via Claude) that pre-fills SP2's drafts for the organizer to
  review and publish.

**Locked decisions (brainstorming):**
- **Grain = a canonical city registry** (not free-text `events.city`, not
  `luma_calendar`). A `cities` table (Seoul, NYC, SF, Sydney, London, Singapore…)
  carries locale + the override scope, so NYC can differ from SF even though both
  sit on the shared `notion-master` calendar.
- **Localization = AI-seeded, operator-edited** (SP3): set a locale, auto-translate
  the English defaults into editable drafts, organizer refines + publishes.
- **Start with SP1** (read-only), lowest risk, and it forces the shared model.

## SP1 scope

Read-only. SP1 ships the **map + registry + model + log**. It renders the comms
flow and the *current* copy (global default + the city's locale shown as metadata).
Because per-city overrides don't exist until SP2, every city previews the same copy
in SP1 and all nodes show the ○ "global default" state — the ● "customized" state,
per-city Korean previews, and the edit/translate actions are SP2/SP3. SP1 makes the
flow legible and surfaces the sent log; it does not change what is sent.

## 1. Canonical cities registry

```sql
-- 00NN_cities.sql  (number past the remote max; apply via mcp)
create table public.cities (
  slug         text primary key,          -- 'seoul', 'nyc', 'sf', 'sydney'…
  name         text not null,             -- 'Seoul'
  locale       text not null default 'en',-- 'ko', 'en' (used in SP3)
  luma_calendar text,                      -- default owning calendar (nullable)
  aliases      text[] not null default '{}' -- free-text events.city values that map here
);
```

- **Mapping `events` → city:** an event resolves to a city by matching its
  `events.city` (case-insensitive) against `cities.name`/`aliases`, falling back to
  the city on its `luma_calendar`. Mirrors the existing `slack_channels` city+aliases
  pattern. Pure resolver `cityForEvent(event, cities)` — unit-tested.
- **Seed** from current events (Seoul, NYC, SF, Sydney, London, Singapore; add
  `Chippendale`→Sydney, `Ultimo`→Sydney aliases). Lives in the migration + a small
  idempotent seed.
- RLS deny-all (service-role only), like `luma_calendars`.

## 2. Comms-flow model (declarative, shared)

A declarative catalog in `lib/comms/flow.ts` — the single source of truth for the
guest + expert journeys, **generalizing the parked timeline catalog**
(`2026-10-21-per-event-comms-timeline-design.md`); both draw the same node data.

```ts
type Audience = "guest" | "expert";
type Phase = "before" | "matching_dayof" | "after" | "exception";
type Trigger =
  | { kind: "schedule"; label: string; rule: SendRule }     // "T−3d · 9am", offsetDays/targetHour
  | { kind: "event"; label: string };                        // "on claim", "on slot edit"
interface FlowNode {
  id: string;
  audience: Audience;
  phase: Phase;
  label: string;
  commsKinds: CommsKind[];   // the real kind(s) this node renders/previews
  trigger: Trigger;
  recipientRole: "guest" | "helper";
}
```

**Guest journey**

| Phase | Node | Trigger | Kind(s) |
|---|---|---|---|
| before | Prep — activate Notion AI / credits | T−3d · 9am | `prep_reminder` |
| before | Tomorrow: your 1:1 + credits + logistics | T−1d · 9am | `prep_reminder_day_before` (merged) † |
| before | Waitlisted / Declined / Spot-opened | on status | `waitlisted` · `declined` · `reapproved` |
| before | Cowork-only / unmatched | day before | `cowork_only` · `rematch_pending` · `unmatched_notice` |
| matching_dayof | 1:1 confirmed + invite | on claim — Claim button **or** DRI "Booked by" in Notion | `assigned` |
| matching_dayof | Slot changed — new time + invite | on slot edit (Notion or self-serve) | `slot_changed` |
| matching_dayof | Welcome | at the door (check-in) | `checked_in` |
| matching_dayof | Cowork-only accepted | organizer accepts for coworking | `cowork_only_accept` |
| after | Feedback request → reminder +2d | event ends · T+2d | `feedback_request` · `feedback_reminder` |
| exception | Cancelled / event cancelled / arrived-after-no-show | event | `cancelled` · `event_cancelled` · `arrived_after_no_show` |

**Expert journey**

| Phase | Node | Trigger | Kind(s) |
|---|---|---|---|
| matching_dayof | Assigned — you're helping … + invite | on claim — Claim button **or** DRI assigns in Notion | `assigned` |
| matching_dayof | Day-of agenda — your 1:1 lineup | day-of · 9am | `day_of_agenda` |
| matching_dayof | Your guest checked in | at the door | `checked_in` |
| matching_dayof | Guest no-show / arrived-after | slot +5m / late | `no_show` · `arrived_after_no_show` |
| exception | Slot changed · Reassigned off · Removed (unclaim) | event | `slot_changed` · `reassigned_off` · `expert_unavailable` |
| exception | Guest cancelled · Double-booked · Already-claimed · Unclaim-denied | event | `guest_cancelled` · `double_booked` · `already_claimed` · `unclaim_denied` |

† **Companion comms change (separate task, below):** the "merged −1d" node and the
removal of the morning-of `day_of_guest` reflect the *target* flow. SP1 renders live
behavior; the model updates when that change ships. A test asserts every node's
`commsKinds` are real `CommsKind` values.

## 3. The per-city page

- **Route:** `/cities/[slug]` (hub-auth, `force-dynamic`), reached from a new
  **Cities** index (list of registry cities) linked in `HubNav`.
- **City header:** name + locale badge + a city switcher.
- **Tabs:** `Flow` · `Sent log` · `Localization` (stub, disabled — lands in SP3).

### Flow tab
- **Guest / Expert toggle** — one journey at a time.
- **Vertical journey** grouped by phase (Before · Matching & Day-of · After ·
  Exceptions), with a left **timing/trigger rail** (blue pill = scheduled/cron,
  event-local; amber = event trigger) and a **●/○ customized-vs-default** dot per
  node (all ○ in SP1).
- **Node → template preview** (right panel): clicking a node renders that email's
  **template** for the city via `renderComms(kind, role, sampleFields, cityOverrides)`
  — subject + body with `{{tokens}}` shown, plus trigger/recipients/attachments.
  Clearly labeled *"Template — what this email says"* (distinct from the Sent log's
  real sends). In SP1 `cityOverrides` is empty, so it shows the global default; the
  locale is displayed.

### Sent log tab
- City-scoped `email_log`: rows whose booking's event resolves to this city, newest
  first. Columns: when · category tag (`GUEST·assigned`, `EXPERT·agenda`…) · email
  label · recipient · status (sent/failed/skipped). Filters: Guest / Expert / Failed;
  a **"By type"** grouping toggle.
- **Row → actual sent email** expands inline: the real rendered content (resolved
  values, the city's language, sender, timestamp, attachments). Reuses the existing
  email-log content viewer (`lib/db/email-correspondence`, `isOwnResendId`), scoped
  by the city→events resolver.

## Companion comms changes (separate, tracked — not SP1 send-path)

These change what is *sent* and extend the parked rationalization
(`2026-10-21-per-event-comms-timeline-design.md`, Part A). Sequenced alongside but
implemented as their own small change; SP1's page renders whatever is live:
- −1d email becomes the **merged** "tomorrow: 1:1 (slot+expert) + credits + logistics".
- **Drop the morning-of `day_of_guest`** (the −1d scheduled send is the new safety
  net — it still covers manually-assigned guests, a day earlier).
- Credits/`trialLink` stays in −3d prep and joins the −1d email.

## Out of scope (SP1)

- Editing / per-city overrides (SP2) — the Edit/Reset buttons are non-functional stubs.
- AI translation / locale template sets (SP3).
- Implementing the companion comms changes (own task).
- Mutating sends from the page — SP1 is read-only.

## Files touched (anticipated)

- `supabase/migrations/00NN_cities.sql` (new) + `lib/db/cities.ts` (new) +
  `lib/supabase/types.ts` (regen/add `cities`).
- `lib/comms/flow.ts` (new — node catalog + resolvers) ; `lib/comms/city.ts`
  (`cityForEvent`).
- `app/cities/page.tsx` (index) + `app/cities/[slug]/page.tsx` (new) ;
  `components/hub/CityFlow.tsx`, `components/hub/CitySentLog.tsx` (new) ;
  `components/hub/HubNav.tsx` (+ Cities link).
- Reuse: `renderComms` (template preview), `lib/db/email-correspondence` + the
  email-log viewer (sent log), `lib/hub/queries` (events/bookings).
- `tests/comms-flow.test.ts` (catalog integrity, `cityForEvent` resolver, city-scoped
  log filter) (new).

## Testing

- **City resolver** — `cityForEvent` maps `events.city`/aliases/calendar → city;
  `Chippendale`→Sydney, unknown → null, case-insensitive.
- **Catalog integrity** — every `FlowNode.commsKinds` is a real `CommsKind`; guest +
  expert journeys cover all non-internal kinds.
- **Sent-log scoping** — only this city's events' `email_log` rows; category tag +
  status derived correctly; failed filter.
- **Preview** — `renderComms` for a node returns subject/body; token-bearing template
  renders with `{{tokens}}` visible in SP1 (no city overrides).
