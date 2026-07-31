# Booking Comms Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send transactional emails (and an `.ics` calendar invite on Assigned) directly from the hub when a booking reaches Assigned / Checked In / No-show, porting the Notion "Office Hours Booking Messenger" agent's behavior into hub code.

**Architecture:** A small `lib/email/*` module (Resend client, pure templates, pure `.ics` builder, an orchestrator with injectable deps) plus an `email_log` table for idempotency. Called best-effort from the three hub transition points (claim, Luma check-in, no-show cron).

**Tech Stack:** Next.js 15 (route handlers + cron), Supabase (service role), Resend, TypeScript, Vitest.

---

## Conventions (read once)

- Path alias `@/*` → project root.
- Service-role client: `import { getAdminClient } from "@/lib/supabase/admin"`.
- Env getters: `lib/env.ts` (lazy `required`/`optional`).
- **Before any `tsc`/`build`: `rm -rf .next` first** (iCloud makes `" 2.ts"` dupes that break tsc).
- Full check before each commit: `rm -rf .next && npx tsc --noEmit && npx vitest run`.
- Run one test file: `npx vitest run tests/<file>`.
- Append to every commit message: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Booking status enum: `unassigned|assigned|checked_in|no_show|cancelled`. Comms `event_kind`s: `assigned|checked_in|no_show`.
- `booking_details` view (`Tables<"booking_details">`) has everything comms needs: `id, guest_name, guest_email, company, role, challenge, guest_phone, status, booked_by_display_name, booked_by_email, location, event_name, event_date, slot_name, slot_starts_at, slot_ends_at`.
- `logSync` signature: `logSync({ direction, result, bookingId?, action?, note? })` from `@/lib/sync/log`. Use `direction: "luma_in"` for comms logs (reused; the `action`/`note` carry meaning), matching the no-show cron's logging.

## File Structure

- `supabase/migrations/0005_email_log.sql` — `email_log` table + unique index.
- `lib/email/resend.ts` — Resend client + `sendEmail(...)` (thin; throws on failure).
- `lib/email/templates.ts` — `CommsFields`/`CommsKind`/`Recipient` types, `guestDetailsLines`, `renderComms` (pure).
- `lib/email/ics.ts` — `buildInvite`, `inviteAttachment`, `fromAddressEmail` (pure).
- `lib/db/email-log.ts` — `hasSentComms`, `recordComms`.
- `lib/db/bookings.ts` — add `getBookingDetailsById`.
- `lib/email/comms.ts` — `sendBookingComms(bookingId, kind, deps?)` orchestrator + `defaultDeps` + `toCommsFields`.
- Wire triggers in the three route handlers.
- `lib/env.ts` + `.env.example` — `env.comms.*`.

---

## Task 1: Resend dependency + env + docs

**Files:** Modify `package.json` (install), `lib/env.ts`, `.env.example`.

- [ ] **Step 1: Install Resend**

Run:
```bash
cd "/Users/nchen/Library/Mobile Documents/com~apple~CloudDocs/Apps Created/office-hours"
npm install resend
```
Expected: `resend` added to dependencies.

- [ ] **Step 2: Add `env.comms` getters** — in `lib/env.ts`, add this group inside the `env` object, after the `app` group:

```ts
  comms: {
    apiKey: () => required("RESEND_API_KEY"),
    from: () => required("COMMS_FROM"),
    replyTo: () => optional("COMMS_REPLY_TO"),
    /** Kill-switch: set COMMS_ENABLED=false to record sends as skipped. */
    enabled: () => optional("COMMS_ENABLED") !== "false",
  },
```

- [ ] **Step 3: Document env** — append to `.env.example`:

```
# Booking comms email (Resend)
RESEND_API_KEY=re_...
COMMS_FROM=Office Hours <hello@yourdomain.com>
COMMS_REPLY_TO=
COMMS_ENABLED=true
```

- [ ] **Step 4: Verify build**

Run: `rm -rf .next && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/env.ts .env.example
git commit -m "feat(comms): add resend dep + env.comms config"
```

---

## Task 2: email_log migration

**Files:** Create `supabase/migrations/0005_email_log.sql`.

- [ ] **Step 1: Write the migration** — `supabase/migrations/0005_email_log.sql`

```sql
-- Idempotency ledger for hub-sent booking comms. One row per
-- (booking, event_kind, recipient_role); the unique index is the hard backstop
-- against webhook retries / cron re-runs double-sending.
create table if not exists email_log (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references bookings(id) on delete cascade,
  event_kind     text not null,   -- 'assigned' | 'checked_in' | 'no_show'
  recipient_role text not null,   -- 'helper' | 'guest'
  recipient_email text not null,
  resend_id      text,            -- null when failed/skipped
  status         text not null,   -- 'sent' | 'failed' | 'skipped'
  created_at     timestamptz not null default now(),
  unique (booking_id, event_kind, recipient_role)
);

alter table email_log enable row level security;  -- service-role only, no policies
```

- [ ] **Step 2: Apply the migration to the remote DB**

Use the Supabase MCP tool `mcp__supabase__apply_migration` (load via ToolSearch `select:mcp__supabase__apply_migration`) with `name: "email_log"` and the SQL above. If unavailable, use `mcp__supabase__execute_sql` with the same SQL.
Expected: success. Verify with `mcp__supabase__list_tables` (or `execute_sql: select count(*) from email_log;` → 0).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_email_log.sql
git commit -m "feat(comms): email_log idempotency table"
```

---

## Task 3: Resend client

**Files:** Create `lib/email/resend.ts`.

- [ ] **Step 1: Implement** — `lib/email/resend.ts`

```ts
import { Resend } from "resend";
import { env } from "../env";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

/**
 * Send one email via Resend. Throws on failure; callers treat sending as
 * best-effort and record the outcome in email_log.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  const resend = new Resend(env.comms.apiKey());
  const replyTo = env.comms.replyTo();
  const { data, error } = await resend.emails.send({
    from: env.comms.from(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(replyTo ? { replyTo } : {}),
    ...(input.attachments?.length
      ? { attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
      : {}),
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? String(error)}`);
  return { id: data?.id ?? "" };
}
```

- [ ] **Step 2: Verify build**

Run: `rm -rf .next && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/email/resend.ts
git commit -m "feat(comms): resend client"
```

---

## Task 4: Templates (pure)

**Files:** Create `lib/email/templates.ts`, `tests/comms-templates.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/comms-templates.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { renderComms, guestDetailsLines, type CommsFields } from "@/lib/email/templates";

function fields(p: Partial<CommsFields> = {}): CommsFields {
  return {
    bookingId: "b1", guestName: "Ada Lovelace", guestEmail: "ada@x.com",
    company: "Analytical", role: "Engineer", challenge: "Scaling", guestPhone: null,
    slotName: "2:00–2:30 PM", slotStartsAt: "2026-08-26T21:00:00Z", slotEndsAt: "2026-08-26T21:30:00Z",
    eventName: "Office Hours (SF)", eventDate: "2026-08-26", location: "San Francisco",
    helperName: "Grace Hopper", helperEmail: "grace@x.com", status: "assigned", ...p,
  };
}

describe("guestDetailsLines", () => {
  it("includes core fields and omits absent optionals", () => {
    const lines = guestDetailsLines(fields({ guestPhone: null, company: null }));
    expect(lines).toContain("Guest Name: Ada Lovelace");
    expect(lines).toContain("Time Slot: 2:00–2:30 PM");
    expect(lines.some((l) => l.startsWith("Company:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Guest phone:"))).toBe(false);
  });
  it("includes optionals when present", () => {
    const lines = guestDetailsLines(fields({ company: "Acme", guestPhone: "+1" }));
    expect(lines).toContain("Company: Acme");
    expect(lines).toContain("Guest phone: +1");
  });
});

describe("renderComms", () => {
  it("assigned→helper uses the confirmation subject/body", () => {
    const r = renderComms("assigned", "helper", fields())!;
    expect(r.subject).toBe("Office Hours booking confirmed — Ada Lovelace");
    expect(r.text).toContain("Hi Grace Hopper,");
    expect(r.text).toContain("Your Office Hours booking has been confirmed.");
    expect(r.text).toContain("A calendar hold has been added");
  });
  it("assigned→guest confirms with the helper name", () => {
    const r = renderComms("assigned", "guest", fields())!;
    expect(r.subject).toContain("Your Office Hours slot is confirmed");
    expect(r.text).toContain("Hi Ada Lovelace,");
    expect(r.text).toContain("confirmed with Grace Hopper");
  });
  it("checked_in→helper", () => {
    const r = renderComms("checked_in", "helper", fields())!;
    expect(r.subject).toBe("Guest checked in: Ada Lovelace");
    expect(r.text).toContain("has been marked as checked in");
  });
  it("no_show→helper", () => {
    const r = renderComms("no_show", "helper", fields())!;
    expect(r.subject).toBe("No-show: Ada Lovelace");
    expect(r.text).toContain("marked as a no-show");
  });
  it("guest gets nothing for checked_in / no_show", () => {
    expect(renderComms("checked_in", "guest", fields())).toBeNull();
    expect(renderComms("no_show", "guest", fields())).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/comms-templates.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/email/templates.ts`

```ts
export type CommsKind = "assigned" | "checked_in" | "no_show";
export type Recipient = "helper" | "guest";

export interface CommsFields {
  bookingId: string;
  guestName: string;
  guestEmail: string | null;
  company: string | null;
  role: string | null;
  challenge: string | null;
  guestPhone: string | null;
  slotName: string | null;
  slotStartsAt: string | null;
  slotEndsAt: string | null;
  eventName: string | null;
  eventDate: string | null;
  location: string | null;
  helperName: string | null;
  helperEmail: string | null;
  status: string;
}

/** The shared "Guest details" block (agent spec), omitting absent optionals. */
export function guestDetailsLines(f: CommsFields): string[] {
  const lines = [
    `Guest Name: ${f.guestName}`,
    `Guest Email: ${f.guestEmail ?? "—"}`,
    `Challenge: ${f.challenge ?? "—"}`,
    `Date: ${f.eventDate ?? "—"}`,
    `Time Slot: ${f.slotName ?? "—"}`,
    `Location: ${f.location ?? "—"}`,
  ];
  if (f.role) lines.push(`Role: ${f.role}`);
  if (f.company) lines.push(`Company: ${f.company}`);
  if (f.guestPhone) lines.push(`Guest phone: ${f.guestPhone}`);
  if (f.eventName) lines.push(`Event: ${f.eventName}`);
  return lines;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(bodyLines: string[]): { html: string; text: string } {
  const text = bodyLines.join("\n");
  const html = bodyLines
    .map((l) => (l === "" ? "<br/>" : `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`))
    .join("");
  return { html, text };
}

/** Render subject + html + text for a kind×recipient, or null if none applies. */
export function renderComms(
  kind: CommsKind,
  role: Recipient,
  f: CommsFields,
): { subject: string; html: string; text: string } | null {
  const details = guestDetailsLines(f);
  if (kind === "assigned" && role === "helper") {
    return {
      subject: `Office Hours booking confirmed — ${f.guestName}`,
      ...wrap([
        `Hi ${f.helperName ?? "there"},`,
        "",
        "Your Office Hours booking has been confirmed.",
        "",
        ...details,
        "",
        "A calendar hold has been added for the scheduled time.",
        "",
        "Thanks,",
      ]),
    };
  }
  if (kind === "assigned" && role === "guest") {
    return {
      subject: `Your Office Hours slot is confirmed${f.eventDate ? ` — ${f.eventDate}` : ""}`,
      ...wrap([
        `Hi ${f.guestName},`,
        "",
        `Your Office Hours slot is confirmed with ${f.helperName ?? "your host"}.`,
        "",
        ...details,
        "",
        "A calendar invite is attached.",
      ]),
    };
  }
  if (kind === "checked_in" && role === "helper") {
    return {
      subject: `Guest checked in: ${f.guestName}`,
      ...wrap([
        `Hi ${f.helperName ?? "there"},`,
        "",
        "Your guest has arrived and has been marked as checked in.",
        "",
        ...details,
      ]),
    };
  }
  if (kind === "no_show" && role === "helper") {
    return {
      subject: `No-show: ${f.guestName}`,
      ...wrap([
        `Hi ${f.helperName ?? "there"},`,
        "",
        "This booking has been marked as a no-show.",
        "",
        ...details,
      ]),
    };
  }
  return null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/comms-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts tests/comms-templates.test.ts
git commit -m "feat(comms): email templates + guest-details block"
```

---

## Task 5: ICS calendar invite (pure)

**Files:** Create `lib/email/ics.ts`, `tests/comms-ics.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/comms-ics.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildInvite, inviteAttachment, fromAddressEmail, type IcsFields } from "@/lib/email/ics";

function icsFields(p: Partial<IcsFields> = {}): IcsFields {
  return {
    bookingId: "b1", guestName: "Ada, Lovelace", guestEmail: "ada@x.com",
    helperEmail: "grace@x.com", helperName: "Grace Hopper",
    slotStartsAt: "2026-08-26T21:00:00Z", slotEndsAt: "2026-08-26T21:30:00Z",
    location: "SF HQ", descriptionText: "Guest Name: Ada\nChallenge: Scaling", ...p,
  };
}
const FROM = "hello@officehours.com";
const STAMP = "2026-07-31T00:00:00Z";

describe("fromAddressEmail", () => {
  it("extracts the address from a display-name form", () => {
    expect(fromAddressEmail("Office Hours <hello@d.com>")).toBe("hello@d.com");
    expect(fromAddressEmail("hello@d.com")).toBe("hello@d.com");
  });
});

describe("buildInvite", () => {
  it("returns a VCALENDAR with a stable UID, both attendees, and CRLF lines", () => {
    const ics = buildInvite(icsFields(), FROM, STAMP)!;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:booking-b1@officehours");
    expect(ics).toContain("DTSTART:20260826T210000Z");
    expect(ics).toContain("DTEND:20260826T213000Z");
    expect(ics).toContain("mailto:grace@x.com");
    expect(ics).toContain("mailto:ada@x.com");
    expect(ics).toContain("\r\n");
    // commas in TEXT values are escaped
    expect(ics).toContain("SUMMARY:Office Hours — Ada\\, Lovelace");
  });
  it("defaults DTEND to start+30min when no end time", () => {
    const ics = buildInvite(icsFields({ slotEndsAt: null }), FROM, STAMP)!;
    expect(ics).toContain("DTSTART:20260826T210000Z");
    expect(ics).toContain("DTEND:20260826T213000Z");
  });
  it("returns null when the start time is missing or unparseable", () => {
    expect(buildInvite(icsFields({ slotStartsAt: null }), FROM, STAMP)).toBeNull();
    expect(buildInvite(icsFields({ slotStartsAt: "not-a-date" }), FROM, STAMP)).toBeNull();
  });
});

describe("inviteAttachment", () => {
  it("wraps ics text as an invite.ics Buffer attachment", () => {
    const a = inviteAttachment("BEGIN:VCALENDAR");
    expect(a.filename).toBe("invite.ics");
    expect(a.content.toString("utf8")).toBe("BEGIN:VCALENDAR");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/comms-ics.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/email/ics.ts`

```ts
export interface IcsFields {
  bookingId: string;
  guestName: string;
  guestEmail: string | null;
  helperEmail: string | null;
  helperName: string | null;
  slotStartsAt: string | null;
  slotEndsAt: string | null;
  location: string | null;
  descriptionText: string;
}

/** Extract the bare email from a "Name <email>" (or plain email) string. */
export function fromAddressEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// RFC 5545 TEXT escaping.
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Build a METHOD:REQUEST VEVENT to hold the slot. Returns null if the start
 * time is missing/unparseable (caller then skips the invite). DTEND defaults to
 * start + 30 min when no parseable end time (agent default).
 */
export function buildInvite(f: IcsFields, fromEmail: string, stampISO: string): string | null {
  if (!f.slotStartsAt) return null;
  const start = new Date(f.slotStartsAt);
  if (Number.isNaN(start.getTime())) return null;
  const endDate =
    f.slotEndsAt && !Number.isNaN(new Date(f.slotEndsAt).getTime())
      ? new Date(f.slotEndsAt)
      : new Date(start.getTime() + 30 * 60_000);

  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Office Hours Hub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:booking-${f.bookingId}@officehours`,
    "SEQUENCE:0",
    `DTSTAMP:${stamp(stampISO)}`,
    `DTSTART:${stamp(start.toISOString())}`,
    `DTEND:${stamp(endDate.toISOString())}`,
    `SUMMARY:${esc(`Office Hours — ${f.guestName}`)}`,
    f.location ? `LOCATION:${esc(f.location)}` : null,
    `DESCRIPTION:${esc(f.descriptionText)}`,
    `ORGANIZER;CN=Office Hours:mailto:${fromEmail}`,
    f.helperEmail
      ? `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=${esc(f.helperName ?? "Helper")}:mailto:${f.helperEmail}`
      : null,
    f.guestEmail
      ? `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=${esc(f.guestName)}:mailto:${f.guestEmail}`
      : null,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter((l): l is string => l !== null).join("\r\n");
}

export function inviteAttachment(ics: string): { filename: string; content: Buffer } {
  return { filename: "invite.ics", content: Buffer.from(ics, "utf8") };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/comms-ics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/ics.ts tests/comms-ics.test.ts
git commit -m "feat(comms): ics calendar invite builder"
```

---

## Task 6: email_log data access + booking details fetch

**Files:** Create `lib/db/email-log.ts`; modify `lib/db/bookings.ts`.

- [ ] **Step 1: Implement `lib/db/email-log.ts`**

```ts
import { getAdminClient } from "../supabase/admin";

export type CommsStatus = "sent" | "failed" | "skipped";

// email_log isn't in the generated Database types yet; access it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getAdminClient() as any).from("email_log");
}

/** True if a comms row already exists for this (booking, kind, role). */
export async function hasSentComms(
  bookingId: string,
  eventKind: string,
  role: string,
): Promise<boolean> {
  const { data, error } = await table()
    .select("id")
    .eq("booking_id", bookingId)
    .eq("event_kind", eventKind)
    .eq("recipient_role", role)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return !!data;
}

/** Record an attempt. Swallows unique-violation (23505) as already-recorded. */
export async function recordComms(row: {
  bookingId: string;
  eventKind: string;
  role: string;
  email: string;
  resendId: string | null;
  status: CommsStatus;
}): Promise<void> {
  const { error } = await table().insert({
    booking_id: row.bookingId,
    event_kind: row.eventKind,
    recipient_role: row.role,
    recipient_email: row.email,
    resend_id: row.resendId,
    status: row.status,
  });
  if (error && error.code !== "23505") throw error;
}
```

- [ ] **Step 2: Add `getBookingDetailsById` to `lib/db/bookings.ts`**

At the top, ensure `BookingDetails` is imported from the sync types. If the existing import line is `import { pickSyncedFields, type BookedByType, type Booking } from "../sync/types";`, change it to also import `BookingDetails`:

```ts
import { pickSyncedFields, type BookedByType, type Booking, type BookingDetails } from "../sync/types";
```

Then add this function (place it near `getBookingById`):

```ts
/** Fetch the enriched booking_details row (joins event + slot) by booking id. */
export async function getBookingDetailsById(id: string): Promise<BookingDetails | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("booking_details")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Verify build**

Run: `rm -rf .next && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/db/email-log.ts lib/db/bookings.ts
git commit -m "feat(comms): email_log access + getBookingDetailsById"
```

---

## Task 7: Orchestrator (`sendBookingComms`) with injectable deps

**Files:** Create `lib/email/comms.ts`, `tests/comms-send.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/comms-send.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { sendBookingComms, type CommsDeps } from "@/lib/email/comms";
import type { CommsFields } from "@/lib/email/templates";

function fields(p: Partial<CommsFields> = {}): CommsFields {
  return {
    bookingId: "b1", guestName: "Ada", guestEmail: "ada@x.com", company: null, role: null,
    challenge: null, guestPhone: null, slotName: "2:00 PM", slotStartsAt: "2026-08-26T21:00:00Z",
    slotEndsAt: "2026-08-26T21:30:00Z", eventName: "OH", eventDate: "2026-08-26", location: "SF",
    helperName: "Grace", helperEmail: "grace@x.com", status: "assigned", ...p,
  };
}

function makeDeps(over: Partial<CommsDeps> = {}, f: CommsFields | null = fields()) {
  const sent: Array<{ to: string; hasAttachment: boolean }> = [];
  const recorded: Array<{ role: string; status: string }> = [];
  const deps: CommsDeps = {
    getFields: async () => f,
    hasSent: async () => false,
    record: async (r) => { recorded.push({ role: r.role, status: r.status }); },
    send: async (i) => { sent.push({ to: i.to, hasAttachment: !!i.attachments?.length }); return { id: "re_1" }; },
    enabled: () => true,
    from: () => "Office Hours <hello@oh.com>",
    now: () => "2026-07-31T00:00:00Z",
    ...over,
  };
  return { deps, sent, recorded };
}

describe("sendBookingComms", () => {
  it("assigned → emails helper + guest, both with the ics attachment", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "assigned", deps);
    expect(sent.map((s) => s.to).sort()).toEqual(["ada@x.com", "grace@x.com"]);
    expect(sent.every((s) => s.hasAttachment)).toBe(true);
  });

  it("assigned with no helper email → guest only", async () => {
    const { deps, sent } = makeDeps({}, fields({ helperEmail: null }));
    await sendBookingComms("b1", "assigned", deps);
    expect(sent.map((s) => s.to)).toEqual(["ada@x.com"]);
  });

  it("checked_in → helper only, no attachment", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "checked_in", deps);
    expect(sent.map((s) => s.to)).toEqual(["grace@x.com"]);
    expect(sent[0].hasAttachment).toBe(false);
  });

  it("no_show → helper only", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "no_show", deps);
    expect(sent.map((s) => s.to)).toEqual(["grace@x.com"]);
  });

  it("idempotent: already-sent recipients are skipped", async () => {
    const { deps, sent } = makeDeps({ hasSent: async () => true });
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
  });

  it("disabled: records skipped and does not send", async () => {
    const { deps, sent, recorded } = makeDeps({ enabled: () => false });
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
    expect(recorded.every((r) => r.status === "skipped")).toBe(true);
  });

  it("send failure is recorded and does not throw", async () => {
    const { deps, recorded } = makeDeps({ send: async () => { throw new Error("boom"); } });
    await expect(sendBookingComms("b1", "assigned", deps)).resolves.toBeUndefined();
    expect(recorded.some((r) => r.status === "failed")).toBe(true);
  });

  it("missing booking → no-op", async () => {
    const { deps, sent } = makeDeps({}, null);
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/comms-send.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/email/comms.ts`

```ts
import { getBookingDetailsById } from "../db/bookings";
import { hasSentComms, recordComms, type CommsStatus } from "../db/email-log";
import { sendEmail, type EmailAttachment } from "./resend";
import { buildInvite, inviteAttachment, fromAddressEmail } from "./ics";
import { renderComms, guestDetailsLines, type CommsFields, type CommsKind, type Recipient } from "./templates";
import { env } from "../env";
import { logSync } from "../sync/log";
import type { BookingDetails } from "../sync/types";

/** Injectable side-effects so the orchestrator is unit-testable. */
export interface CommsDeps {
  getFields: (bookingId: string) => Promise<CommsFields | null>;
  hasSent: (bookingId: string, kind: string, role: string) => Promise<boolean>;
  record: (row: { bookingId: string; eventKind: string; role: string; email: string; resendId: string | null; status: CommsStatus }) => Promise<void>;
  send: (input: { to: string; subject: string; html: string; text: string; attachments?: EmailAttachment[] }) => Promise<{ id: string }>;
  enabled: () => boolean;
  from: () => string;
  now: () => string;
}

/** Map an enriched booking_details row to the template's CommsFields. */
export function toCommsFields(d: BookingDetails): CommsFields {
  return {
    bookingId: d.id as string,
    guestName: (d.guest_name as string) ?? "",
    guestEmail: (d.guest_email as string) ?? null,
    company: (d.company as string) ?? null,
    role: (d.role as string) ?? null,
    challenge: (d.challenge as string) ?? null,
    guestPhone: (d.guest_phone as string) ?? null,
    slotName: (d.slot_name as string) ?? null,
    slotStartsAt: (d.slot_starts_at as string) ?? null,
    slotEndsAt: (d.slot_ends_at as string) ?? null,
    eventName: (d.event_name as string) ?? null,
    eventDate: (d.event_date as string) ?? null,
    location: (d.location as string) ?? null,
    helperName: (d.booked_by_display_name as string) ?? null,
    helperEmail: (d.booked_by_email as string) ?? null,
    status: d.status as string,
  };
}

const defaultDeps: CommsDeps = {
  getFields: async (id) => {
    const d = await getBookingDetailsById(id);
    return d ? toCommsFields(d) : null;
  },
  hasSent: hasSentComms,
  record: recordComms,
  send: sendEmail,
  enabled: () => env.comms.enabled(),
  from: () => env.comms.from(),
  now: () => new Date().toISOString(),
};

const RECIPIENTS: Record<CommsKind, Recipient[]> = {
  assigned: ["helper", "guest"],
  checked_in: ["helper"],
  no_show: ["helper"],
};

/**
 * Send the comms for a booking reaching `kind`. Best-effort: never throws.
 * Idempotent via email_log. On `assigned`, attaches an .ics invite (both
 * recipients are attendees) unless the slot time can't be parsed.
 */
export async function sendBookingComms(
  bookingId: string,
  kind: CommsKind,
  deps: CommsDeps = defaultDeps,
): Promise<void> {
  try {
    const f = await deps.getFields(bookingId);
    if (!f) return;

    // Build the invite once (assigned only); skip + log if the time is unparseable.
    let attachment: EmailAttachment | undefined;
    if (kind === "assigned") {
      const ics = buildInvite(
        {
          bookingId: f.bookingId,
          guestName: f.guestName,
          guestEmail: f.guestEmail,
          helperEmail: f.helperEmail,
          helperName: f.helperName,
          slotStartsAt: f.slotStartsAt,
          slotEndsAt: f.slotEndsAt,
          location: f.location,
          descriptionText: guestDetailsLines(f).join("\n"),
        },
        fromAddressEmail(deps.from()),
        deps.now(),
      );
      if (ics) attachment = inviteAttachment(ics);
      else await logSync({ direction: "luma_in", result: "applied", bookingId, action: "comms_ics_skipped", note: "unparseable slot time" });
    }

    for (const role of RECIPIENTS[kind]) {
      const to = role === "helper" ? f.helperEmail : f.guestEmail;
      if (!to) continue; // no address for this recipient → skip silently
      const rendered = renderComms(kind, role, f);
      if (!rendered) continue;
      if (await deps.hasSent(bookingId, kind, role)) continue;

      if (!deps.enabled()) {
        await deps.record({ bookingId, eventKind: kind, role, email: to, resendId: null, status: "skipped" });
        continue;
      }
      try {
        const { id } = await deps.send({
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          attachments: kind === "assigned" && attachment ? [attachment] : undefined,
        });
        await deps.record({ bookingId, eventKind: kind, role, email: to, resendId: id, status: "sent" });
      } catch (err) {
        await deps.record({ bookingId, eventKind: kind, role, email: to, resendId: null, status: "failed" });
        await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}_${role}`, note: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    // Never let comms break the booking sync.
    await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}`, note: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/comms-send.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/email/comms.ts tests/comms-send.test.ts
git commit -m "feat(comms): sendBookingComms orchestrator (idempotent, best-effort)"
```

---

## Task 8: Wire the three triggers

**Files:** Modify `app/api/webhooks/notion/[workspace]/route.ts`, `app/api/webhooks/luma/route.ts`, `app/api/cron/no-show/route.ts`.

- [ ] **Step 1: Claim → assigned** — in `app/api/webhooks/notion/[workspace]/route.ts`, add the import near the other `@/lib` imports:

```ts
import { sendBookingComms } from "@/lib/email/comms";
```

Then in the CLAIM branch, right after `await pushBookingToWorkspaces(claim.booking);` and before the `await logSync({ ... action: "claimed" });` line, add:

```ts
      await sendBookingComms(claim.booking.id, "assigned");
```

- [ ] **Step 2: Check-in → checked_in** — in `app/api/webhooks/luma/route.ts`, add the import near the other `@/lib` imports:

```ts
import { sendBookingComms } from "@/lib/email/comms";
```

Then in the check-in block, change:

```ts
    if (norm.isCheckedIn && booking.status !== "checked_in") {
      const updated = await checkInByLumaGuestId(norm.lumaGuestId);
      if (updated) booking = updated;
    }
```

to:

```ts
    if (norm.isCheckedIn && booking.status !== "checked_in") {
      const updated = await checkInByLumaGuestId(norm.lumaGuestId);
      if (updated) {
        booking = updated;
        await sendBookingComms(updated.id, "checked_in");
      }
    }
```

- [ ] **Step 3: No-show → no_show** — in `app/api/cron/no-show/route.ts`, add the import near the other `@/lib` imports:

```ts
import { sendBookingComms } from "@/lib/email/comms";
```

Then change the sweep loop:

```ts
  for (const booking of swept) {
    await pushBookingToWorkspaces(booking);
    await logSync({ direction: "luma_in", result: "applied", bookingId: booking.id, action: "no_show" });
  }
```

to add the comms call:

```ts
  for (const booking of swept) {
    await pushBookingToWorkspaces(booking);
    await sendBookingComms(booking.id, "no_show");
    await logSync({ direction: "luma_in", result: "applied", bookingId: booking.id, action: "no_show" });
  }
```

- [ ] **Step 4: Full check**

Run: `rm -rf .next && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (existing 81 + new comms tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/webhooks/notion/[workspace]/route.ts" app/api/webhooks/luma/route.ts app/api/cron/no-show/route.ts
git commit -m "feat(comms): fire sendBookingComms on claim / check-in / no-show"
```

---

## Task 9: Build + live integration send

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `rm -rf .next && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green; build succeeds.

- [ ] **Step 2: Live send gate (requires Resend set up)**

This step needs `RESEND_API_KEY` + `COMMS_FROM` in `.env.local` and a verified domain (Setup Step 0). If not yet configured, STOP here and report that the code is complete and this step is pending domain/Resend setup.

If configured, run a one-off send to the user's inbox via a throwaway script (do NOT commit it):
```bash
npx tsx --env-file=.env.local -e "import('./lib/email/comms.ts').then(async m => { await m.sendBookingComms('<a-real-booking-id>', 'assigned'); console.log('sent'); })"
```
Then confirm: the email arrived, the `.ics` shows an "add to calendar"/invite affordance, and `email_log` has rows (`select * from email_log`). Re-run and confirm NO duplicate send (idempotent) and no new `email_log` rows.

- [ ] **Step 3: Report**

Report the final tsc/test/build results and the integration outcome (or that Step 2 is pending Resend/domain setup).

---

## Post-implementation (outside this plan)

- Setup Step 0: register a domain, verify in Resend, set `RESEND_API_KEY` + `COMMS_FROM` in `.env.local` + Vercel, deploy.
- (Standing) rotate all previously-shared secrets.

## Self-review notes

- **Spec coverage:** delivery/Resend → T1,T3; email_log idempotency → T2,T6,T7; templates + guest-details block + exact subjects → T4; `.ics` invite (UID/attendees/30-min default/skip-on-unparseable) → T5,T7; recipient reconciliation (helper+guest on assigned, helper-only otherwise; skip helper w/o email) → T7; trigger points → T8; edge cases (disabled, failures non-blocking, missing fields) → T7; testing → T4,T5,T7; setup steps → Post-implementation. All covered.
- **Type consistency:** `CommsFields`/`CommsKind`/`Recipient` defined in T4 and used unchanged in T5(via IcsFields mapping)/T7; `CommsDeps` defined + consumed in T7; `getBookingDetailsById`/`BookingDetails` defined in T6 and used in T7; `hasSentComms`/`recordComms`/`CommsStatus` defined in T6 and used in T7; `sendEmail`/`EmailAttachment` defined in T3 and used in T7.
- **Known adjustment point:** Resend SDK attachment/`replyTo` field names — T3 uses `replyTo` and `attachments:[{filename,content:Buffer}]` (current `resend` v3+); if the installed version differs, adjust field names minimally to satisfy tsc.
```
