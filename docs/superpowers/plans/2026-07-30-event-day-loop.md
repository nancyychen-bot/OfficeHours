# Event-Day Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React to the full Luma guest lifecycle in the hub — gate bookings on approval, cancel + free slots + notify on decline, and notify the assigned helper (Notion + email) on check-in.

**Architecture:** The Luma webhook branches on `approval_status` (via a pure `lifecycleAction` helper): approved → create booking, pending → ignore, declined → cancel (free slot, archive Notion, email helper). Check-in fires a Resend email to the helper (whose email was captured from their Notion Person at claim time). Notion in-app notification is a no-code automation the organizer sets up.

**Tech Stack:** Next.js 15 route handlers, Supabase, `@notionhq/client` v5, Resend, Luma API, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-30-event-day-loop-design.md`

**Conventions:** Vitest tests in `tests/` via `@/` alias; pure logic extracted for unit testing; DB via `getAdminClient()`; commit after each task; `npx tsc --noEmit` + `npx vitest run` must stay green.

---

### Task 0: Validate a real Luma RSVP (manual, do first)

Not a code task — a prerequisite validation done by the controller + user (a subagent cannot RSVP).

- [ ] Ensure Luma "Require approval" is ON for the "Office Hours (Test)" event, then RSVP on its Luma page with `nchen@makenotion.com`, filling company + challenge + a time-slot.
- [ ] Approve the registration in Luma (so `guest.updated` with `approved` fires).
- [ ] Verify in Supabase (`bookings` where `luma_guest_id` = the new `gst-…`) that a row exists with company, challenge, and a matched `slot_id`; and that both Notion DBs show the card. Query:
```bash
SRK=<service_role>; curl -s -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  "https://jldgxdaemtdqcfrdzeby.supabase.co/rest/v1/booking_details?select=guest_name,company,challenge,slot_name,status,notion_dev_page_id,notion_ambassador_page_id&order=created_at.desc&limit=3"
```
- [ ] Note: current deployed code creates the booking on ANY registration (approval gating ships in this plan). This test just confirms the live Luma→hub→DB→Notion path works with real traffic.

---

### Task 1: Migrations — `cancelled` booking status + `booked_by_email`

**Files:**
- Create: `supabase/migrations/0003_booking_status_cancelled.sql`
- Create: `supabase/migrations/0004_booking_booked_by_email.sql`
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Create the enum migration**

`supabase/migrations/0003_booking_status_cancelled.sql`:
```sql
-- A booking that was approved then declined/cancelled (kept for reporting).
alter type booking_status add value if not exists 'cancelled';
```

- [ ] **Step 2: Create the column migration**

`supabase/migrations/0004_booking_booked_by_email.sql`:
```sql
-- The assigned helper's email (read from their Notion Person at claim time),
-- used to send check-in / cancellation notifications.
alter table bookings add column if not exists booked_by_email text;
```

- [ ] **Step 3: Apply both migrations** via the Supabase MCP `apply_migration` tool (project `jldgxdaemtdqcfrdzeby`), names `booking_status_cancelled` then `booking_booked_by_email`. Apply the enum one on its own (ADD VALUE can't share a transaction).

- [ ] **Step 4: Update `lib/supabase/types.ts`**

Change the `booking_status` union:
```ts
      booking_status: "unassigned" | "assigned" | "checked_in" | "no_show" | "cancelled"
```
Update the `Constants` `booking_status` array to include `"cancelled"`. Add `booked_by_email: string | null` to the `bookings` `Row`, and `booked_by_email?: string | null` to its `Insert` and `Update`. Also add `booked_by_email: string | null` to the `booking_details` view `Row`.

- [ ] **Step 5: Verify** `npx tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/0003_booking_status_cancelled.sql supabase/migrations/0004_booking_booked_by_email.sql lib/supabase/types.ts
git commit -m "feat: cancelled booking status + booked_by_email column"
```

---

### Task 2: `approvalStatus` + pure `lifecycleAction`

**Files:**
- Modify: `lib/luma/parse.ts` (add `approvalStatus` to normalized guest)
- Create: `lib/events/lifecycle.ts`
- Test: `tests/lifecycle.test.ts`, and add to `tests/luma.test.ts`

- [ ] **Step 1: Add `approvalStatus` to `NormalizedRegistration`**

In `lib/luma/parse.ts`, add `approvalStatus: string | null;` to the `NormalizedRegistration` interface, and in `normalizeGuest` add to the returned object:
```ts
    approvalStatus: data.approval_status ?? null,
```
(`LumaGuestData.approval_status?: string` already exists in `lib/luma/types.ts`.)

- [ ] **Step 2: Write the failing lifecycle test**

`tests/lifecycle.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { lifecycleAction } from "@/lib/events/lifecycle";

describe("lifecycleAction", () => {
  it("approved -> create", () => expect(lifecycleAction("approved")).toBe("create"));
  it("declined -> cancel", () => expect(lifecycleAction("declined")).toBe("cancel"));
  it("pending_approval -> ignore", () => expect(lifecycleAction("pending_approval")).toBe("ignore"));
  it("waitlist -> ignore", () => expect(lifecycleAction("waitlist")).toBe("ignore"));
  it("invited -> ignore", () => expect(lifecycleAction("invited")).toBe("ignore"));
  it("null/unknown -> ignore", () => {
    expect(lifecycleAction(null)).toBe("ignore");
    expect(lifecycleAction("something_new")).toBe("ignore");
  });
});
```

- [ ] **Step 3: Run to verify FAIL** — `npx vitest run tests/lifecycle.test.ts` (module not found).

- [ ] **Step 4: Implement `lib/events/lifecycle.ts`**
```ts
export type LifecycleAction = "create" | "ignore" | "cancel";

/**
 * Map a Luma approval_status to what the hub should do. Only approved guests
 * become bookings; declined cancels; everything else (pending/waitlist/invited/
 * unknown) is ignored so un-vetted signups never reach the shared DB.
 */
export function lifecycleAction(approvalStatus: string | null | undefined): LifecycleAction {
  switch (approvalStatus) {
    case "approved":
      return "create";
    case "declined":
      return "cancel";
    default:
      return "ignore";
  }
}
```

- [ ] **Step 5: Add a parse assertion** to `tests/luma.test.ts` inside the `normalizeGuest` describe:
```ts
  it("exposes approvalStatus", () => {
    expect(normalizeGuest(guest({ approval_status: "approved" })).approvalStatus).toBe("approved");
    expect(normalizeGuest(guest()).approvalStatus).toBeNull();
  });
```

- [ ] **Step 6: Run to verify PASS** — `npx vitest run tests/lifecycle.test.ts tests/luma.test.ts`.

- [ ] **Step 7: Verify** `npx tsc --noEmit` exits 0.

- [ ] **Step 8: Commit**
```bash
git add lib/luma/parse.ts lib/events/lifecycle.ts tests/lifecycle.test.ts tests/luma.test.ts
git commit -m "feat: lifecycleAction + approvalStatus on normalized guest"
```

---

### Task 3: Booking DB helpers + slot-taken tolerance

**Files:**
- Modify: `lib/db/bookings.ts`

- [ ] **Step 1: Add `cancelBooking` and `setBookedByEmail`**

Append to `lib/db/bookings.ts`:
```ts
/** Cancel an approved booking: mark cancelled and free its slot (kept for reporting). */
export async function cancelBooking(bookingId: string): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", slot_id: null })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Store the assigned helper's email (from their Notion Person) for notifications. */
export async function setBookedByEmail(bookingId: string, email: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("bookings")
    .update({ booked_by_email: email })
    .eq("id", bookingId);
  if (error) throw error;
}
```

- [ ] **Step 2: Make `upsertBookingFromLuma` tolerate a taken slot**

In `lib/db/bookings.ts`, replace the body of `upsertBookingFromLuma` so a slot already held by another guest (unique-violation `23505` on `bookings_one_per_slot`) falls back to `slot_id: null` instead of throwing:
```ts
export async function upsertBookingFromLuma(input: {
  lumaGuestId: string;
  eventId: string;
  slotId: string | null;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  role?: string | null;
  company?: string | null;
  challenge?: string | null;
}): Promise<Booking> {
  const supabase = getAdminClient();
  const row = {
    luma_guest_id: input.lumaGuestId,
    event_id: input.eventId,
    slot_id: input.slotId,
    guest_name: input.guestName,
    guest_email: input.guestEmail,
    guest_phone: input.guestPhone ?? null,
    role: input.role ?? null,
    company: input.company ?? null,
    challenge: input.challenge ?? null,
  };
  const first = await supabase
    .from("bookings")
    .upsert(row, { onConflict: "luma_guest_id" })
    .select("*")
    .single();
  if (!first.error) return first.data;

  // Slot already taken by another guest → keep the booking, drop the slot.
  if (first.error.code === "23505" && input.slotId) {
    const retry = await supabase
      .from("bookings")
      .upsert({ ...row, slot_id: null }, { onConflict: "luma_guest_id" })
      .select("*")
      .single();
    if (retry.error) throw retry.error;
    return retry.data;
  }
  throw first.error;
}
```

- [ ] **Step 3: Verify** `npx tsc --noEmit` exits 0 and `npx vitest run` (full suite) stays green.

- [ ] **Step 4: Commit**
```bash
git add lib/db/bookings.ts
git commit -m "feat: cancelBooking, setBookedByEmail, slot-taken tolerance"
```

---

### Task 4: Email module (Resend client + pure templates)

**Files:**
- Modify: `package.json` (add `resend`), `lib/env.ts`, `.env.example`
- Create: `lib/email/templates.ts`, `lib/email/resend.ts`
- Test: `tests/email-templates.test.ts`

- [ ] **Step 1: Add the dependency**

In `package.json` dependencies add `"resend": "^4.0.0"`, then run `npm install`.

- [ ] **Step 2: Add env accessors**

In `lib/env.ts`, add a new top-level group (alongside `app`):
```ts
  email: {
    apiKey: () => required("RESEND_API_KEY"),
    from: () => optional("EMAIL_FROM") ?? "onboarding@resend.dev",
  },
```

- [ ] **Step 3: Document env**

In `.env.example` under `# --- App ---` (or a new `# --- Email (Resend) ---` block) add:
```
# --- Email (Resend) ---
RESEND_API_KEY=
# From address; use onboarding@resend.dev for testing, Community address once its domain is verified.
EMAIL_FROM=onboarding@resend.dev
```

- [ ] **Step 4: Write the failing template test**

`tests/email-templates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { checkInEmail, cancellationEmail } from "@/lib/email/templates";

describe("checkInEmail", () => {
  it("includes guest, company, slot, and challenge", () => {
    const { subject, text } = checkInEmail({
      guestName: "Alex Rivera", company: "Brightwave",
      slotLabel: "2:00-2:30 PM", challenge: "Roadmap in Notion",
    });
    expect(subject).toContain("Alex Rivera");
    expect(text).toContain("Brightwave");
    expect(text).toContain("2:00-2:30 PM");
    expect(text).toContain("Roadmap in Notion");
  });
  it("omits missing optional lines cleanly", () => {
    const { text } = checkInEmail({ guestName: "Sam", company: null, slotLabel: null, challenge: null });
    expect(text).toContain("Sam");
    expect(text).not.toContain("Slot:");
  });
});

describe("cancellationEmail", () => {
  it("names the guest and slot", () => {
    const { subject, text } = cancellationEmail({ guestName: "Alex Rivera", slotLabel: "2:00-2:30 PM" });
    expect(subject).toContain("Alex Rivera");
    expect(text).toContain("2:00-2:30 PM");
    expect(text.toLowerCase()).toContain("cancel");
  });
});
```

- [ ] **Step 5: Run to verify FAIL** — `npx vitest run tests/email-templates.test.ts`.

- [ ] **Step 6: Implement `lib/email/templates.ts`**
```ts
export interface CheckInEmailInput {
  guestName: string;
  company: string | null;
  slotLabel: string | null;
  challenge: string | null;
}

export function checkInEmail(i: CheckInEmailInput): { subject: string; text: string } {
  const subject = `Your Office Hours guest just checked in: ${i.guestName}`;
  const text = [
    `${i.guestName}${i.company ? ` (${i.company})` : ""} just checked in for your 1:1.`,
    i.slotLabel ? `Slot: ${i.slotLabel}` : null,
    i.challenge ? `What they need help with: ${i.challenge}` : null,
    ``,
    `Head over when you're ready.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return { subject, text };
}

export interface CancellationEmailInput {
  guestName: string;
  slotLabel: string | null;
}

export function cancellationEmail(i: CancellationEmailInput): { subject: string; text: string } {
  const subject = `Office Hours 1:1 cancelled: ${i.guestName}`;
  const text = [
    `Heads up — ${i.guestName} cancelled their Office Hours registration, so your 1:1${
      i.slotLabel ? ` at ${i.slotLabel}` : ""
    } is no longer happening.`,
    `The slot has been freed up for someone else.`,
  ].join("\n");
  return { subject, text };
}
```

- [ ] **Step 7: Implement `lib/email/resend.ts`**
```ts
import { Resend } from "resend";
import { env } from "../env";

/** Send a plain-text email via Resend. Throws on failure; callers treat as best-effort. */
export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<void> {
  const resend = new Resend(env.email.apiKey());
  const { error } = await resend.emails.send({
    from: env.email.from(),
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? String(error)}`);
}
```

- [ ] **Step 8: Run to verify PASS** — `npx vitest run tests/email-templates.test.ts`; then `npx tsc --noEmit`.

- [ ] **Step 9: Commit**
```bash
git add package.json package-lock.json lib/env.ts .env.example lib/email/templates.ts lib/email/resend.ts tests/email-templates.test.ts
git commit -m "feat: Resend email client + check-in/cancellation templates"
```

---

### Task 5: Capture helper email on claim

**Files:**
- Modify: `lib/notion/mappers.ts` (add `readFirstPersonEmail`)
- Modify: `app/api/webhooks/notion/[workspace]/route.ts`
- Test: add to `tests/notion-mappers.test.ts`

- [ ] **Step 1: Write the failing mapper test**

Add to `tests/notion-mappers.test.ts`:
```ts
import { readFirstPersonEmail } from "@/lib/notion/mappers";

describe("readFirstPersonEmail", () => {
  it("reads the first person's email", () => {
    const prop = { people: [{ name: "Nancy", person: { email: "nchen@makenotion.com" } }] };
    expect(readFirstPersonEmail(prop as any)).toBe("nchen@makenotion.com");
  });
  it("returns null when no people or no email", () => {
    expect(readFirstPersonEmail({ people: [] } as any)).toBeNull();
    expect(readFirstPersonEmail({ people: [{ name: "X" }] } as any)).toBeNull();
    expect(readFirstPersonEmail(undefined as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/notion-mappers.test.ts`.

- [ ] **Step 3: Implement `readFirstPersonEmail`** in `lib/notion/mappers.ts` (export it, next to `readFirstPersonName`):
```ts
/**
 * Read the first person's email from a Notion people property. Requires the
 * integration's "Read user information WITH email addresses" capability;
 * otherwise `person.email` is absent and this returns null.
 */
export function readFirstPersonEmail(prop: unknown): string | null {
  const p = prop as { people?: Array<{ person?: { email?: string } }> } | undefined;
  if (!p?.people?.length) return null;
  return p.people[0]?.person?.email ?? null;
}
```
(Note: `readFirstPersonName` is currently a non-exported function; leave it as-is. `readFirstPersonEmail` must be exported for the test and the route.)

- [ ] **Step 4: Run to verify PASS** — `npx vitest run tests/notion-mappers.test.ts`.

- [ ] **Step 5: Capture the email in the claim path**

In `app/api/webhooks/notion/[workspace]/route.ts`, add imports:
```ts
import { readFirstPersonEmail } from "@/lib/notion/mappers";
import { setBookedByEmail } from "@/lib/db/bookings";
```
Then, in the claim branch, immediately after `claimBooking` succeeds (`claim.ok` is true, before/after the push to the other workspace), add:
```ts
      const email = readFirstPersonEmail(page.properties?.[PROP.bookedByPerson]);
      if (email) await setBookedByEmail(claim.booking.id, email);
```
Ensure `PROP` is imported in this file (`import { PROP } from "@/lib/notion/schema";` — add if missing). `page` is the fetched page already in scope in the claim path.

- [ ] **Step 6: Verify** `npx tsc --noEmit` exits 0 and `npm run build` succeeds.

- [ ] **Step 7: Commit**
```bash
git add lib/notion/mappers.ts app/api/webhooks/notion/[workspace]/route.ts tests/notion-mappers.test.ts
git commit -m "feat: capture helper email from Notion Person on claim"
```

---

### Task 6: Archive Notion pages on cancellation

**Files:**
- Modify: `lib/notion/push.ts`

- [ ] **Step 1: Add `archiveBookingPages`**

Append to `lib/notion/push.ts`:
```ts
/**
 * Archive (trash) a booking's mirrored pages in both workspaces — used on
 * cancellation so the card disappears from every board. Best-effort per side.
 */
export async function archiveBookingPages(booking: Booking): Promise<void> {
  for (const workspace of ["dev", "ambassador"] as const) {
    if (!isConfigured(workspace)) continue;
    const pageId =
      workspace === "dev" ? booking.notion_dev_page_id : booking.notion_ambassador_page_id;
    if (!pageId) continue;
    try {
      const notion = getNotionClient(workspace);
      await notion.pages.update({ page_id: pageId, archived: true });
    } catch (err) {
      await logSync({
        direction: workspace === "dev" ? "hub_to_dev" : "hub_to_amb",
        result: "error",
        bookingId: booking.id,
        action: "archive",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
```
(`isConfigured`, `getNotionClient`, `logSync`, and `Booking` are already imported/defined in `push.ts`.)

- [ ] **Step 2: Verify** `npx tsc --noEmit` exits 0.

- [ ] **Step 3: Commit**
```bash
git add lib/notion/push.ts
git commit -m "feat: archiveBookingPages for cancellation"
```

---

### Task 7: Luma handler — lifecycle rework + notifications

**Files:**
- Modify: `app/api/webhooks/luma/route.ts`

- [ ] **Step 1: Add imports**

At the top of `app/api/webhooks/luma/route.ts` add:
```ts
import { lifecycleAction } from "@/lib/events/lifecycle";
import { getBookingByLumaGuestId, cancelBooking } from "@/lib/db/bookings";
import { archiveBookingPages } from "@/lib/notion/push";
import { getSlotById } from "@/lib/db/slots";
import { sendEmail } from "@/lib/email/resend";
import { checkInEmail, cancellationEmail } from "@/lib/email/templates";
```
(Keep existing imports: `upsertBookingFromLuma`, `checkInByLumaGuestId`, `getEventByLumaId`, `matchSlotForEvent`, `pushBookingToWorkspaces`, `normalizeGuest`, `logSync`, etc.)

- [ ] **Step 2: Branch on lifecycle inside the `try` (after `const norm = normalizeGuest(data);`)**

Replace the current body from `const event = await getEventByLumaId(...)` through the success `logSync` with:
```ts
    const action = lifecycleAction(norm.approvalStatus);

    // CANCEL — an approved booking was declined / the guest cancelled.
    if (action === "cancel") {
      const existing = await getBookingByLumaGuestId(norm.lumaGuestId);
      if (!existing) {
        await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: "decline for unknown/never-approved guest" });
        return NextResponse.json({ received: true, ignored: true });
      }
      // Notify the assigned helper (best-effort) before we clear the slot.
      if (existing.booked_by_email) {
        const slot = existing.slot_id ? await getSlotById(existing.slot_id) : null;
        try {
          const msg = cancellationEmail({ guestName: existing.guest_name, slotLabel: slot?.name ?? null });
          await sendEmail({ to: existing.booked_by_email, subject: msg.subject, text: msg.text });
        } catch (err) {
          await logSync({ direction: "luma_in", result: "error", bookingId: existing.id, action: "cancel_email", note: err instanceof Error ? err.message : String(err) });
        }
      }
      const cancelled = (await cancelBooking(existing.id)) ?? existing;
      await archiveBookingPages(cancelled);
      await logSync({ direction: "luma_in", result: "applied", bookingId: cancelled.id, action: "cancelled" });
      return NextResponse.json({ received: true, cancelled: true });
    }

    // IGNORE — pending / waitlist / invited: never reaches the shared DB.
    if (action === "ignore") {
      await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: `not approved (${norm.approvalStatus ?? "none"})` });
      return NextResponse.json({ received: true, ignored: true });
    }

    // CREATE — approved guest becomes/updates a booking.
    const event = await getEventByLumaId(norm.lumaEventId);
    if (!event) {
      await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: `not a registered Office Hours event (${norm.lumaEventId})` });
      return NextResponse.json({ received: true, ignored: true });
    }

    const slot = norm.requestedSlotLabel
      ? await matchSlotForEvent({ eventId: event.id, requestedLabel: norm.requestedSlotLabel })
      : null;

    let booking = await upsertBookingFromLuma({
      lumaGuestId: norm.lumaGuestId,
      eventId: event.id,
      slotId: slot?.id ?? null,
      guestName: norm.guestName,
      guestEmail: norm.guestEmail,
      guestPhone: norm.guestPhone,
      role: norm.role,
      company: norm.company,
      challenge: norm.challenge,
    });

    // Check-in transition → notify the assigned helper by email (Notion notifies separately).
    if (norm.isCheckedIn && booking.status !== "checked_in") {
      const updated = await checkInByLumaGuestId(norm.lumaGuestId);
      if (updated) {
        booking = updated;
        if (booking.booked_by_email) {
          try {
            const msg = checkInEmail({
              guestName: booking.guest_name,
              company: booking.company,
              slotLabel: slot?.name ?? null,
              challenge: booking.challenge,
            });
            await sendEmail({ to: booking.booked_by_email, subject: msg.subject, text: msg.text });
          } catch (err) {
            await logSync({ direction: "luma_in", result: "error", bookingId: booking.id, action: "checkin_email", note: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }

    await pushBookingToWorkspaces(booking, {
      dev: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
      ambassador: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
    });

    await logSync({
      direction: "luma_in",
      result: "applied",
      bookingId: booking.id,
      action: type,
      note: norm.isCheckedIn ? "upserted + checked_in" : "upserted",
    });
    return NextResponse.json({ received: true });
```
(Leave the signature verify, JSON parse, non-guest-event early return, and the outer `catch` exactly as they are.)

- [ ] **Step 3: Verify** `npx tsc --noEmit` exits 0 and `npm run build` succeeds (all routes compile).

- [ ] **Step 4: Commit**
```bash
git add app/api/webhooks/luma/route.ts
git commit -m "feat: Luma lifecycle — approval gate, cancellation, check-in email"
```

---

### Task 8: Notion check-in notification setup guide

**Files:**
- Create: `docs/NOTION_CHECKIN_AUTOMATION.md`

- [ ] **Step 1: Write the guide**

`docs/NOTION_CHECKIN_AUTOMATION.md`:
```markdown
# Notion check-in notification (per Bookings DB)

Set this up once in EACH Bookings database (Notion Dev and Ambassador) so the
assigned helper gets an in-app Notion notification when their guest checks in.
(The hub also sends an email; this is the in-Notion channel.)

1. Open the Bookings database → ••• → **Automations** → **New automation**.
2. **Trigger:** `Status` is edited → set to **Checked In**.
3. **Action:** **Notify** → **Person in "Booked by"** (the native people property).
4. Save.

Why it works: the hub sets Status → Checked In on both pages when the guest
scans in at Luma. Only the workspace where the claimer is a real Person will
actually notify someone; the other side's "Booked by" is empty and no-ops.
No hub code involved.
```

- [ ] **Step 2: Commit**
```bash
git add docs/NOTION_CHECKIN_AUTOMATION.md
git commit -m "docs: Notion check-in notification setup guide"
```

---

### Task 9: Deploy + env + live verification (controller, after review/merge)

Done by the controller after the final review and merge — NOT a subagent step.

- [ ] Enable **"Read user information → with email addresses"** on both Notion integrations (org action).
- [ ] Add Resend env to Vercel production and `.env.local`:
```bash
printf '%s' "<resend_api_key>" | vercel env add RESEND_API_KEY production
printf '%s' "onboarding@resend.dev" | vercel env add EMAIL_FROM production
```
(Also append both to `.env.local`.)
- [ ] `vercel deploy --prod --yes`.
- [ ] Live check: create a test booking, claim it in Notion as `nchen@makenotion.com` (confirm `booked_by_email` gets stored), simulate a check-in webhook, confirm the email arrives + the Notion notification fires. Then simulate a decline and confirm the slot frees, the card archives, and the cancellation email arrives.

---

## Self-Review

**Spec coverage:**
- Approval gate (approved→create, pending→ignore) → Tasks 2, 7 ✅
- Cancellation (cancelled status, free slot, archive Notion, email helper) → Tasks 1, 3, 6, 7 ✅
- Check-in email (helper, once, best-effort) → Tasks 4, 7 ✅
- Notion notify automation → Task 8 ✅
- Helper email capture at claim → Tasks 1, 5 ✅
- Resend provider + env → Task 4, 9 ✅
- Slot-contention tolerance → Task 3 ✅
- Real-RSVP validation prereq → Task 0 ✅

**Placeholder scan:** none — all steps have concrete code/commands.

**Type consistency:** `lifecycleAction` (Task 2) → used in Task 7; `cancelBooking`/`setBookedByEmail`/upsert-tolerance (Task 3) → used in Tasks 5, 7; `checkInEmail`/`cancellationEmail`/`sendEmail` (Task 4) → used in Task 7; `readFirstPersonEmail` (Task 5) uses `PROP.bookedByPerson`; `archiveBookingPages` (Task 6) → used in Task 7; `booked_by_email` column (Task 1) → read/written in Tasks 3, 5, 7. Consistent.

**Scope:** single cohesive phase (Luma lifecycle + notifications). UI approval screen + guest-facing emails + Slack explicitly deferred.
