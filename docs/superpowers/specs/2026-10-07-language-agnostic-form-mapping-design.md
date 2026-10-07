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
Output: `{ map: Record<string, Field>, unmapped: Field[] }` — `map` is
`question_id → field`; `unmapped` lists canonical fields no question claimed.

Classification rules, applied in priority order so each question claims one field
and each field is claimed once:

| Field          | Signal (language-independent)                                   |
|----------------|-----------------------------------------------------------------|
| `company`/`role` | `type === "company"`                                          |
| `slot`         | options match a clock-time pattern (`\d{1,2}:\d{2}`)             |
| `notion_plan`  | options are the tier set (`enterprise/business/plus/free`)      |
| `reasons`      | the remaining **multi-select** (options present, not slot/plan) |
| `experience`   | the remaining **single-select** (options present, not slot/plan)|
| *text trio ↓*  | the free-text questions (no options, not `company`)             |
| `notion_email` | text question whose label has an email token (`email`/`이메일`), else see disambiguation |
| `challenge`    | text question with help/require label, or `type === "long-text"`, else the remainder of the trio |

**Text-question disambiguation (registration has no answer values).** The
template has exactly three free-text questions: LinkedIn (ignored), Notion email,
and the 1:1-help challenge. Classify them structurally:
1. **LinkedIn** → label contains the brand token `linkedin` (language-independent) → ignored.
2. **notion_email** → of the remaining two, the one whose label has an email token
   (`email`/`이메일`/…) — a small multilingual token set.
3. **challenge** → the remaining free-text question (works even when its `type` is
   plain `text`, as on the Seoul form, not `long-text`).

Note: `notion_email` is the one field whose happy-path classification can still
lean on a (tiny, multilingual) label-token set, because two plain-text questions
are otherwise structurally identical. At **ingest** the existing email-shaped
value backstop remains, so a mislabeled email question is still recoverable. If
the email token set misses a locale, email lands in `unmapped` → the operator is
notified (§4).

Existing multilingual label patterns remain as a tie-breaker/assist, but the
structural + value signals are primary. A question matching nothing is dropped
(not an error). A canonical field with no matching question is `unmapped`.

### 2. Storage — `events.question_map jsonb`

New nullable JSONB column (migration numbered past the remote max; apply via
`apply_migration`). Shape: `{ "<question_id>": "<field>" }`. Null for events
registered before this ships (ingest falls back to heuristics). No new table
(YAGNI); inspectable and hand-overridable in SQL.

### 3. Registration wiring — `lib/events/register.ts`

After fetching `detail.registration_questions`, call `classifyQuestions`, persist
`map` via `upsertEvent`, and if `unmapped.length > 0` trigger the failure
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

A canonical field in `unmapped` ⇒ actionable. On registration with any unmapped
field:
- The event still registers (never block).
- Send **one email to the operator** (same recipient/transport as `/readiness`,
  which already emails only-on-problem) with per-failure context: event name +
  luma id, which field is unmapped, and the full list of form questions seen
  (type, label, and what each mapped to). Include the remedy: add the locale's
  label hint or set `events.question_map` manually.
- `/readiness` reports the same condition (event has unmapped canonical fields)
  so it stays visible until fixed — not just a one-shot email.

Example email body:
```
Build Bar Seoul (evt-jzP5hHix8aFcYZ1): couldn't map 1 field

Expected field `experience` had no matching question. Questions seen:
  [company] "어느 회사에서 일하고 계신가요?"              → company/role
  [select]  "어떤 Notion 요금제를 사용 중이신가요?"        → notion_plan
  [select]  "Notion 사용 경험 수준은…"                     → (unmapped)
  [multi]   "Build Bar에 오고 싶은 이유는…"                → reasons
  [select]  "희망 시간대…"                                 → slot
Fix: add this locale's label hint in parse.ts, or set events.question_map.
```

## Data flow

```
register:event / webhook auto-register
  └─ getLumaEvent → registration_questions
       └─ classifyQuestions → { map, unmapped }
            ├─ upsertEvent(question_map = map)
            └─ if unmapped: notifyUnmappedFields(event, questions, unmapped)  → email + readiness

guest.registered / guest.updated webhook  (and backfill)
  └─ load event (incl. question_map)
       └─ normalizeGuest(data, questionMap)
            ├─ answer.question_id in map → assign deterministically
            └─ else → existing heuristics (type/value/keyword)
```

## Error handling

- Classification never throws out of registration; a failure to classify a field
  degrades to `unmapped` (→ notification) and ingest keeps working via heuristics.
- Missing `question.id` (older payloads) → that question is skipped in the map;
  ingest heuristics still catch its answer.
- Null `question_map` (pre-existing events) → ingest uses heuristics only.
- Notification send failure is logged, never blocks registration.

## Testing

- `classifyQuestions` (pure): English form, Korean form, a shape-changed form that
  leaves `experience` unmapped (asserts `unmapped` contains it), a form missing
  `question.id`s.
- `parse.ts`: question_id lookup wins over heuristics; falls back when id absent /
  map null; no regression on existing English/Korean cases.
- Notification: unmapped fields produce the expected email payload/context; empty
  `unmapped` sends nothing.
- Readiness: an event with unmapped canonical fields is reported.

## Scope / non-goals

- **No option-value normalization** — storing `experience_level` verbatim
  ("능숙함 …") is fine; translating option values to canonical English is a
  separate concern (YAGNI).
- **No model/LLM/embedding dependency** — heuristic classifier only. If Vercel AI
  Gateway or a model key becomes available later, the classifier is the single
  swap point; storage, ingest, and notification are unchanged.
- **No new mapping table** — JSONB column on `events`.
- **No per-language manual work** on the happy path; manual touch only when the
  form *shape* changes (surfaced via email + readiness).
