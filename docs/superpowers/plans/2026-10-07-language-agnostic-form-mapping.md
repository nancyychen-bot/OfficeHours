# Language-agnostic Luma form mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map Luma registration answers to booking fields correctly in *any* language, with no per-language dictionary, and alert the operator by email + `/readiness` when a form's shape doesn't match the Build Bar template.

**Architecture:** Ingest (`lib/luma/parse.ts`) resolves every field from the answer payload alone — `question_type` + value shape + value cardinality (multi-select = array, single-select = string) — so no label text is read and no stored mapping is needed. A new pure `classifyForm` validates the form shape once at registration; anomalies are persisted on `events.form_anomalies`, emailed, and surfaced on `/readiness`.

**Tech Stack:** TypeScript, Next.js (App Router), Supabase (Postgres), Vitest, Resend (email). Spec: `docs/superpowers/specs/2026-10-07-language-agnostic-form-mapping-design.md`.

**Branch/verify commands:**
- Single test file: `npx vitest run tests/<file>.test.ts`
- Full suite: `npx vitest run`
- Typecheck: `npm run -s typecheck` (falls back to `npx tsc --noEmit`)

---

## File structure

- `lib/luma/parse.ts` — **modify**: rewrite `mapAnswers` to be value-shape/cardinality based; add value-shape helpers. Keep `LABEL` + `matchesAny` as a final fallback.
- `lib/luma/classify.ts` — **create**: pure `classifyForm(questions)` → `{ anomalies: string[] }`.
- `supabase/migrations/0058_events_form_anomalies.sql` — **create** + apply via `apply_migration`.
- `lib/supabase/types.ts` — **regenerate** (adds `form_anomalies` to `events`).
- `lib/db/events.ts` — **modify**: `upsertEvent` accepts optional `formAnomalies`.
- `lib/events/register.ts` — **modify**: call `classifyForm`, persist anomalies, email on anomalies.
- `lib/readiness/email.ts` — **modify**: add `emailFormAnomalies(...)`.
- `lib/readiness/evaluate.ts` — **modify**: `EventCheckInput.formAnomalies`; `evaluateEvent` emits an issue.
- `lib/readiness/check.ts` — **modify**: select `form_anomalies`, pass into `evaluateEvent`.
- Tests: `tests/luma-parse.test.ts` (extend), `tests/luma-classify.test.ts` (new), `tests/readiness.test.ts` (extend), `tests/readiness-email-anomalies.test.ts` (new).

---

## Task 1: Ingest — language-independent `mapAnswers`

**Files:**
- Modify: `lib/luma/parse.ts`
- Test: `tests/luma-parse.test.ts`

- [ ] **Step 1: Write failing tests** (append to `tests/luma-parse.test.ts`)

```ts
describe("normalizeGuest — value-shape mapping (language-independent)", () => {
  // Same shape as the real Korean Seoul form, but labels in a THIRD language
  // (Spanish) with no dictionary entry — must still map every field.
  const SPANISH = [
    { label: "¿En qué empresa trabajas?", question_id: "q1", question_type: "company", value: { company: "Analytical", job_title: "Ingeniera" } },
    { label: "URL de LinkedIn", question_id: "q2", question_type: "text", value: "https://linkedin.com/in/ada" },
    { label: "¿Qué correo usas para Notion?", question_id: "q3", question_type: "text", value: "ada@notion.so" },
    { label: "¿Qué plan de Notion usas?", question_id: "q4", question_type: "select", value: "Business" },
    { label: "¿Tu nivel de experiencia con Notion?", question_id: "q5", question_type: "select", value: "Avanzado" },
    { label: "¿Por qué quieres venir?", question_id: "q6", question_type: "select", value: ["Ayuda 1:1", "Coworking"] },
    { label: "¿En qué necesitas ayuda?", question_id: "q7", question_type: "long-text", value: "Un CRM" },
    { label: "Horario preferido", question_id: "q8", question_type: "select", value: "2:30-3:00PM" },
    { label: "Acepto ser contactado", question_id: "q9", question_type: "agree-check", value: true },
  ];

  it("maps every field from a form in an unknown language", () => {
    const n = normalizeGuest(guest(SPANISH));
    expect(n.company).toBe("Analytical");
    expect(n.role).toBe("Ingeniera");
    expect(n.notionEmail).toBe("ada@notion.so");
    expect(n.notionPlan).toBe("Business");
    expect(n.experienceLevel).toBe("Avanzado");
    expect(n.attendReasons).toBe("Ayuda 1:1, Coworking");
    expect(n.challenge).toBe("Un CRM");
    expect(n.requestedSlot).toBe("2:30-3:00PM");
  });

  it("splits experience (single-select string) from reasons (multi-select array)", () => {
    const n = normalizeGuest(guest([
      { label: "x", question_id: "a", question_type: "select", value: "Avanzado" },
      { label: "y", question_id: "b", question_type: "select", value: ["Ayuda 1:1"] },
    ]));
    expect(n.experienceLevel).toBe("Avanzado");
    expect(n.attendReasons).toBe("Ayuda 1:1");
  });

  it("maps a time-slot delivered as an array of times", () => {
    const n = normalizeGuest(guest([
      { label: "z", question_id: "s", question_type: "select", value: ["2:00-2:30PM", "3:00-3:30PM"] },
    ]));
    expect(n.requestedSlot).toBe("2:00-2:30PM, 3:00-3:30PM");
    expect(n.attendReasons).toBeNull(); // claimed as slot, not reasons
  });

  it("ignores the LinkedIn URL and the consent checkbox", () => {
    const n = normalizeGuest(guest([
      { label: "LinkedIn", question_id: "l", question_type: "text", value: "https://linkedin.com/in/ada" },
      { label: "Acepto", question_id: "c", question_type: "agree-check", value: true },
    ]));
    expect(n.notionEmail).toBeNull();
    expect(n.challenge).toBeNull();
    expect(n.requestedSlot).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/luma-parse.test.ts`
Expected: FAIL — e.g. `experienceLevel` null or `attendReasons` mis-split (current code is label-driven).

- [ ] **Step 3: Add value-shape helpers in `lib/luma/parse.ts`**

Replace the `PLAN_VALUE` / `TIME_SLOT_VALUE` / `EMAIL_VALUE` block (added in the first-round fix) with this fuller set, placed just above `mapAnswers`:

```ts
// Language-independent value signatures. The option/answer VALUES for these
// questions are identical across languages (clock times, plan tiers, an email
// address, a URL), so they identify a field without reading any label text.
const CLOCK_TIME = /\d{1,2}:\d{2}/;
const PLAN_VALUE = /^(enterprise|business|plus|free)$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_VALUE = /^https?:\/\//i;

/** A clock time anywhere in the value — a plain string or any array element. */
function hasClockTime(value: unknown): boolean {
  if (typeof value === "string") return CLOCK_TIME.test(value);
  if (Array.isArray(value)) return value.some((v) => typeof v === "string" && CLOCK_TIME.test(v));
  return false;
}

/** A single/multi select or dropdown (not free text, not company). */
function isSelectType(type: string): boolean {
  return /select|dropdown|choice/.test(type);
}
```

- [ ] **Step 4: Rewrite `mapAnswers` body**

Replace the entire `for (const a of answers) { … }` primary loop AND the value-backstop second loop with this single loop + a label fallback loop:

```ts
  for (const a of answers) {
    const label = a.label ?? "";
    const type = (a.question_type ?? "").toLowerCase();
    const val = answerToString(a);

    // 1. Company (by type) → company + role.
    if (type === "company") { out.company ??= val; out.role ??= jobTitleFromAnswer(a); continue; }
    // 2. Slot — a clock-time value (string "2:30-3:00PM" or an array of times).
    if (hasClockTime(a.value)) { out.requestedSlot ??= val; continue; }
    // 3. Plan — the tier set is identical in every language.
    if (val && PLAN_VALUE.test(val)) { out.notionPlan ??= val; continue; }
    // 4. Reasons — the multi-select (its value is an array); slot already took times.
    if (Array.isArray(a.value)) { out.attendReasons ??= val; continue; }
    // 5. Notion email — an email-shaped value.
    if (val && EMAIL_VALUE.test(val)) { out.notionEmail ??= val; continue; }
    // 6. LinkedIn — a URL value, or a label with the universal brand token → ignore.
    if (val && URL_VALUE.test(val)) continue;
    if (/linkedin/i.test(label)) continue;
    // 7. Experience — the remaining single-select string.
    if (isSelectType(type)) { out.experienceLevel ??= val; continue; }
    // 8. Challenge — the remaining free text.
    if (type === "long-text" || type === "text" || type === "short-text") { out.challenge ??= val; continue; }
  }

  // Last-ditch fallback: if a field is still unmapped (an unusual payload), try the
  // multilingual label patterns. These are no longer load-bearing — the loop above
  // resolves the standard template — but they add robustness for an odd form.
  for (const a of answers) {
    const label = a.label ?? "";
    const val = answerToString(a);
    if (out.notionEmail == null && matchesAny(label, LABEL.notionEmail)) { out.notionEmail = val; continue; }
    if (out.notionPlan == null && matchesAny(label, LABEL.notionPlan)) { out.notionPlan = val; continue; }
    if (out.experienceLevel == null && matchesAny(label, LABEL.experience)) { out.experienceLevel = val; continue; }
    if (out.attendReasons == null && matchesAny(label, LABEL.reasons)) { out.attendReasons = val; continue; }
    if (out.requestedSlot == null && matchesAny(label, LABEL.slot)) { out.requestedSlot = val; continue; }
    if (out.challenge == null && matchesAny(label, LABEL.challenge)) { out.challenge = val; continue; }
  }
  return out;
```

(Keep the existing `LABEL`, `matchesAny`, `answerToString`, `jobTitleFromAnswer`, and the `out` initializer unchanged.)

- [ ] **Step 5: Run the new + existing parse tests**

Run: `npx vitest run tests/luma-parse.test.ts tests/luma.test.ts`
Expected: PASS (all, including the pre-existing English/Korean cases).

- [ ] **Step 6: Commit**

```bash
git add lib/luma/parse.ts tests/luma-parse.test.ts
git commit -m "feat(luma): map answers by value shape + cardinality (language-independent)"
```

---

## Task 2: `classifyForm` — form-shape validator

**Files:**
- Create: `lib/luma/classify.ts`
- Test: `tests/luma-classify.test.ts`

- [ ] **Step 1: Write failing tests** (`tests/luma-classify.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { classifyForm } from "@/lib/luma/classify";
import type { LumaRegistrationQuestion } from "@/lib/luma/types";

// A full, well-formed form (labels in Korean to prove language-independence).
const KOREAN: LumaRegistrationQuestion[] = [
  { id: "q1", type: "company", label: "회사" },
  { id: "q2", type: "text", label: "LinkedIn URL" },
  { id: "q3", type: "text", label: "이메일" },
  { id: "q4", type: "select", label: "요금제", options: ["Enterprise", "Business", "Plus", "Free"] },
  { id: "q5", type: "select", label: "경험", options: ["능숙함", "초보"] },
  { id: "q6", type: "select", label: "이유", options: ["1:1", "코워킹"] },
  { id: "q7", type: "long-text", label: "도움" },
  { id: "q8", type: "select", label: "시간대", options: ["2:00-2:30PM", "2:30-3:00PM"] },
];

describe("classifyForm", () => {
  it("returns no anomalies for a well-formed form in any language", () => {
    expect(classifyForm(KOREAN).anomalies).toEqual([]);
  });

  it("flags a missing time-slot question", () => {
    const noSlot = KOREAN.filter((q) => q.id !== "q8");
    const { anomalies } = classifyForm(noSlot);
    expect(anomalies.some((a) => /time-slot/i.test(a))).toBe(true);
  });

  it("flags the wrong number of free-text questions", () => {
    const oneText = KOREAN.filter((q) => q.id !== "q3"); // drop the email text question
    const { anomalies } = classifyForm(oneText);
    expect(anomalies.some((a) => /free-text/i.test(a))).toBe(true);
  });

  it("flags a missing plan question", () => {
    const noPlan = KOREAN.filter((q) => q.id !== "q4");
    expect(classifyForm(noPlan).anomalies.some((a) => /plan/i.test(a))).toBe(true);
  });

  it("does not throw on questions missing ids/types", () => {
    expect(() => classifyForm([{ label: "x" }])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/luma-classify.test.ts`
Expected: FAIL with "Cannot find module '@/lib/luma/classify'".

- [ ] **Step 3: Implement `lib/luma/classify.ts`**

```ts
import type { LumaRegistrationQuestion } from "./types";

const CLOCK_TIME = /\d{1,2}:\d{2}/;
const PLAN_VALUE = /^(enterprise|business|plus|free)$/i;

function optionStrings(q: LumaRegistrationQuestion): string[] {
  return (q.options ?? []).map((o) => {
    if (typeof o === "string") return o;
    if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      for (const k of ["label", "name", "value", "text"]) if (typeof r[k] === "string") return r[k] as string;
    }
    return String(o);
  });
}

const hasOptions = (q: LumaRegistrationQuestion) => Array.isArray(q.options) && q.options.length > 0;
const isTimeSlot = (q: LumaRegistrationQuestion) => optionStrings(q).some((s) => CLOCK_TIME.test(s));
const isPlan = (q: LumaRegistrationQuestion) => { const s = optionStrings(q); return s.length > 0 && s.every((o) => PLAN_VALUE.test(o.trim())); };
const isFreeText = (q: LumaRegistrationQuestion) => { const t = (q.type ?? "").toLowerCase(); return !hasOptions(q) && t !== "company" && /text/.test(t); };
const isLinkedIn = (q: LumaRegistrationQuestion) => /linkedin/i.test(q.label ?? "");

/**
 * Validate that a Luma registration form matches the Build Bar template SHAPE,
 * using option values + question type only (never label text, so it is
 * language-independent). Returns human-readable anomaly strings; empty ⇒ the form
 * is well-formed. Used only for the operator alert — ingest does not depend on it.
 */
export function classifyForm(questions: LumaRegistrationQuestion[]): { anomalies: string[] } {
  const qs = questions ?? [];
  const anomalies: string[] = [];

  if (!qs.some((q) => (q.type ?? "").toLowerCase() === "company")) {
    anomalies.push("no company question");
  }
  const planCount = qs.filter(isPlan).length;
  if (planCount === 0) anomalies.push("no question with plan-tier options (Enterprise/Business/Plus/Free)");

  const slotCount = qs.filter(isTimeSlot).length;
  if (slotCount === 0) anomalies.push("no question with time-slot options");

  // Options questions that are NOT plan and NOT slot are the experience + reasons
  // pair; the template has at least one (experience) beyond plan/slot.
  const otherOptionQs = qs.filter((q) => hasOptions(q) && !isPlan(q) && !isTimeSlot(q)).length;
  if (otherOptionQs === 0) anomalies.push("no experience/reasons options question");

  const freeText = qs.filter((q) => isFreeText(q) && !isLinkedIn(q)).length;
  if (freeText !== 2) anomalies.push(`expected 2 free-text questions (email + 1:1 help), found ${freeText}`);

  return { anomalies };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/luma-classify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/luma/classify.ts tests/luma-classify.test.ts
git commit -m "feat(luma): classifyForm — language-independent form-shape validator"
```

---

## Task 3: Migration — `events.form_anomalies`

**Files:**
- Create: `supabase/migrations/0058_events_form_anomalies.sql`
- Regenerate: `lib/supabase/types.ts`

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0058_events_form_anomalies.sql`:

```sql
-- Registration-form shape anomalies detected at event registration (classifyForm).
-- Null = never classified (pre-existing events); [] = classified clean. Read by
-- /readiness + the operator alert email; NOT used by the Luma ingest path.
alter table public.events
  add column if not exists form_anomalies jsonb;
```

- [ ] **Step 2: Apply the migration to the remote DB**

Use the Supabase MCP tool `apply_migration` with:
- `project_id`: `jldgxdaemtdqcfrdzeby`
- `name`: `events_form_anomalies`
- `query`: the SQL above.

(The local file is numbered `0058` — one past the local `0057`; the remote max per
`list_migrations` is `20261006172859`. `apply_migration` assigns the remote
timestamp version. Per the migration-numbering-drift note, this keeps it tracked.)

- [ ] **Step 3: Verify the column exists**

Use MCP `execute_sql` on `jldgxdaemtdqcfrdzeby`:
```sql
select column_name, data_type from information_schema.columns
where table_name='events' and column_name='form_anomalies';
```
Expected: one row, `jsonb`.

- [ ] **Step 4: Regenerate Supabase types**

Use MCP `generate_typescript_types` for `jldgxdaemtdqcfrdzeby` and write the result
to `lib/supabase/types.ts` (overwrite). Confirm `form_anomalies` now appears under
the `events` Row/Insert/Update types.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run -s typecheck
git add supabase/migrations/0058_events_form_anomalies.sql lib/supabase/types.ts
git commit -m "feat(db): add events.form_anomalies for form-shape alerts"
```
Expected: typecheck exits 0.

---

## Task 4: Persist anomalies at registration + email

**Files:**
- Modify: `lib/db/events.ts` (`upsertEvent`)
- Modify: `lib/events/register.ts`
- Depends on: Task 5 (`emailFormAnomalies`) — if executing strictly in order, implement Task 5 first, then this task. (Listed here because the wiring lives in register.ts.)

- [ ] **Step 1: Extend `upsertEvent` to accept `formAnomalies`**

In `lib/db/events.ts`, add to the `upsertEvent` input type (after `lumaCalendar`):
```ts
  formAnomalies?: string[]; // null/omitted = don't touch; [] = classified clean
```
And inside the `.upsert({ … })` object literal, after the `...(input.lumaCalendar ? …)` spread, add:
```ts
        // Only write when provided, so a plain re-register without classification
        // doesn't wipe a previously recorded result.
        ...(input.formAnomalies !== undefined ? { form_anomalies: input.formAnomalies } : {}),
```

- [ ] **Step 2: Wire classification into `registerEventFromLuma`**

In `lib/events/register.ts`:

Add imports at the top with the other `../luma` imports:
```ts
import { classifyForm } from "../luma/classify";
import { emailFormAnomalies } from "../readiness/email";
import { env } from "../env";
```

Immediately BEFORE the `const event = await upsertEvent({ … })` call, compute:
```ts
  const { anomalies } = classifyForm(detail.registration_questions ?? []);
```

Add `formAnomalies: anomalies,` to the `upsertEvent({ … })` input object (alongside `lumaCalendar: calendarId`).

AFTER the `upsertEvent` call (and after `ensureLocationOption`’s try/catch is fine too), add a best-effort alert:
```ts
  // Alert the operator if the form shape doesn't match the template (guest fields
  // may not map). Never fail the registration over it.
  if (anomalies.length > 0) {
    try {
      await emailFormAnomalies(
        { name: event.name, lumaEventId: event.luma_event_id },
        detail.registration_questions ?? [],
        anomalies,
        env.app.baseUrl().replace(/\/$/, ""),
      );
    } catch (err) {
      console.error("[register] form-anomaly email failed", err);
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run -s typecheck`
Expected: exits 0. (Requires Task 5's `emailFormAnomalies` to exist with the matching signature.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/events.ts lib/events/register.ts
git commit -m "feat(register): classify form shape, persist anomalies, alert operator"
```

---

## Task 5: `emailFormAnomalies`

**Files:**
- Modify: `lib/readiness/email.ts`
- Test: `tests/readiness-email-anomalies.test.ts`

- [ ] **Step 1: Write failing test** (`tests/readiness-email-anomalies.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmail = vi.fn(async () => ({ id: "e1" }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: (...a: any[]) => (sendEmail as any)(...a) }));

import { emailFormAnomalies } from "@/lib/readiness/email";

describe("emailFormAnomalies", () => {
  beforeEach(() => {
    sendEmail.mockClear();
    process.env.READINESS_ALERT_EMAILS = "ops@x.com";
  });

  it("sends one email per recipient with the anomalies + questions in the body", async () => {
    const sent = await emailFormAnomalies(
      { name: "Build Bar Seoul", lumaEventId: "evt-abc" },
      [{ id: "q1", type: "company", label: "회사" }, { id: "q2", type: "text", label: "이메일" }],
      ["expected 2 free-text questions (email + 1:1 help), found 1"],
      "https://hub.test",
    );
    expect(sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe("ops@x.com");
    expect(arg.subject).toMatch(/Seoul/);
    expect(arg.text).toMatch(/expected 2 free-text/);
    expect(arg.text).toMatch(/회사/);
  });

  it("sends nothing when there are no anomalies", async () => {
    const sent = await emailFormAnomalies({ name: "X", lumaEventId: "evt-x" }, [], [], "https://hub.test");
    expect(sent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/readiness-email-anomalies.test.ts`
Expected: FAIL — `emailFormAnomalies` is not exported.

- [ ] **Step 3: Implement `emailFormAnomalies`**

In `lib/readiness/email.ts`, add the import for the question type at the top:
```ts
import type { LumaRegistrationQuestion } from "../luma/types";
```
Append this exported function (it reuses the existing `alertRecipients()` and `escapeHtml()` already in this file):

```ts
/**
 * Alert the operator that an event's Luma form shape doesn't match the template,
 * so guest fields may not map. Reuses the readiness recipients + transport. No-op
 * (returns 0) when there are no anomalies or no recipients.
 */
export async function emailFormAnomalies(
  event: { name: string; lumaEventId: string | null },
  questions: LumaRegistrationQuestion[],
  anomalies: string[],
  baseUrl: string,
): Promise<number> {
  if (anomalies.length === 0) return 0;
  const recipients = alertRecipients();
  if (recipients.length === 0) return 0;

  const idPart = event.lumaEventId ? ` (${event.lumaEventId})` : "";
  const subject = `⚠️ ${event.name}${idPart}: registration form shape anomaly`;
  const qLines = questions.map((q) => `  [${q.type ?? "?"}] ${q.label ?? "(no label)"}`);
  const text = [
    `${event.name}${idPart}: registration form shape anomaly`,
    "",
    "Anomalies:",
    ...anomalies.map((a) => `  • ${a}`),
    "",
    "Questions seen:",
    ...qLines,
    "",
    "Fix the form in Luma to match the Build Bar template, then re-add the event.",
    `Readiness: ${baseUrl}/readiness`,
  ].join("\n");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#111;max-width:620px">` +
    `<p><strong>${escapeHtml(event.name)}${escapeHtml(idPart)}</strong>: registration form shape anomaly</p>` +
    `<p><strong>Anomalies</strong></p><ul>${anomalies.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>` +
    `<p><strong>Questions seen</strong></p><ul>${questions.map((q) => `<li>[${escapeHtml(q.type ?? "?")}] ${escapeHtml(q.label ?? "(no label)")}</li>`).join("")}</ul>` +
    `<p>Fix the form in Luma to match the Build Bar template, then re-add the event.</p>` +
    `<p><a href="${baseUrl}/readiness">Open the readiness page →</a></p></div>`;

  let count = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html, text });
      count++;
    } catch (err) {
      console.error("[form-anomaly] alert email failed for", to, err);
    }
  }
  return count;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/readiness-email-anomalies.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/readiness/email.ts tests/readiness-email-anomalies.test.ts
git commit -m "feat(readiness): emailFormAnomalies alert for form-shape problems"
```

---

## Task 6: Surface anomalies on `/readiness`

**Files:**
- Modify: `lib/readiness/evaluate.ts` (`EventCheckInput`, `evaluateEvent`)
- Modify: `lib/readiness/check.ts` (select column + pass input)
- Test: `tests/readiness.test.ts`

- [ ] **Step 1: Write failing test** (append to `tests/readiness.test.ts`)

```ts
import { evaluateEvent } from "@/lib/readiness/evaluate";

describe("evaluateEvent — form anomalies", () => {
  const base = {
    city: "Seoul", timezone: "Asia/Seoul", address: "123 St", slotCount: 4,
    calendarConnected: true,
    slack: { postable: true, botInChannel: true, channelName: "#x" },
  };

  it("reports an error when the form has anomalies", () => {
    const issues = evaluateEvent({ ...base, formAnomalies: ["no question with time-slot options"] });
    expect(issues.some((i) => i.level === "error" && /form shape/i.test(i.message))).toBe(true);
  });

  it("reports nothing extra when there are no anomalies", () => {
    const clean = evaluateEvent({ ...base, formAnomalies: [] });
    expect(clean.some((i) => /form shape/i.test(i.message))).toBe(false);
  });
});
```

(Confirm the `Issue` shape fields in `tests/readiness.test.ts`/`evaluate.ts`: the
property is `level` (`"error"|"warn"`) and `message`. If the existing test file
imports differ, match them.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/readiness.test.ts`
Expected: FAIL — `formAnomalies` not in `EventCheckInput` (type error) / no such issue.

- [ ] **Step 3: Add `formAnomalies` to `EventCheckInput` and emit the issue**

In `lib/readiness/evaluate.ts`, add to `EventCheckInput` (after `slack`):
```ts
  /** Form-shape anomalies from classifyForm at registration ([] = clean, treat
   * absent as []). Non-empty ⇒ guest fields may not map. */
  formAnomalies?: string[];
```
In `evaluateEvent`, just before `return issues;`, add:
```ts
  if (e.formAnomalies && e.formAnomalies.length > 0) {
    issues.push(err(`Registration form shape looks off (${e.formAnomalies[0]}) — guest fields may not map. Re-add the event after fixing the Luma form.`));
  }
```

- [ ] **Step 4: Select the column and pass it in `check.ts`**

In `lib/readiness/check.ts`:

Add `form_anomalies` to the events select (line ~83):
```ts
    .select("id, name, city, timezone, address, event_date, luma_calendar, luma_event_id, readiness_acked_at, prep_instructions, status, form_anomalies")
```
In the `evaluateEvent({ … })` call (inside the `events.map`), add:
```ts
        formAnomalies: (e.form_anomalies as string[] | null) ?? [],
```

- [ ] **Step 5: Run readiness tests + typecheck**

Run: `npx vitest run tests/readiness.test.ts && npm run -s typecheck`
Expected: PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add lib/readiness/evaluate.ts lib/readiness/check.ts tests/readiness.test.ts
git commit -m "feat(readiness): surface form-shape anomalies on the readiness check"
```

---

## Task 7: Full verification + recover live Seoul data

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green (prior 448 + the new tests).

- [ ] **Step 2: Typecheck**

Run: `npm run -s typecheck`
Expected: exits 0.

- [ ] **Step 3: Re-register the Seoul event to populate `form_anomalies` and confirm clean**

Run: `npm run -s register:event -- --luma evt-jzP5hHix8aFcYZ1`
Then MCP `execute_sql` on `jldgxdaemtdqcfrdzeby`:
```sql
select luma_event_id, form_anomalies from events where luma_event_id='evt-jzP5hHix8aFcYZ1';
```
Expected: `form_anomalies` = `[]` (the Seoul form is well-formed; the anomaly path is only for a genuinely broken form). Guest fields for Sunjung remain correctly mapped (re-check `bookings` for the Seoul event if desired).

- [ ] **Step 4: Commit any incidental fixes, then report**

No code commit expected here. Summarize: all tests pass, typecheck clean, Seoul form classifies with no anomalies.

---

## Self-review notes (completed during planning)

- **Spec coverage:** ingest value-shape mapping → Task 1; `classifyForm` → Task 2; `events.form_anomalies` storage → Task 3; registration wiring + email trigger → Task 4; `emailFormAnomalies` → Task 5; `/readiness` surface → Task 6; verification + any-language proof (Spanish test in Task 1, Korean in Task 2) → Tasks 1/2/7. All spec sections map to a task.
- **Type consistency:** `classifyForm` returns `{ anomalies: string[] }` everywhere; `upsertEvent` input `formAnomalies?: string[]`; `EventCheckInput.formAnomalies?: string[]`; column `form_anomalies jsonb`; `emailFormAnomalies(event, questions, anomalies, baseUrl)` signature matches its call in Task 4.
- **Ordering caveat:** Task 4 references `emailFormAnomalies` (Task 5) and the regenerated types with `form_anomalies` (Task 3). If executing strictly sequentially, do Task 3 and Task 5 before Task 4’s typecheck step passes. The dependency is called out in Task 4.
