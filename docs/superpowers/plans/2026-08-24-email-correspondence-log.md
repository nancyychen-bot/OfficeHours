# Email Correspondence Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/settings/emails/log` Hub page listing every sent email, grouped by kind+event+day (multi-recipient groups collapse into an expandable "mass" entry), filterable by kind/event, paginated, with click-to-read content pulled exact-as-sent from Resend.

**Architecture:** A SQL view aggregates `email_log` (grouping + pagination happen in the DB). A server page renders filters + the grouped list + pagination; a client component handles expand (fetch a group's recipients) and the content modal (fetch one email from Resend). Two hub-gated API routes back those. Pure helpers (`emailKindLabel`, `getSentEmail`) are unit-tested.

**Tech Stack:** Next.js App Router (server + client components, Next 15 `await searchParams`), TypeScript, Vitest, Supabase (view), Resend REST.

**Reference spec:** `docs/superpowers/specs/2026-08-24-email-correspondence-log-design.md`

---

## File Structure

- **Create** `supabase/migrations/0046_email_correspondence_view.sql` — the grouping view.
- **Create** `lib/email/kind-label.ts` — pure `emailKindLabel(kind)` (client-safe, no server imports).
- **Modify** `lib/email/resend.ts` — add `getSentEmail(resendId)` (raw fetch).
- **Create** `lib/db/email-correspondence.ts` — `listEmailGroups`, `listGroupRecipients`, `listEmailFilterOptions`.
- **Create** `app/api/hub/emails/recipients/route.ts` + `app/api/hub/emails/content/route.ts` — hub-gated.
- **Create** `app/settings/emails/log/page.tsx` — server page (filters + list + pagination).
- **Create** `components/hub/EmailLog.tsx` — client component (expand + content modal).
- **Modify** `components/hub/SettingsNav.tsx` — add the "Sent log" tab + fix active match.
- **Create** `tests/email-kind-label.test.ts`, `tests/resend-get.test.ts`.

---

## Task 1: The grouping view (migration)

**Files:**
- Create: `supabase/migrations/0046_email_correspondence_view.sql`

- [ ] **Step 1: Create the migration**

```sql
-- ============================================================================
-- 0046 — email_correspondence: sent-email log grouped by kind + event + day
-- ============================================================================
create or replace view email_correspondence as
select
  el.event_kind,
  b.event_id,
  e.name       as event_name,
  e.event_date as event_date,
  (el.created_at at time zone 'UTC')::date as day,
  count(*)                                     as recipient_count,
  count(*) filter (where el.status = 'sent')   as sent_count,
  count(*) filter (where el.status <> 'sent')  as unsent_count,
  min(el.created_at) as first_at,
  max(el.created_at) as last_at
from email_log el
join bookings b on b.id = el.booking_id
left join events e on e.id = b.event_id
group by el.event_kind, b.event_id, e.name, e.event_date, day;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0046_email_correspondence_view.sql
git commit -m "feat(email-log): email_correspondence grouping view"
```

(The view is applied to Supabase at rollout — not during implementation. Code in later tasks casts the `.from()` so it typechecks without the view existing yet.)

---

## Task 2: Pure helpers — `emailKindLabel` + `getSentEmail`

**Files:**
- Create: `lib/email/kind-label.ts`
- Modify: `lib/email/resend.ts`
- Test: `tests/email-kind-label.test.ts`, `tests/resend-get.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/email-kind-label.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { emailKindLabel } from "../lib/email/kind-label";

describe("emailKindLabel", () => {
  it("humanizes a snake_case kind", () => {
    expect(emailKindLabel("prep_reminder")).toBe("Prep reminder");
    expect(emailKindLabel("prep_reminder_day_before")).toBe("Prep reminder day before");
    expect(emailKindLabel("guest_cancelled")).toBe("Guest cancelled");
  });
  it("handles empty/unknown gracefully", () => {
    expect(emailKindLabel("")).toBe("");
    expect(emailKindLabel("assigned")).toBe("Assigned");
  });
});
```

Create `tests/resend-get.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getSentEmail } from "../lib/email/resend";

beforeEach(() => { process.env.RESEND_API_KEY = "re_test"; });
afterEach(() => { delete process.env.RESEND_API_KEY; vi.restoreAllMocks(); });

function stub(status: number, body: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);
}

describe("getSentEmail", () => {
  it("returns subject/html/text/to on 200", async () => {
    stub(200, { id: "e1", subject: "Hi", html: "<p>hi</p>", text: "hi", to: ["a@x.com"] });
    const r = await getSentEmail("e1");
    expect(r).toEqual({ subject: "Hi", html: "<p>hi</p>", text: "hi", to: ["a@x.com"] });
  });
  it("returns null on 404 (aged out)", async () => {
    stub(404, { name: "not_found" });
    expect(await getSentEmail("gone")).toBeNull();
  });
  it("returns null for an empty id (no fetch)", async () => {
    let called = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = vi.fn(async () => { called = true; return {} as Response; });
    expect(await getSentEmail("")).toBeNull();
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/email-kind-label.test.ts tests/resend-get.test.ts`
Expected: FAIL — modules/exports not found.

- [ ] **Step 3: Implement `emailKindLabel`**

Create `lib/email/kind-label.ts`:
```ts
/** Human-friendly label for an email_log event_kind, e.g. "prep_reminder" → "Prep reminder". Pure. */
export function emailKindLabel(kind: string): string {
  if (!kind) return "";
  const spaced = kind.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
```

- [ ] **Step 4: Implement `getSentEmail`**

In `lib/email/resend.ts`, add (below `sendEmail`):
```ts
/**
 * Fetch a previously-sent email's exact content from Resend by id, or null
 * (empty id / aged-out 404 / error). Best-effort — used by the Hub email log.
 */
export async function getSentEmail(
  resendId: string,
): Promise<{ subject: string; html: string; text: string; to: string[] } | null> {
  if (!resendId) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/${resendId}`, {
      headers: { Authorization: `Bearer ${env.comms.apiKey()}` },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { subject?: string; html?: string; text?: string; to?: string[] | string };
    return {
      subject: d.subject ?? "",
      html: d.html ?? "",
      text: d.text ?? "",
      to: Array.isArray(d.to) ? d.to : d.to ? [d.to] : [],
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- tests/email-kind-label.test.ts tests/resend-get.test.ts && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add lib/email/kind-label.ts lib/email/resend.ts tests/email-kind-label.test.ts tests/resend-get.test.ts
git commit -m "feat(email-log): emailKindLabel + getSentEmail (exact-as-sent fetch)"
```

---

## Task 3: Query layer — `lib/db/email-correspondence.ts`

**Files:**
- Create: `lib/db/email-correspondence.ts`

No unit test (DB layer, matching the `lib/db/*` convention — verified by typecheck + the rollout query).

- [ ] **Step 1: Create the query module**

```ts
import { getAdminClient } from "../supabase/admin";

export interface EmailGroup {
  eventKind: string;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  day: string;
  recipientCount: number;
  sentCount: number;
  unsentCount: number;
  lastAt: string;
}

export interface EmailRecipient {
  recipientEmail: string;
  guestName: string | null;
  status: string;
  resendId: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

/** One page of grouped sends (kind+event+day), newest first, with optional filters. */
export async function listEmailGroups(opts: {
  kind?: string | null;
  eventId?: string | null;
  page: number;
}): Promise<{ groups: EmailGroup[]; hasMore: boolean }> {
  const page = Math.max(0, opts.page);
  const from = page * PAGE_SIZE;
  // The view isn't in the generated Database types until regenerated post-migration,
  // so cast the client for this one query. Runtime-safe: PostgREST treats it as a table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (getAdminClient() as any)
    .from("email_correspondence")
    .select("event_kind, event_id, event_name, event_date, day, recipient_count, sent_count, unsent_count, last_at")
    .order("last_at", { ascending: false })
    .range(from, from + PAGE_SIZE); // fetch one extra to compute hasMore
  if (opts.kind) q = q.eq("event_kind", opts.kind);
  if (opts.eventId) q = q.eq("event_id", opts.eventId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const hasMore = rows.length > PAGE_SIZE;
  const groups = rows.slice(0, PAGE_SIZE).map((r) => ({
    eventKind: r.event_kind as string,
    eventId: (r.event_id as string) ?? null,
    eventName: (r.event_name as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    day: r.day as string,
    recipientCount: Number(r.recipient_count ?? 0),
    sentCount: Number(r.sent_count ?? 0),
    unsentCount: Number(r.unsent_count ?? 0),
    lastAt: r.last_at as string,
  }));
  return { groups, hasMore };
}

/** The recipients of one group (kind+event+day), newest first. */
export async function listGroupRecipients(opts: {
  kind: string;
  eventId: string | null;
  day: string;
}): Promise<EmailRecipient[]> {
  const supabase = getAdminClient();
  // Day is a UTC calendar day → [day 00:00, next day 00:00).
  const start = `${opts.day}T00:00:00Z`;
  const end = `${opts.day}T23:59:59.999Z`;
  let q = supabase
    .from("email_log")
    .select("recipient_email, status, resend_id, created_at, bookings!inner(guest_name, event_id)")
    .eq("event_kind", opts.kind)
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false });
  if (opts.eventId) q = q.eq("bookings.event_id", opts.eventId);
  const { data, error } = await q;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    recipientEmail: r.recipient_email,
    guestName: r.bookings?.guest_name ?? null,
    status: r.status,
    resendId: r.resend_id ?? null,
    createdAt: r.created_at,
  }));
}

/** Distinct kinds + events present in the log, for the filter dropdowns. */
export async function listEmailFilterOptions(): Promise<{
  kinds: string[];
  events: Array<{ id: string; name: string | null }>;
}> {
  const supabase = getAdminClient();
  const { data: kindRows } = await supabase.from("email_log").select("event_kind");
  const kinds = [...new Set((kindRows ?? []).map((r) => r.event_kind))].sort();
  const { data: evRows } = await supabase.from("events").select("id, name").order("event_date", { ascending: false });
  const events = (evRows ?? []).map((e) => ({ id: e.id, name: e.name }));
  return { kinds, events };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean. (Confirm `getAdminClient` import path is `../supabase/admin`, matching `lib/db/slack.ts`.)

- [ ] **Step 3: Commit**

```bash
git add lib/db/email-correspondence.ts
git commit -m "feat(email-log): grouped/paginated query layer"
```

---

## Task 4: Hub API routes

**Files:**
- Create: `app/api/hub/emails/recipients/route.ts`
- Create: `app/api/hub/emails/content/route.ts`

- [ ] **Step 1: Create the recipients route** (auth mirrors `app/api/hub/slack/route.ts`)

`app/api/hub/emails/recipients/route.ts`:
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { listGroupRecipients } from "@/lib/db/email-correspondence";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const day = url.searchParams.get("day");
  if (!kind || !day) return NextResponse.json({ error: "missing kind/day" }, { status: 400 });
  const recipients = await listGroupRecipients({ kind, eventId: url.searchParams.get("event"), day });
  return NextResponse.json({ recipients });
}
```

- [ ] **Step 2: Create the content route**

`app/api/hub/emails/content/route.ts`:
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getSentEmail } from "@/lib/email/resend";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const resendId = new URL(req.url).searchParams.get("resendId") ?? "";
  const email = await getSentEmail(resendId);
  return NextResponse.json({ email });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: clean. (Confirm `@/lib/auth/session` exports `isValidSession` + `SESSION_COOKIE`, matching `app/api/hub/slack/route.ts`.)

- [ ] **Step 4: Commit**

```bash
git add app/api/hub/emails/recipients/route.ts app/api/hub/emails/content/route.ts
git commit -m "feat(email-log): hub API routes for recipients + content"
```

---

## Task 5: Page + client component + nav

**Files:**
- Create: `app/settings/emails/log/page.tsx`
- Create: `components/hub/EmailLog.tsx`
- Modify: `components/hub/SettingsNav.tsx`

- [ ] **Step 1: Add the nav tab + fix active match**

In `components/hub/SettingsNav.tsx`, add to the `SUB` array (after the Emails entry):
```ts
  { href: "/settings/emails/log", label: "Sent log" },
```
Change the active check so Emails isn't highlighted on the log page:
```ts
        const active = s.href === "/settings/emails"
          ? pathname === "/settings/emails"
          : pathname.startsWith(s.href);
```

- [ ] **Step 2: Create the client component**

`components/hub/EmailLog.tsx`:
```tsx
"use client";

import { useState } from "react";
import { emailKindLabel } from "@/lib/email/kind-label";

export interface EmailGroupView {
  eventKind: string;
  eventId: string | null;
  eventName: string | null;
  day: string;
  recipientCount: number;
  sentCount: number;
  unsentCount: number;
  lastAt: string;
}
interface Recipient { recipientEmail: string; guestName: string | null; status: string; resendId: string | null; createdAt: string; }
interface Content { subject: string; html: string; text: string; to: string[] }

export function EmailLog({ groups }: { groups: EmailGroupView[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Record<string, Recipient[]>>({});
  const [content, setContent] = useState<Content | null | "loading" | "unavailable">(null);

  const keyOf = (g: EmailGroupView) => `${g.eventKind}|${g.eventId ?? ""}|${g.day}`;

  async function toggle(g: EmailGroupView) {
    const k = keyOf(g);
    if (openKey === k) { setOpenKey(null); return; }
    setOpenKey(k);
    if (!recipients[k]) {
      const params = new URLSearchParams({ kind: g.eventKind, day: g.day });
      if (g.eventId) params.set("event", g.eventId);
      const res = await fetch(`/api/hub/emails/recipients?${params}`);
      const json = await res.json();
      setRecipients((prev) => ({ ...prev, [k]: json.recipients ?? [] }));
    }
  }

  async function view(resendId: string | null) {
    if (!resendId) { setContent("unavailable"); return; }
    setContent("loading");
    const res = await fetch(`/api/hub/emails/content?resendId=${encodeURIComponent(resendId)}`);
    const json = await res.json();
    setContent(json.email ?? "unavailable");
  }

  return (
    <div className="divide-y divide-line rounded border border-line">
      {groups.length === 0 && <p className="p-4 text-sm text-neutral-500">No emails found.</p>}
      {groups.map((g) => {
        const k = keyOf(g);
        const mass = g.recipientCount > 1;
        const rs = recipients[k] ?? [];
        return (
          <div key={k}>
            <button
              onClick={() => (mass ? toggle(g) : view(rs[0]?.resendId ?? null) || toggle(g))}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-neutral-50"
            >
              <span>
                <span className="font-medium">{emailKindLabel(g.eventKind)}</span>
                {g.eventName ? <span className="text-neutral-500"> · {g.eventName}</span> : null}
                <span className="text-neutral-400"> · {g.day}</span>
              </span>
              <span className="shrink-0 text-neutral-500">
                {mass ? `mass · ${g.recipientCount} recipients` : "1 recipient"}
                {g.unsentCount > 0 ? ` · ${g.unsentCount} unsent` : ""}
              </span>
            </button>
            {openKey === k && (
              <ul className="border-t border-line bg-neutral-50 px-4 py-2 text-sm">
                {rs.map((r) => (
                  <li key={r.recipientEmail} className="flex items-center justify-between gap-3 py-1">
                    <button className="text-left underline decoration-dotted hover:text-neutral-900" onClick={() => view(r.resendId)}>
                      {r.guestName ? `${r.guestName} ` : ""}&lt;{r.recipientEmail}&gt;
                    </button>
                    <span className="text-neutral-400">{r.status}</span>
                  </li>
                ))}
                {rs.length === 0 && <li className="py-1 text-neutral-400">Loading…</li>}
              </ul>
            )}
          </div>
        );
      })}

      {content !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setContent(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {content === "loading" && <p className="text-sm text-neutral-500">Loading…</p>}
            {content === "unavailable" && <p className="text-sm text-neutral-500">Content no longer available (not sent, or aged out of Resend).</p>}
            {content && content !== "loading" && content !== "unavailable" && (
              <>
                <p className="mb-1 text-xs text-neutral-500">To: {content.to.join(", ")}</p>
                <h2 className="mb-3 text-base font-semibold">{content.subject}</h2>
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: content.html || `<pre>${content.text}</pre>` }} />
              </>
            )}
            <button className="mt-4 text-sm text-neutral-500 underline" onClick={() => setContent(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: for a single-recipient group the row needs the recipient's `resendId`, which lives in the recipients fetch — so a single row also calls `toggle(g)` to load it, then `view`. Simplify: the single-row click calls `toggle(g)` (loads recipients) and, once loaded, the one recipient is shown in the expand list to click. Keep the `onClick` as `() => toggle(g)` for BOTH mass and single (single just expands to its one recipient). Replace the button `onClick` with:
```tsx
              onClick={() => toggle(g)}
```
(Removes the brittle inline `view(...) || toggle(...)`.) A single-recipient group then expands to its one clickable recipient — consistent behavior.

- [ ] **Step 3: Create the page**

`app/settings/emails/log/page.tsx`:
```tsx
import { HubNav } from "@/components/hub/HubNav";
import { SettingsNav } from "@/components/hub/SettingsNav";
import { EmailLog } from "@/components/hub/EmailLog";
import { emailKindLabel } from "@/lib/email/kind-label";
import { listEmailGroups, listEmailFilterOptions } from "@/lib/db/email-correspondence";

export const dynamic = "force-dynamic";

export default async function SentLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; kind?: string; event?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? "0") || 0);
  const kind = sp.kind || null;
  const eventId = sp.event || null;

  const [{ groups, hasMore }, opts] = await Promise.all([
    listEmailGroups({ kind, eventId, page }),
    listEmailFilterOptions(),
  ]);

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (eventId) p.set("event", eventId);
    p.set("page", String(page));
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <SettingsNav />
      <form className="mb-4 flex flex-wrap gap-2 text-sm" method="GET">
        <select name="kind" defaultValue={kind ?? ""} className="rounded border border-line px-2 py-1">
          <option value="">All kinds</option>
          {opts.kinds.map((k) => <option key={k} value={k}>{emailKindLabel(k)}</option>)}
        </select>
        <select name="event" defaultValue={eventId ?? ""} className="rounded border border-line px-2 py-1">
          <option value="">All events</option>
          {opts.events.map((e) => <option key={e.id} value={e.id}>{e.name ?? e.id}</option>)}
        </select>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">Filter</button>
      </form>

      <EmailLog groups={groups} />

      <div className="mt-4 flex items-center justify-between text-sm">
        {page > 0
          ? <a className="underline" href={qs({ page: page - 1 })}>← Newer</a>
          : <span />}
        {hasMore
          ? <a className="underline" href={qs({ page: page + 1 })}>Older →</a>
          : <span />}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify build + typecheck + suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests pass; build succeeds (the new page compiles). If `HubNav`/`SettingsNav` import paths differ, match `app/settings/emails/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/settings/emails/log/page.tsx components/hub/EmailLog.tsx components/hub/SettingsNav.tsx
git commit -m "feat(email-log): Sent log page (filters, mass expand, content modal, pagination)"
```

---

## Self-Review Notes

- **Spec coverage:** view/grouping (T1), kind label + exact-as-sent fetch (T2), grouped+filtered+paginated queries (T3), hub-gated recipients/content endpoints (T4), page with filters + mass-expand + content modal + pagination + nav tab (T5). All spec sections covered.
- **Placeholder scan:** none — full code for every file. (Task 5 Step 2 note corrects the single-row handler to `onClick={() => toggle(g)}`.)
- **Type consistency:** `EmailGroup`/`EmailRecipient` (db) ↔ `EmailGroupView`/`Recipient` (client) fields align (camelCase); the view `.from()` cast documented; `listGroupRecipients` day-window derives from the same UTC day the view groups on.
- **Auth:** page covered by `middleware.ts`; both API routes do their own `authed()` (since `/api/*` bypasses middleware).
- **Rollout dependency:** the view must be applied to Supabase before the page returns data (documented in the spec rollout); code typechecks without it via the cast.
