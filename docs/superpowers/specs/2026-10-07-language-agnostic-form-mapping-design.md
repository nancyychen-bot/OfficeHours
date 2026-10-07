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

Separate *understanding the form* (once, at registration, with the full question
list) from *mapping an RSVP* (every webhook, must be fast + deterministic).

1. **Classify once at registration** — when `registerEventFromLuma` runs it
   already fetches the full `registration_questions`. Infer each question's
   canonical field from **structure + language-independent values** and store the
   result on the event.
2. **Pin by Luma `question_id`** — persist `{ question_id → field }` so runtime is
   a pure dictionary lookup, independent of language.
3. **Deterministic ingest** — `parse.ts` maps each answer by its `question_id`
   first; falls back to today's keyword/value heuristics for any answer whose id
   isn't in the map (covers events registered before this ships + any gap).
4. **Notify on failure** — if a canonical field can't be mapped, still register,
   but email the operator (reusing the readiness email path) with context, and
   surface it on `/readiness` until resolved.

Why classify at registration, not ingest: at registration we have the **full**
question list, so structural disambiguation ("the remaining single-select =
experience, the multi-select = reasons") is reliable. At ingest we only receive
the **answered** questions (optional ones may be absent), so structural inference
there would be unreliable.

## Canonical fields

`company`, `role` (both from the `company`-type question), `notion_email`,
`notion_plan`, `experience` (→ `experience_level`), `reasons` (→ `attend_reasons`),
`challenge`, `slot` (→ `requested_slot`).

Ignored by design: LinkedIn URL (optional, unused), the agree/consent checkbox.

## Components

### 1. `classifyQuestions(questions)` — new pure function (`lib/luma/classify.ts`)

Input: `LumaRegistrationQuestion[]` (each has `id?`, `type?`, `label?`, `options?`).
Output: `{ map: Record<string, Field>, anomalies: string[] }` — `map` is
`question_id → field` for the five options/select fields; `anomalies` lists
human-readable structural problems (missing select field, free-text count ≠ 2)
that drive the §4 notification. Empty `anomalies` ⇒ the form matches the template.

Classification rules, applied in priority order so each question claims one field
and each field is claimed once:

Two kinds of signal, neither of which reads the language:
- **Options/select questions** are resolved at registration by `type` + option
  value signatures + select cardinality — stored in `question_map` by id.
- **Free-text questions** (email, challenge, the ignored LinkedIn) are resolved at
  **ingest by the answer's value shape** — they can't be split at registration
  (no values yet, structurally identical), so the map simply doesn't pin them.

| Field          | Signal (language-independent)                                   | Resolved at |
|----------------|-----------------------------------------------------------------|-------------|
| `company`/`role` | `type === "company"`                                          | registration |
| `slot`         | option/answer value matches a clock-time pattern (`\d{1,2}:\d{2}`) | registration |
| `notion_plan`  | option values are the tier set (`enterprise/business/plus/free`) | registration |
| `reasons`      | **multi-select** (`type`) — the answer value is an **array**     | registration |
| `experience`   | remaining **single-select** (`type`) string value, not plan/slot | registration |
| `notion_email` | answer value is **email-shaped** (`[^@]+@[^@]+\.[^@]+`)          | ingest |
| `challenge`    | the remaining free-text answer — neither email- nor URL-shaped  | ingest |
| LinkedIn (ignored) | answer value is a URL, or label has the universal brand token `linkedin` | ingest |

**Why no per-language dictionary.** Every signal above is structural (`type`,
array-vs-string cardinality) or value-shape (clock time, tier name, email, URL).
The only token is `linkedin`, a brand name identical across languages. This
supports the top ~20 languages and any others with zero translation work. The
prior multilingual label patterns are kept only as a last-ditch tie-breaker, not
a dependency.

**Registration vs ingest split.** `classifyQuestions` (registration, full question
list) pins the five options/select fields by `question_id`. It also validates that
the form contains **exactly two non-LinkedIn free-text questions** (the expected
email + challenge pair) so a structural anomaly is caught — but it does not label
which is which. At ingest, among the free-text answers: email-shaped → `notion_email`,
URL/linkedin → ignored, remainder → `challenge`. A select answer whose value is an
array → `reasons`; a select string not matching plan/slot → `experience` (these
also come through the stored map when present).

### 2. Storage — `events.question_map jsonb`

New nullable JSONB column (migration numbered past the remote max; apply via
`apply_migration`). Shape: `{ "<question_id>": "<field>" }`. Null for events
registered before this ships (ingest falls back to heuristics). No new table
(YAGNI); inspectable and hand-overridable in SQL.

### 3. Registration wiring — `lib/events/register.ts`

After fetching `detail.registration_questions`, call `classifyQuestions`, persist
`map` via `upsertEvent`, and if `anomalies.length > 0` trigger the failure
notification (§4). Re-running `register:event` re-classifies (already idempotent),
so a translated/edited form self-heals. `extractSlotOptions` is subsumed by the
classifier's `slot` detection (it already prefers clock-time options) — the slot
question id is known, so slot labels come from that question directly.

### 4. Ingest wiring — `lib/luma/parse.ts`

`normalizeGuest` / `mapAnswers` accept an optional `questionMap`. For each answer,
if `questionMap[answer.question_id]` exists, assign by that field (deterministic).
Otherwise fall through to the current type/value/keyword heuristics. The webhook
and backfill pass the event's `question_map` (fetched alongside the event).

### 5. Failure notification — reuse readiness email path

"Failure" is a **structural anomaly** — the form doesn't match the expected
template shape, which is the only thing that can actually break (language can't):
- a required select field (`company`, `notion_plan`, `experience`, `reasons`,
  `slot`) has no matching question, or
- the count of non-LinkedIn free-text questions ≠ 2 (expected: email + challenge).

On registration with any such anomaly:
- The event still registers (never block).
- Send **one email to the operator** (same recipient/transport as `/readiness`,
  which already emails only-on-problem) with context: event name + luma id, the
  anomalies, and the full list of form questions seen (type, label, and what each
  mapped to). Include the remedy: fix the form's shape in Luma, or set
  `events.question_map` manually.
- `/readiness` reports the same condition (event has form anomalies) so it stays
  visible until fixed — not just a one-shot email.

Example email body:
```
Build Bar Seoul (evt-jzP5hHix8aFcYZ1): form shape anomaly

Could not identify the `experience` select question. Questions seen:
  [company] "어느 회사에서 일하고 계신가요?"              → company/role
  [select]  "어떤 Notion 요금제를 사용 중이신가요?"        → notion_plan
  [select]  "Notion 사용 경험 수준은…"                     → (could not identify)
  [multi]   "Build Bar에 오고 싶은 이유는…"                → reasons
  [select]  "희망 시간대…"                                 → slot
Fix: correct the form shape in Luma, or set events.question_map manually.
```

## Data flow

```
register:event / webhook auto-register
  └─ getLumaEvent → registration_questions
       └─ classifyQuestions → { map, anomalies }
            ├─ upsertEvent(question_map = map)
            └─ if anomalies: notifyFormAnomalies(event, questions, anomalies)  → email + readiness

guest.registered / guest.updated webhook  (and backfill)
  └─ load event (incl. question_map)
       └─ normalizeGuest(data, questionMap)
            ├─ answer.question_id in map → assign deterministically
            └─ else → existing heuristics (type/value/keyword)
```

## Error handling

- Classification never throws out of registration; an unrecognized shape becomes
  an `anomaly` (→ notification) and ingest keeps working via value-shape heuristics.
- Missing `question.id` (older payloads) → that question is skipped in the map;
  ingest heuristics still catch its answer.
- Null `question_map` (pre-existing events) → ingest uses heuristics only.
- Notification send failure is logged, never blocks registration.

## Testing

- `classifyQuestions` (pure): English form, Korean form, and a third language
  (e.g. Japanese/Spanish labels with the same shape) all produce the same `map`
  and empty `anomalies` — proving language-independence. Plus a shape-changed form
  (missing experience select, or 1/3 free-text questions) that yields the expected
  `anomalies`, and a form missing `question.id`s.
- `parse.ts`: question_id lookup wins over heuristics; free-text resolved by value
  shape (email-shaped → email, URL → ignored, remainder → challenge); array value
  → reasons; falls back when id absent / map null; no regression on existing
  English/Korean cases.
- Notification: anomalies produce the expected email payload/context; empty
  `anomalies` sends nothing.
- Readiness: an event with form anomalies is reported.

## Scope / non-goals

- **No option-value normalization** — storing `experience_level` verbatim
  ("능숙함 …") is fine; translating option values to canonical English is a
  separate concern (YAGNI).
- **No model/LLM/embedding dependency** — heuristic classifier only. If Vercel AI
  Gateway or a model key becomes available later, the classifier is the single
  swap point; storage, ingest, and notification are unchanged.
- **No new mapping table** — JSONB column on `events`.
- **No per-language dictionary** — supports the top ~20 languages and any others
  with zero translation work; signals are structural + value-shape only (sole
  token: the universal brand name `linkedin`). Manual touch only when the form
  *shape* changes (surfaced via email + readiness).
