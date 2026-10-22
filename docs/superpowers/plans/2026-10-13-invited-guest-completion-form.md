# Invited-Guest Completion Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email Luma-invited (no-form) guests a tokenized link to complete the event's registration form, writing their answers back onto their existing booking and both Notion mirrors.

**Architecture:** A pure `isInvitedGuest` predicate + an auto-send in the live webhook emits a new `complete_registration` email carrying a 14-day HMAC magic link. The `/complete-registration/[token]` page renders the event's real Luma questions; submit reconstructs Luma-shaped answers and replays them through the existing `normalizeGuest → ingestRegistration` pipeline (slot match, `no_help_needed → unassigned`, dual-Notion sync). No Slack post, no confirmation email.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Resend, Vitest. Reuses `lib/auth/token.ts` (HMAC), `lib/luma/parse.ts` (`normalizeGuest`), `lib/events/ingest.ts`, `lib/email/*`.

**Spec:** `docs/superpowers/specs/2026-10-13-invited-guest-completion-form-design.md`

---

## File structure

- Create `lib/auth/booking-token.ts` — issue/verify a per-booking magic-link token.
- Create `lib/events/invited.ts` — `isInvitedGuest(norm)` predicate.
- Create `app/complete-registration/[token]/page.tsx` — guest form (client).
- Create `app/api/complete-registration/load/route.ts` — token → questions + prefill.
- Create `app/api/complete-registration/submit/route.ts` — answers → ingest.
- Create `supabase/migrations/00NN_email_log_complete_registration.sql` — comms kind constraint.
- Modify `lib/email/templates.ts` — new kind, template, `CommsFields.completionLink`, `buildVars`.
- Modify `lib/email/comms.ts` — `RECIPIENTS` entry, mint link in `defaultDeps.getFields`.
- Modify `lib/events/ingest.ts` — auto-send on detect.
- Tests: `tests/booking-token.test.ts`, `tests/invited-guest.test.ts`, `tests/complete-registration-submit.test.ts`, extend `tests/notion-mappers.test.ts`/`tests/email-templates.test.ts` as noted.

---

## Task 1: Booking magic-link token

**Files:**
- Create: `lib/auth/booking-token.ts`
- Test: `tests/booking-token.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/booking-token.test.ts
import { describe, it, expect } from "vitest";
import { issueBookingToken, verifyBookingToken } from "@/lib/auth/booking-token";

const SECRET = "test-secret";
const NOW = 1_760_000_000_000; // fixed ms

describe("booking-token", () => {
  it("round-trips a booking id", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    expect(await verifyBookingToken(tok, SECRET, NOW)).toBe("b-123");
  });

  it("rejects a tampered token", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    expect(await verifyBookingToken(tok + "x", SECRET, NOW)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    expect(await verifyBookingToken(tok, "other", NOW)).toBeNull();
  });

  it("rejects an expired token (>14 days old)", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    const later = NOW + 15 * 24 * 60 * 60 * 1000;
    expect(await verifyBookingToken(tok, SECRET, later)).toBeNull();
  });

  it("rejects a non-booking payload", async () => {
    const { signToken } = await import("@/lib/auth/token");
    const bad = await signToken(`form.${NOW}`, SECRET);
    expect(await verifyBookingToken(bad, SECRET, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/booking-token.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth/booking-token'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/auth/booking-token.ts
import { signToken, verifyToken } from "./token";

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** A per-booking magic-link token for the invited-guest completion form. Carries
 * the booking id + issue time; verified by signature and a 14-day window. */
export async function issueBookingToken(bookingId: string, secret: string, nowMs: number): Promise<string> {
  return signToken(`booking.${bookingId}.${nowMs}`, secret);
}

export async function verifyBookingToken(token: string, secret: string, nowMs: number): Promise<string | null> {
  const payload = await verifyToken(token, secret);
  if (!payload || !payload.startsWith("booking.")) return null;
  const rest = payload.slice("booking.".length);
  const lastDot = rest.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const bookingId = rest.slice(0, lastDot);
  const issued = Number(rest.slice(lastDot + 1));
  if (!bookingId || !Number.isFinite(issued)) return null;
  if (nowMs < issued || nowMs - issued > MAX_AGE_MS) return null;
  return bookingId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/booking-token.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/booking-token.ts tests/booking-token.test.ts
git commit -m "feat(auth): per-booking magic-link token for completion form"
```

---

## Task 2: `isInvitedGuest` predicate

**Files:**
- Create: `lib/events/invited.ts`
- Test: `tests/invited-guest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/invited-guest.test.ts
import { describe, it, expect } from "vitest";
import { isInvitedGuest } from "@/lib/events/invited";
import type { NormalizedRegistration } from "@/lib/luma/parse";

const base: NormalizedRegistration = {
  lumaGuestId: "gst-1", lumaEventId: "evt-1", guestName: "A", guestEmail: "a@x.com",
  guestPhone: null, role: null, company: null, challenge: null, notionEmail: null,
  notionPlan: null, experienceLevel: null, attendReasons: null, requestedSlot: null,
  isCheckedIn: false, approvalStatus: "approved",
};

describe("isInvitedGuest", () => {
  it("is true when the guest answered nothing (host-invited)", () => {
    expect(isInvitedGuest(base)).toBe(true);
  });
  it("is false when any form field is present", () => {
    expect(isInvitedGuest({ ...base, challenge: "Automations" })).toBe(false);
    expect(isInvitedGuest({ ...base, requestedSlot: "2:00-2:30 PM" })).toBe(false);
    expect(isInvitedGuest({ ...base, company: "Acme" })).toBe(false);
    expect(isInvitedGuest({ ...base, experienceLevel: "Beginner" })).toBe(false);
    expect(isInvitedGuest({ ...base, notionPlan: "Free" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/invited-guest.test.ts`
Expected: FAIL — `Cannot find module '@/lib/events/invited'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/events/invited.ts
import type { NormalizedRegistration } from "../luma/parse";

/** A host-invited guest bypasses the Luma registration form, so NONE of the
 * mapped form fields are present. (Name/email come from the invite, not answers.) */
export function isInvitedGuest(norm: NormalizedRegistration): boolean {
  return (
    !norm.requestedSlot &&
    !norm.challenge &&
    !norm.role &&
    !norm.company &&
    !norm.experienceLevel &&
    !norm.attendReasons &&
    !norm.notionPlan
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/invited-guest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/events/invited.ts tests/invited-guest.test.ts
git commit -m "feat(events): isInvitedGuest predicate (zero-answer host invite)"
```

---

## Task 3: `complete_registration` comms kind (template + wiring + migration)

**Files:**
- Modify: `lib/email/templates.ts` (`CommsKind`, `TemplateKey`, `TEMPLATE_REGISTRY`, `CommsFields`, `buildVars`)
- Modify: `lib/email/comms.ts` (`RECIPIENTS`, `defaultDeps.getFields`)
- Create: `supabase/migrations/00NN_email_log_complete_registration.sql`
- Test: `tests/email-templates.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/email-templates.test.ts`:

```typescript
import { renderComms, buildVars, type CommsFields } from "@/lib/email/templates";

describe("complete_registration template", () => {
  const f = {
    bookingId: "b-1", guestName: "Sam", guestEmail: "sam@x.com", company: null, role: null,
    challenge: null, guestPhone: null, slotName: null, slotStartsAt: null, slotEndsAt: null,
    eventName: "Notion Build Bar Singapore", eventDate: "2026-10-22", location: "Singapore",
    address: null, helperName: null, helperEmail: null, status: "no_help_needed", slotId: null,
    calendarUrl: null, completionLink: "https://hub.test/complete-registration/TOK",
  } as unknown as CommsFields;

  it("maps completionLink into the body", () => {
    expect(buildVars("guest", f).completionLink).toBe("https://hub.test/complete-registration/TOK");
  });

  it("renders the guest email with the completion link", () => {
    const out = renderComms("complete_registration", "guest", f);
    expect(out).not.toBeNull();
    expect(out!.html + out!.text).toContain("https://hub.test/complete-registration/TOK");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email-templates.test.ts -t "complete_registration"`
Expected: FAIL — `completionLink` missing on `CommsFields` type / template key not found.

- [ ] **Step 3a: Add the kind + template key**

In `lib/email/templates.ts`, append `| "complete_registration"` to the `CommsKind` union (line 1) and `| "complete_registration__guest"` to the `TemplateKey` union (near line 164).

- [ ] **Step 3b: Add `completionLink` to `CommsFields`**

Find the `CommsFields` interface in `lib/email/templates.ts` and add:

```typescript
  /** Absolute magic-link for the invited-guest completion form (minted in getFields). */
  completionLink?: string | null;
```

- [ ] **Step 3c: Add the template entry**

In `TEMPLATE_REGISTRY` (lib/email/templates.ts), add:

```typescript
  complete_registration__guest: {
    label: "Complete your registration",
    description: "Invited guests finish the registration form",
    role: "guest",
    subject: "Finish registering for {{eventName}}",
    body: b(
      "Hi {{firstName}},",
      "You're on the list for {{eventName}}! To get the most out of it, please take a minute to finish your registration:",
      "👉 [Complete your registration]({{completionLink}})",
      "See you there,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
```

Note: `{{eventName}}` must be a valid placeholder. If `buildVars` does not already
return `eventName`, add `eventName: f.eventName ?? ""` to its returned object.

- [ ] **Step 3d: Map `completionLink` in `buildVars`**

In `buildVars` (lib/email/templates.ts), add to the returned object:

```typescript
    completionLink: f.completionLink ?? "",
    eventName: f.eventName ?? "",
```

Add both `completionLink` and `eventName` to the `PLACEHOLDERS` array in the same file.

- [ ] **Step 3e: Mint the link in `defaultDeps.getFields`**

In `lib/email/comms.ts`, inside `defaultDeps.getFields`, after `f` is built and before `return f;`, add:

```typescript
    // Magic link for the invited-guest completion form. Minted here (async) and
    // read synchronously by buildVars — same pattern as calendarUrl above.
    try {
      const { issueBookingToken } = await import("../auth/booking-token");
      const secret = env.app.sessionSecret();
      const tok = await issueBookingToken(f.bookingId, secret, Date.now());
      f.completionLink = `${env.app.baseUrl().replace(/\/$/, "")}/complete-registration/${tok}`;
    } catch {
      /* best-effort; the completion email just omits the link if signing fails */
    }
```

- [ ] **Step 3f: Add the RECIPIENTS entry**

In `lib/email/comms.ts`, add to the `RECIPIENTS` map:

```typescript
  complete_registration: ["guest"],
```

- [ ] **Step 3g: Add the DB constraint migration**

First find the next number: run the Supabase MCP `list_migrations` and use the next integer after the remote max (do NOT trust local filenames). Create `supabase/migrations/00NN_email_log_complete_registration.sql` with the FULL current kind list plus the new one:

```sql
-- 00NN — complete_registration comms kind
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned','checked_in','no_show','cancelled','expert_unavailable','declined',
    'waitlisted','event_cancelled','arrived_after_no_show','double_booked',
    'feedback_request','feedback_reminder','prep_reminder','rematch_pending',
    'unmatched_notice','reassigned_off','already_claimed','day_of_agenda',
    'unclaim_denied','slot_changed','prep_reminder_day_before','cowork_only',
    'cowork_only_accept','guest_cancelled','prep_reminder_day_before_paid',
    'complete_registration'
  ));
```

Before applying, confirm the existing kind list by reading the latest
`email_log_event_kind_check` definition (query `information_schema`/`pg_constraint`
or the most recent `email_log_*` migration) so none are dropped. Apply via the
Supabase MCP `apply_migration` (name `email_log_complete_registration`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/email-templates.test.ts` then `npx vitest run` (full suite) and `npx tsc --noEmit`.
Expected: all PASS; typecheck clean. (The `RECIPIENTS` map is typed `Record<CommsKind, …>`, so a missing entry fails the build — that's the guard.)

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts lib/email/comms.ts supabase/migrations/00NN_email_log_complete_registration.sql tests/email-templates.test.ts
git commit -m "feat(comms): complete_registration kind + magic-link templating"
```

---

## Task 4: Auto-send on detection (live webhook)

**Files:**
- Modify: `lib/events/ingest.ts`
- Test: `tests/invited-guest.test.ts` (extend with an ingest-level test using injected deps)

- [ ] **Step 1: Write the failing test**

The cleanest seam is to notify through the existing comms. Add an optional injected
sender to `ingestRegistration` so the test asserts it fires exactly for an invited
approved guest. Add to `tests/invited-guest.test.ts`:

```typescript
import { shouldSendCompletion } from "@/lib/events/invited";

describe("shouldSendCompletion", () => {
  it("true for an approved invited guest on the live webhook", () => {
    expect(shouldSendCompletion({ invited: true, lumaStatus: "approved", live: true })).toBe(true);
  });
  it("false when not live (backfill), not approved, or not invited", () => {
    expect(shouldSendCompletion({ invited: true, lumaStatus: "approved", live: false })).toBe(false);
    expect(shouldSendCompletion({ invited: true, lumaStatus: "pending", live: true })).toBe(false);
    expect(shouldSendCompletion({ invited: false, lumaStatus: "approved", live: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/invited-guest.test.ts -t shouldSendCompletion`
Expected: FAIL — `shouldSendCompletion` not exported.

- [ ] **Step 3: Implement the pure gate + wire the send**

Add to `lib/events/invited.ts`:

```typescript
import type { LumaStatus } from "../sync/types";

/** Gate for the auto-send: only an approved, zero-answer guest on the LIVE webhook
 * (never during silent backfill) is prompted to complete the form. */
export function shouldSendCompletion(p: { invited: boolean; lumaStatus: LumaStatus; live: boolean }): boolean {
  return p.invited && p.live && p.lumaStatus === "approved";
}
```

Then in `lib/events/ingest.ts`, after `pushBookingToWorkspaces(...)` and before
`return { status: "ingested", ... }`, add:

```typescript
  if (shouldSendCompletion({ invited: isInvitedGuest(norm), lumaStatus: nextLumaStatus, live: opts.live })) {
    // One-shot via the comms ledger (reserve() dedups across repeated webhooks).
    await sendBookingComms(booking.id, "complete_registration");
  }
```

Add the imports at the top of `lib/events/ingest.ts`:

```typescript
import { isInvitedGuest, shouldSendCompletion } from "./invited";
import { sendBookingComms } from "../email/comms";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/invited-guest.test.ts` then `npx vitest run` and `npx tsc --noEmit`.
Expected: PASS; existing ingest/webhook tests still green.

- [ ] **Step 5: Commit**

```bash
git add lib/events/ingest.ts lib/events/invited.ts tests/invited-guest.test.ts
git commit -m "feat(ingest): auto-email invited guests a completion link (once)"
```

---

## Task 5: Load API — token → questions + prefill

**Files:**
- Create: `app/api/complete-registration/load/route.ts`
- Reference: `app/api/change-slot/lookup/route.ts`, `lib/luma/client.ts` (`getLumaEvent`, `extractSlotOptions`), `lib/db/bookings.ts` (`getBookingById`), `lib/db/events.ts` (`getEventById`), `lib/luma/calendars.ts` (`lumaCalendars`).

- [ ] **Step 1: Write the implementation**

```typescript
// app/api/complete-registration/load/route.ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyBookingToken } from "@/lib/auth/booking-token";
import { getBookingById } from "@/lib/db/bookings";
import { getEventById } from "@/lib/db/events";
import { lumaCalendars } from "@/lib/luma/calendars";
import { getLumaEvent, extractSlotOptions } from "@/lib/luma/client";

export const runtime = "nodejs";

/** Shape sent to the form: enough to render each question + prefill known values. */
interface LoadQuestion { id: string; label: string; kind: "text" | "select" | "slot"; options: string[] }

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return NextResponse.json({ error: "Missing link." }, { status: 400 });

  const bookingId = await verifyBookingToken(token, env.app.sessionSecret(), Date.now());
  if (!bookingId) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });

  const booking = await getBookingById(bookingId);
  if (!booking) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  const event = await getEventById(booking.event_id);
  if (!event?.luma_event_id) return NextResponse.json({ error: "Event unavailable." }, { status: 404 });

  // Fetch the event's real Luma questions from the owning calendar.
  let questions: LoadQuestion[] = [];
  for (const cal of await lumaCalendars()) {
    try {
      const detail = await getLumaEvent(event.luma_event_id, cal.apiKey);
      const slotLabels = extractSlotOptions(detail.registration_questions ?? []);
      const slotSet = new Set(slotLabels);
      questions = (detail.registration_questions ?? []).map((q, i) => {
        const options = (q.options ?? []).map((o) => (typeof o === "string" ? o : String((o as { label?: string }).label ?? o)));
        const isSlot = options.length > 0 && options.every((o) => slotSet.has(o)) && slotLabels.length > 0;
        return {
          id: q.id ?? `q${i}`,
          label: q.label ?? `Question ${i + 1}`,
          kind: isSlot ? "slot" : options.length > 0 ? "select" : "text",
          options,
        };
      });
      break;
    } catch {
      /* not this calendar's event — try the next key */
    }
  }
  if (questions.length === 0) {
    return NextResponse.json({ error: "This event's form is unavailable right now." }, { status: 502 });
  }

  return NextResponse.json({
    eventName: event.name,
    prefill: { challenge: booking.challenge, role: booking.role, company: booking.company, requestedSlot: booking.requested_slot },
    questions,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (If `LumaRegistrationQuestion.options` element typing differs, adjust the `String(...)` coercion to match `optionLabel` in `lib/luma/client.ts`.)

- [ ] **Step 3: Commit**

```bash
git add app/api/complete-registration/load/route.ts
git commit -m "feat(api): load invited-guest completion form from a token"
```

---

## Task 6: Submit API — answers → ingest

**Files:**
- Create: `app/api/complete-registration/submit/route.ts`
- Test: `tests/complete-registration-submit.test.ts`
- Reference: `lib/luma/parse.ts` (`normalizeGuest`), `lib/events/ingest.ts` (`ingestRegistration`), `lib/luma/types.ts` (`LumaGuestData`).

The submit reconstructs a `registration_answers` array (label + a derived
`question_type` so the value-shape mapper works) and replays it through
`normalizeGuest → ingestRegistration({ live: false })`.

- [ ] **Step 1: Write the failing test (the pure answer-builder)**

```typescript
// tests/complete-registration-submit.test.ts
import { describe, it, expect } from "vitest";
import { buildGuestData } from "@/app/api/complete-registration/submit/build";
import { normalizeGuest } from "@/lib/luma/parse";

describe("buildGuestData → normalizeGuest", () => {
  it("maps a completed form onto the hub fields + slot", () => {
    const data = buildGuestData({
      lumaGuestId: "gst-9", guestEmail: "g@x.com", lumaEventId: "evt-9",
      answers: [
        { label: "What do you need help with?", kind: "text", value: "Automations" },
        { label: "Requested time slot", kind: "slot", value: "2:00-2:30 PM" },
        { label: "Experience level", kind: "select", value: "Beginner" },
      ],
    });
    const norm = normalizeGuest(data);
    expect(norm.challenge).toBe("Automations");
    expect(norm.requestedSlot).toBe("2:00-2:30 PM");
    expect(norm.experienceLevel).toBe("Beginner");
    expect(norm.lumaGuestId).toBe("gst-9");
    expect(norm.lumaEventId).toBe("evt-9");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/complete-registration-submit.test.ts`
Expected: FAIL — module `build` not found.

- [ ] **Step 3: Implement the builder + route**

```typescript
// app/api/complete-registration/submit/build.ts
import type { LumaGuestData } from "@/lib/luma/types";

export interface SubmittedAnswer { label: string; kind: "text" | "select" | "slot"; value: string | string[] }
export interface BuildInput { lumaGuestId: string; guestEmail: string; lumaEventId: string; answers: SubmittedAnswer[] }

/** Map the form's per-question kind to a Luma question_type the value-shape
 * mapper (lib/luma/parse.ts) understands. "slot"/"select" → dropdown; "text" →
 * long-text (so a free-text challenge is picked up even without a Luma type). */
function questionType(kind: SubmittedAnswer["kind"]): string {
  return kind === "text" ? "long-text" : "dropdown";
}

export function buildGuestData(input: BuildInput): LumaGuestData {
  return {
    id: input.lumaGuestId,
    user_email: input.guestEmail,
    event: { id: input.lumaEventId },
    registration_answers: input.answers
      .filter((a) => a.value != null && (Array.isArray(a.value) ? a.value.length : String(a.value).trim()))
      .map((a) => ({ label: a.label, question_type: questionType(a.kind), value: a.value })),
  } as LumaGuestData;
}
```

```typescript
// app/api/complete-registration/submit/route.ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyBookingToken } from "@/lib/auth/booking-token";
import { getBookingById } from "@/lib/db/bookings";
import { getEventById } from "@/lib/db/events";
import { normalizeGuest } from "@/lib/luma/parse";
import { ingestRegistration } from "@/lib/events/ingest";
import { logSync } from "@/lib/sync/log";
import { buildGuestData, type SubmittedAnswer } from "./build";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token, answers } = (await req.json().catch(() => ({}))) as { token?: string; answers?: SubmittedAnswer[] };
  if (!token || !Array.isArray(answers)) return NextResponse.json({ error: "Invalid submission." }, { status: 400 });

  const bookingId = await verifyBookingToken(token, env.app.sessionSecret(), Date.now());
  if (!bookingId) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });

  const booking = await getBookingById(bookingId);
  if (!booking) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  const event = await getEventById(booking.event_id);
  if (!event?.luma_event_id) return NextResponse.json({ error: "Event unavailable." }, { status: 404 });

  try {
    const data = buildGuestData({
      lumaGuestId: booking.luma_guest_id,
      guestEmail: booking.guest_email,
      lumaEventId: event.luma_event_id,
      answers,
    });
    // live:false → silent (no assignment emails); still upserts + pushes to Notion.
    const outcome = await ingestRegistration(normalizeGuest(data), { live: false });
    if (outcome.status !== "ingested") {
      return NextResponse.json({ error: "Could not save your answers." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, eventName: event.name });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", action: "complete_registration", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Something went wrong saving your answers." }, { status: 500 });
  }
}
```

Note: `booking.luma_guest_id` must be non-null (invited guests always have one from
Luma). If the `Booking` type marks it nullable, guard with `if (!booking.luma_guest_id) return 400`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/complete-registration-submit.test.ts` then `npx tsc --noEmit`.
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/complete-registration/submit/build.ts app/api/complete-registration/submit/route.ts tests/complete-registration-submit.test.ts
git commit -m "feat(api): submit invited-guest form via normalizeGuest->ingest"
```

---

## Task 7: The form page (client UI)

**Files:**
- Create: `app/complete-registration/[token]/page.tsx`
- Reference: `app/change-slot/page.tsx` (styling + fetch pattern — copy its structure/classes).

- [ ] **Step 1: Implement the page**

```tsx
// app/complete-registration/[token]/page.tsx
"use client";
import { useEffect, useState } from "react";

interface Q { id: string; label: string; kind: "text" | "select" | "slot"; options: string[] }

export default function CompleteRegistration({ params }: { params: { token: string } }) {
  const [state, setState] = useState<"loading" | "form" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [questions, setQuestions] = useState<Q[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/complete-registration/load", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: params.token }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "This link is invalid."); setState("error"); return; }
      setEventName(data.eventName ?? "");
      setQuestions(data.questions ?? []);
      setState("form");
    })();
  }, [params.token]);

  async function submit() {
    setBusy(true); setError(null);
    const answers = questions.map((q) => ({ label: q.label, kind: q.kind, value: values[q.id] ?? "" }));
    const res = await fetch("/api/complete-registration/submit", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: params.token, answers }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
    setState("done");
  }

  if (state === "loading") return <main className="mx-auto max-w-lg p-6">Loading…</main>;
  if (state === "error") return <main className="mx-auto max-w-lg p-6"><p>{error}</p></main>;
  if (state === "done") return <main className="mx-auto max-w-lg p-6"><h1 className="text-xl font-semibold">You're all set 🎉</h1><p>Thanks — your registration for {eventName} is complete.</p></main>;

  return (
    <main className="mx-auto max-w-lg p-6 space-y-4">
      <h1 className="text-xl font-semibold">Finish registering for {eventName}</h1>
      {questions.map((q) => (
        <label key={q.id} className="block space-y-1">
          <span className="text-sm font-medium">{q.label}</span>
          {q.kind === "text" ? (
            <textarea className="w-full rounded border p-2" rows={3}
              value={values[q.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))} />
          ) : (
            <select className="w-full rounded border p-2"
              value={values[q.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))}>
              <option value="">Select…</option>
              {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </label>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="rounded bg-black px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={submit}>
        {busy ? "Saving…" : "Submit"}
      </button>
    </main>
  );
}
```

Match the exact Tailwind classes/layout used by `app/change-slot/page.tsx` for visual consistency; the logic above is what matters.

- [ ] **Step 2: Build check**

Run: `npm run build` (or `npx tsc --noEmit` if build is heavy).
Expected: compiles; the route `/complete-registration/[token]` is emitted.

- [ ] **Step 3: Commit**

```bash
git add app/complete-registration/[token]/page.tsx
git commit -m "feat(web): invited-guest completion form page"
```

---

## Task 8: Full-suite verification + manual smoke

- [ ] **Step 1: Full test suite + typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all green; clean.

- [ ] **Step 2: Manual smoke (local, against a real invited guest)**

Mint a token for a known no-answer booking and open the form:

```bash
npx tsx --env-file=.env.local -e "import('./lib/auth/booking-token').then(async m => console.log(await m.issueBookingToken('<bookingId>', process.env.HUB_SESSION_SECRET, Date.now())))"
```

Open `http://localhost:3000/complete-registration/<token>`, submit, then verify in
Supabase that the booking now has `challenge`/`requested_slot`/`status` set and
`last_synced_at` just updated (Notion mirrored). Confirm a repeated submit is idempotent.

- [ ] **Step 3: Commit any fixes, then open PR**

```bash
git push -u origin feat/invited-guest-completion
gh pr create --base main --title "feat: invited-guest registration completion form" --body "Implements docs/superpowers/specs/2026-10-13-invited-guest-completion-form-design.md"
```

---

## Self-review notes (coverage)

- Spec §1 detect+auto-send → Tasks 2, 4. §2 token → Task 1. §3 form → Tasks 5, 6, 7.
  §4 comms kind → Task 3. Testing → each task. Non-goals (no Slack / no confirmation
  email) honored: Task 6 uses `live:false` and never calls Slack/confirmation.
- Risks (VIP suppression, token expiry) are documented in the spec; v1 accepts them
  (expiry handled by the load API's "invalid or expired" branch).
