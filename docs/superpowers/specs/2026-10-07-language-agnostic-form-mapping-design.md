# Language-agnostic Luma form mapping — design

**Date:** 2026-10-07
**Status:** Approved (brainstorm) → pending implementation plan
**Related:** memory `non-english-form-mapping`, `lib/luma/parse.ts`, `lib/luma/client.ts`, `lib/events/register.ts`, `/readiness`

## Problem

Build Bar's Luma registration form is a **template that gets translated per city**
(Seoul = Korean), not redesigned. The *shape* is identical everywhere — the same
company / Notion-email / plan / experience / reasons / 1:1-help / time-slot
questions — only the label and option **text** changes language.

Field mapping (`lib/luma/parse.ts`) and slot-grid extraction
(`lib/luma/client.ts` `extractSlotOptions`) historically keyed on **English label
regexes**, so a translated form silently dropped fields (null `notion_email`,
`notion_plan`, `experience_level`, `attend_reasons`, `requested_slot`) and even
mis-picked the slot question (Seoul's slots became the plan tiers
Enterprise/Business/Plus/Free). A first round of fixes added Korean label
patterns + language-independent value backstops; this design removes the
**per-language manual work** entirely while staying accurate.

Constraint: **no LLM/embedding API access** (Claude API is enterprise-gated for
this org; no model keys available). So inference must be heuristic, not model-based.

Goal: support **any language** (the top ~20 and beyond) with **no per-language
dictionary**. Achieved by identifying questions from **structure + value shape**,
never from translated label text. The only token used anywhere is the brand name
`linkedin`, which is identical in every language.

## Core idea

Split responsibilities by what each moment can see:

- **Ingest (every RSVP) resolves every field deterministically from the answer
  itself** — `question_type` + value shape + value cardinality. A Luma answer
  carries both its type and its value, and a multi-select answer is an **array**
  while a single-select is a **string**, so no two fields collide and no label
  text is read. This is fully language-independent and needs no stored state.
- **Registration (once, with the full question list) validates the form shape and
  alerts.** It classifies the questions to confirm the form matches the Build Bar
  template; if the shape is off, it persists the anomalies, emails the operator,
  and flags the event on `/readiness`. It does **not** feed ingest.

Why ingest doesn't need a stored `question_id → field` map: earlier thinking moved
disambiguation to registration because an ingest payload only contains *answered*
questions. But value **cardinality** removes the ambiguity — `experience`
(single-select → string) vs `reasons` (multi-select → array) is decided by the
answer value, not by comparing against the full question list. So the ingest
heuristics alone are correct, and the registration pass is purely a safety net.

## Canonical fields

`company`, `role` (both from the `company`-type question), `notion_email`,
`notion_plan`, `experience` (→ `experience_level`), `reasons` (→ `attend_reasons`),
`challenge`, `slot` (→ `requested_slot`).

Ignored by design: LinkedIn URL (optional, unused), the agree/consent checkbox.

## Value shapes (the only signals used)

| Signal | Pattern |
|--------|---------|
| clock time | `/\d{1,2}:\d{2}/` in the value (string or any array element) |
| plan tier | value ∈ `{enterprise, business, plus, free}` (case-insensitive) |
| email | value matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| url / linkedin | value matches `/^https?:\/\//` or contains `linkedin` |
| multi-select | `Array.isArray(answer.value)` |

## Components

### 1. Ingest: language-independent mapping — `lib/luma/parse.ts`

`mapAnswers` is rewritten to resolve each answer by type + value shape +
cardinality, in this priority order (first match wins; `??=` keeps the earlier
assignment so order is stable):

1. `type === "company"` → `company` (+ `role` from `job_title`)
2. value has a clock time → `requested_slot`  *(string "2:30-3:00PM" or array of times)*
3. value ∈ plan tiers → `notion_plan`
4. `Array.isArray(value)` (and not already claimed as slot) → `attend_reasons`
5. value is email-shaped → `notion_email`
6. value is a url / contains `linkedin` → **ignored** (LinkedIn question)
7. `type` is a select/dropdown with a leftover string value → `experience_level`
8. remaining free-text (`type` text/long-text, not email/url) → `challenge`

No `questionMap` parameter, no new call-site wiring — the webhook, backfill, and
`ingestRegistration` keep calling `normalizeGuest(data)` unchanged. The existing
multilingual label patterns (`LABEL`) remain only as a last-ditch tie-breaker for
a genuinely ambiguous payload; they are no longer load-bearing.

### 2. Registration classifier — `lib/luma/classify.ts` (new)

`classifyForm(questions: LumaRegistrationQuestion[]): { anomalies: string[] }`.
Pure. **Reality check (verified against the live Seoul form):** Luma's event-detail
`registration_questions` carry only `{ id, label, options }` — there is **NO `type`
field** on the question definition (only the per-guest `registration_answers` carry
a `question_type`). So the *only* language-independent signal available here is the
OPTION VALUES. The classifier therefore validates just the three options-backed
questions:

- a question whose options are plan tiers (≥2 of Enterprise/Business/Plus/Free),
- a question whose options look like clock times (the slot question),
- at least one more options question (experience/reasons — indistinguishable from
  each other here, which is fine; ingest splits them by value cardinality).

It deliberately does **not** try to validate the free-text questions
(company/email/challenge/consent are all just `{id, label}` with no options and no
type, so they're indistinguishable without reading the label's language). Those
fields are resolved at INGEST by value shape regardless, so a missing one surfaces
there, not here.

Each missing expectation appends a human-readable string to `anomalies` (e.g.
`"no question with time-slot options"`, `"no experience/reasons options question"`).
Empty `anomalies` ⇒ the form's options questions match the template.

### 3. Persist anomalies — `events.form_anomalies` (migration)

New nullable `jsonb` column on `events` holding the `anomalies` string array (null
for events registered before this ships; `[]` once a clean form is classified).
Read by `/readiness`; not read by ingest. Numbered past the remote migration max
(`list_migrations`) and applied via `apply_migration`; regenerate Supabase types.

### 4. Registration wiring — `lib/events/register.ts`

After fetching `detail.registration_questions`, call `classifyForm`, persist
`anomalies` via `upsertEvent` (new optional `formAnomalies` input), and if
non-empty call `emailFormAnomalies(...)` (§6). Never block registration on it
(best-effort, like `ensureLocationOption`). `extractSlotOptions` is unchanged — it
already prefers clock-time options — and continues to drive slot generation.

### 5. Readiness surface — `lib/readiness/check.ts` + `evaluate.ts`

The events query selects `form_anomalies`. `EventCheckInput` gains
`formAnomalies: string[]`, and `evaluateEvent` pushes one `err(...)` when it's
non-empty: `"Registration form shape looks off (<first anomaly>) — guest fields
may not map. Re-add the event after fixing the Luma form."` This keeps the problem
visible on `/readiness` until a clean re-register clears it.

### 6. Failure email — `lib/readiness/email.ts`

New `emailFormAnomalies(event, questions, anomalies, baseUrl)` reusing
`alertRecipients()` + `sendEmail(...)`. One email, only when anomalies exist, with
context: event name + luma id, the anomalies, and the full question list (type +
label + what each would map to). Example:

```
Build Bar Seoul (evt-jzP5hHix8aFcYZ1): registration form shape anomaly

Anomalies:
  • expected 2 free-text questions, found 1

Questions seen:
  [company] "어느 회사에서 일하고 계신가요?"
  [select]  "어떤 Notion 요금제를 사용 중이신가요?"   (plan tiers)
  [select]  "희망 시간대…"                              (time slots)
  [select]  "Notion 사용 경험…"
  [select]  "Build Bar에 오고 싶은 이유…"
  [text]    "1:1 지원을 원하신다면…"

Fix: correct the form in Luma so it matches the Build Bar template, then re-add
the event. Guest fields still map best-effort meanwhile.
```

## Data flow

```
register:event / webhook auto-register
  └─ getLumaEvent → registration_questions
       ├─ extractSlotOptions → slot grid   (unchanged)
       └─ classifyForm → { anomalies }
            ├─ upsertEvent(form_anomalies = anomalies)
            └─ if anomalies: emailFormAnomalies(...)   → email  (and /readiness reads the column)

guest.registered / guest.updated webhook  (and backfill)
  └─ normalizeGuest(data)            ← unchanged call sites
       └─ mapAnswers: type + value-shape + cardinality  (language-independent)
```

## Error handling

- `classifyForm` never throws out of registration; any failure degrades to an
  anomaly string, and ingest keeps working regardless (it doesn't depend on it).
- `emailFormAnomalies` send failure is caught + logged, never blocks registration.
- Null `form_anomalies` (pre-existing events) → readiness treats as "no data", no
  false alarm.
- Numbers written in non-Arabic digits would miss the clock-time pattern (a known
  edge for a future locale) → surfaces as a slot anomaly, not a silent drop.

## Testing

- `parse.ts` (`mapAnswers`): English, Korean, and a third language (e.g. Spanish)
  with identical shape all map every field identically — proving
  language-independence. Plus: multi-select array → `reasons`; single-select
  string → `experience`; plan tier value → `notion_plan`; time value (string and
  array) → `requested_slot`; email value → `notion_email`; linkedin url → ignored;
  the remaining free-text → `challenge`. No regression on existing cases.
- `classifyForm`: clean English + clean Korean forms → empty `anomalies`; a
  shape-broken form (missing time-slot question; 1 free-text question) → the
  expected anomaly strings; a form missing `question.id`s still evaluates.
- Readiness: an event with non-empty `form_anomalies` yields the expected
  `evaluateEvent` error issue; empty/null yields none.
- Email: anomalies produce the expected payload/recipients; empty sends nothing.

## Scope / non-goals

- **No per-language dictionary** — supports the top ~20 languages and any others
  with zero translation work; signals are structural + value-shape only (sole
  token: the universal brand name `linkedin`).
- **No ingest-time `question_map` / stored mapping** — ingest is self-sufficient
  from the answer payload; the registration classifier is only a shape validator /
  alerter. (Simplification vs the first draft of this spec.)
- **No option-value normalization** — `experience_level` stored verbatim
  ("능숙함 …"); translating option values to canonical English is out of scope.
- **No model/LLM/embedding dependency** — heuristic only.
