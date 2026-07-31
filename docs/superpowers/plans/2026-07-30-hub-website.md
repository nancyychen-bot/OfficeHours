# Office Hours Hub Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a gated admin dashboard (Bookings/Slots/Events) over the Supabase source of truth, plus a public, Notion-embeddable Add-Event form, inside the existing `office-hours` Next.js app.

**Architecture:** Read-only React Server Components query Supabase via the existing service-role `lib/db` helpers (server-only). Middleware + a signed HttpOnly cookie guard the dashboard `/`. `/add-event` is a separate public route that posts to a public API running the existing `registerEventFromLuma`, protected against bots by a stateless signed form token. Light client components handle tab switching, filter chips, and search.

**Tech Stack:** Next.js 15 App Router, React Server Components, Supabase (service role), Tailwind CSS, TypeScript, Vitest, Web Crypto (HMAC).

---

## Conventions (read once)

- Path alias `@/*` maps to the project root (`tsconfig.json`).
- Supabase service-role client: `import { getAdminClient } from "@/lib/supabase/admin"`.
- Env getters live in `lib/env.ts` (lazy, throw-on-missing via `required`, `optional`).
- Tests are Vitest; run a single file with `npx vitest run tests/<file>`.
- **Before any `tsc`/`build`:** `rm -rf .next` first (iCloud creates duplicate `" 2.ts"` files in `.next/types` that break tsc).
- Full check before each commit: `rm -rf .next && npx tsc --noEmit && npx vitest run`.
- `registerEventFromLuma(input: { lumaEvent: string; city?: string; slotStart?: string; slotLengthMinutes?: number }): Promise<{ eventId; eventName; inserted; updated; deleted; skippedDeletes }>` from `@/lib/events/register`.
- `parseLumaEventId(input: string): string` from `@/lib/luma/client` (extracts `evt-...` from a URL or raw id; throws if none found).
- `booking_details` view columns: all `bookings` columns plus `location`, `event_name`, `event_date`, `timezone`, `slot_name`, `slot_starts_at`, `slot_ends_at`.

## File Structure

- `tailwind.config.ts`, `postcss.config.mjs` — Tailwind setup. `app/globals.css` — Tailwind directives + a few tokens.
- `lib/auth/token.ts` — generic HMAC sign/verify + constant-time compare (Web Crypto). One responsibility: signed opaque tokens.
- `lib/auth/session.ts` — issue/verify the dashboard session token (built on token.ts).
- `lib/auth/form-token.ts` — issue/verify the add-event anti-bot token (built on token.ts).
- `middleware.ts` — guard `/`, redirect to `/login` without a valid session cookie.
- `app/login/page.tsx` + `app/api/hub/login/route.ts` — password gate.
- `app/add-event/page.tsx` + `app/api/hub/add-event/route.ts` — public embeddable form + register API.
- `lib/hub/queries.ts` — read-only aggregate reads for the dashboard (bookings/slots/events/sync summary).
- `lib/hub/format.ts` — pure, testable presentation helpers (grouping, chips, filtering, status pill, relative time).
- `app/page.tsx` — gated dashboard RSC (fetches data, renders `<Dashboard>`).
- `components/hub/Dashboard.tsx` — client shell: sync strip + tab bar + active tab + refresh.
- `components/hub/BookingsTab.tsx`, `SlotsTab.tsx`, `EventsTab.tsx`, `StatusPill.tsx`, `SyncStrip.tsx` — view components.
- `lib/env.ts` — add `env.hub.password()` + `env.hub.sessionSecret()`. `.env.example` — document new vars.

---

## Task 1: Tailwind CSS setup

**Files:**
- Create: `tailwind.config.ts`, `postcss.config.mjs`
- Modify: `app/globals.css`, `package.json` (devDeps via install)

- [ ] **Step 1: Install Tailwind**

Run:
```bash
cd "/Users/nchen/Library/Mobile Documents/com~apple~CloudDocs/Apps Created/office-hours"
npm install -D tailwindcss@^3 postcss autoprefixer
```
Expected: packages added to devDependencies.

- [ ] **Step 2: Create `postcss.config.mjs`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f7f5", // Notion-like light gray
        line: "#e9e9e7",
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 4: Replace `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
}

body {
  background: #f7f7f5;
  color: #37352f;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
}
```

- [ ] **Step 5: Verify build compiles**

Run: `rm -rf .next && npx tsc --noEmit && npm run build`
Expected: build succeeds (existing placeholder page still renders). If `app/layout.tsx` does not already `import "./globals.css"`, confirm it does (it should from the scaffold).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts postcss.config.mjs app/globals.css
git commit -m "feat(hub): add Tailwind CSS"
```

---

## Task 2: HMAC token utility

**Files:**
- Create: `lib/auth/token.ts`, `tests/auth-token.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/auth-token.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "@/lib/auth/token";

const SECRET = "test-secret-value";

describe("signToken / verifyToken", () => {
  it("round-trips a payload", async () => {
    const token = await signToken("hub.123", SECRET);
    expect(await verifyToken(token, SECRET)).toBe("hub.123");
  });

  it("rejects a tampered payload", async () => {
    const token = await signToken("hub.123", SECRET);
    const tampered = token.replace("hub.123", "hub.999");
    expect(await verifyToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await signToken("hub.123", SECRET);
    expect(await verifyToken(token, "other-secret")).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyToken("nonsense", SECRET)).toBeNull();
    expect(await verifyToken("", SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/auth-token.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/auth/token.ts`**

```ts
/**
 * Stateless signed tokens via HMAC-SHA256 (Web Crypto, so it runs in both the
 * Node runtime and Edge middleware). A token is `${payload}.${hexSignature}`.
 * `verifyToken` returns the payload only when the signature matches, using a
 * constant-time comparison.
 */

async function hmacHex(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(payload: string, secret: string): Promise<string> {
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmacHex(payload, secret);
  return timingSafeEqual(sig, expected) ? payload : null;
}

/** Constant-time string equality (exported for password checks). */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/auth-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/token.ts tests/auth-token.test.ts
git commit -m "feat(hub): HMAC signed-token utility"
```

---

## Task 3: Session + env wiring

**Files:**
- Create: `lib/auth/session.ts`, `tests/auth-session.test.ts`
- Modify: `lib/env.ts`, `.env.example`

- [ ] **Step 1: Write the failing test** — `tests/auth-session.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { issueSession, isValidSession, SESSION_COOKIE } from "@/lib/auth/session";

const SECRET = "session-secret";

describe("session", () => {
  it("exposes a stable cookie name", () => {
    expect(SESSION_COOKIE).toBe("hub_session");
  });

  it("issues a token that validates", async () => {
    const token = await issueSession(SECRET);
    expect(await isValidSession(token, SECRET)).toBe(true);
  });

  it("rejects missing or bad tokens", async () => {
    expect(await isValidSession(undefined, SECRET)).toBe(false);
    expect(await isValidSession("bad.token", SECRET)).toBe(false);
    const token = await issueSession(SECRET);
    expect(await isValidSession(token, "wrong-secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/auth-session.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/auth/session.ts`**

```ts
import { signToken, verifyToken } from "./token";

/** Name of the dashboard session cookie. */
export const SESSION_COOKIE = "hub_session";

/** Max cookie age in seconds (30 days). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Issue a signed session token. Payload is a constant marker; the cookie's
 * Max-Age handles expiry. The signature proves the server minted it.
 */
export async function issueSession(secret: string): Promise<string> {
  return signToken("hub-authenticated", secret);
}

/** True when the cookie value is a validly-signed session token. */
export async function isValidSession(
  token: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const payload = await verifyToken(token, secret);
  return payload === "hub-authenticated";
}
```

- [ ] **Step 4: Add env getters** — in `lib/env.ts`, add a `hub` group inside the `env` object (place it after the `app` group):

```ts
  hub: {
    password: () => required("HUB_PASSWORD"),
    sessionSecret: () => required("HUB_SESSION_SECRET"),
  },
```

- [ ] **Step 5: Document env vars** — append to `.env.example`:

```
# Hub dashboard gate
HUB_PASSWORD=choose-a-strong-password
HUB_SESSION_SECRET=generate-32+-random-bytes
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx vitest run tests/auth-session.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/auth/session.ts tests/auth-session.test.ts lib/env.ts .env.example
git commit -m "feat(hub): session token + HUB_PASSWORD/HUB_SESSION_SECRET env"
```

---

## Task 4: Login page + login API

**Files:**
- Create: `app/login/page.tsx`, `app/api/hub/login/route.ts`

- [ ] **Step 1: Implement the login API** — `app/api/hub/login/route.ts`

```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { constantTimeEquals } from "@/lib/auth/token";
import { issueSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const ok = constantTimeEquals(password, env.hub.password());
  if (!ok) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), { status: 303 });
  }
  const token = await issueSession(env.hub.sessionSecret());
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
```

- [ ] **Step 2: Implement the login page** — `app/login/page.tsx`

```tsx
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-[15vh] w-full max-w-sm px-6">
      <h1 className="text-xl font-semibold">Office Hours Hub</h1>
      <p className="mt-1 text-sm text-neutral-500">Enter the password to continue.</p>
      <form method="POST" action="/api/hub/login" className="mt-6 space-y-3">
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
        {error ? <p className="text-sm text-red-600">Incorrect password.</p> : null}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `rm -rf .next && npx tsc --noEmit && npm run build`
Expected: build succeeds; `/login` and `/api/hub/login` appear in the route list.

- [ ] **Step 4: Commit**

```bash
git add app/login/page.tsx app/api/hub/login/route.ts
git commit -m "feat(hub): password login page + API"
```

---

## Task 5: Middleware guard

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Implement `middleware.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Guard the dashboard root. `/login`, `/add-event`, `/api/*`, and static assets
 * are public (see `matcher`). Without a valid session cookie, redirect to login.
 */
export async function middleware(req: NextRequest) {
  const secret = process.env.HUB_SESSION_SECRET ?? "";
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token, secret)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// Only guard the dashboard root. Everything else is public or handled per-route.
export const config = {
  matcher: ["/"],
};
```

- [ ] **Step 2: Manual verification note**

Run: `rm -rf .next && npx tsc --noEmit && npm run build`
Expected: build succeeds. (Runtime check happens in Task 12: visiting `/` without the cookie must redirect to `/login`.)

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(hub): middleware guarding dashboard root"
```

---

## Task 6: Add-event anti-bot form token

**Files:**
- Create: `lib/auth/form-token.ts`, `tests/form-token.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/form-token.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { issueFormToken, verifyFormToken } from "@/lib/auth/form-token";

const SECRET = "form-secret";

describe("form token", () => {
  it("accepts a fresh token", async () => {
    const now = 1_800_000_000_000;
    const token = await issueFormToken(SECRET, now);
    expect(await verifyFormToken(token, SECRET, now + 60_000)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const now = 1_800_000_000_000;
    const token = await issueFormToken(SECRET, now);
    // maxAge is 2h; 3h later must fail
    expect(await verifyFormToken(token, SECRET, now + 3 * 60 * 60_000)).toBe(false);
  });

  it("rejects a tampered/garbage token", async () => {
    expect(await verifyFormToken("garbage", SECRET, Date.now())).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/form-token.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/auth/form-token.ts`**

```ts
import { signToken, verifyToken } from "./token";

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * A stateless anti-bot token embedded in the public add-event form. It carries
 * the issue time; the API accepts it only if the signature is valid and it was
 * issued within MAX_AGE_MS. This stops drive-by/bot posts without requiring a
 * login or a cookie (important — the form is embedded in a Notion iframe).
 */
export async function issueFormToken(secret: string, nowMs: number): Promise<string> {
  return signToken(`form.${nowMs}`, secret);
}

export async function verifyFormToken(
  token: string,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  const payload = await verifyToken(token, secret);
  if (!payload || !payload.startsWith("form.")) return false;
  const issued = Number(payload.slice("form.".length));
  if (!Number.isFinite(issued)) return false;
  return nowMs - issued <= MAX_AGE_MS && nowMs >= issued;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/form-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/form-token.ts tests/form-token.test.ts
git commit -m "feat(hub): stateless anti-bot form token"
```

---

## Task 7: Add-event API route

**Files:**
- Create: `app/api/hub/add-event/route.ts`

- [ ] **Step 1: Implement the route** — `app/api/hub/add-event/route.ts`

```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyFormToken } from "@/lib/auth/form-token";
import { registerEventFromLuma } from "@/lib/events/register";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  if (!(await verifyFormToken(token, env.hub.sessionSecret(), Date.now()))) {
    return NextResponse.json({ ok: false, error: "Invalid or expired form token. Reload the page and try again." }, { status: 400 });
  }

  const lumaEvent = String(form.get("lumaEvent") ?? "").trim();
  if (!lumaEvent) {
    return NextResponse.json({ ok: false, error: "A Luma event URL or id is required." }, { status: 400 });
  }
  const city = String(form.get("city") ?? "").trim() || undefined;
  const slotStart = String(form.get("slotStart") ?? "").trim() || undefined;
  const lengthRaw = String(form.get("length") ?? "").trim();
  const slotLengthMinutes = lengthRaw ? Number(lengthRaw) : undefined;

  try {
    const result = await registerEventFromLuma({ lumaEvent, city, slotStart, slotLengthMinutes });
    return NextResponse.json({
      ok: true,
      event: {
        name: result.eventName,
        slots: result.inserted + result.updated,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `rm -rf .next && npx tsc --noEmit && npm run build`
Expected: build succeeds; `/api/hub/add-event` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add app/api/hub/add-event/route.ts
git commit -m "feat(hub): add-event API running registerEventFromLuma"
```

---

## Task 8: Add-event page (public, embeddable)

**Files:**
- Create: `app/add-event/page.tsx`, `components/hub/AddEventForm.tsx`

- [ ] **Step 1: Implement the page (RSC that mints the token + sets CSP)** — `app/add-event/page.tsx`

```tsx
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { issueFormToken } from "@/lib/auth/form-token";
import { AddEventForm } from "@/components/hub/AddEventForm";

// Allow embedding inside a Notion page (iframe). We deliberately do NOT set
// X-Frame-Options; frame-ancestors below is the modern, granular control.
export const metadata = { title: "Add an Office Hours event" };

export default async function AddEventPage() {
  await headers(); // opt out of static rendering so the token is freshly minted
  const token = await issueFormToken(env.hub.sessionSecret(), Date.now());
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-lg font-semibold">Track an Office Hours event</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Paste the Luma event link. We&apos;ll pull its details and slots into the hub.
      </p>
      <AddEventForm token={token} />
    </main>
  );
}
```

- [ ] **Step 2: Add the CSP header for this route** — modify `next.config` (the existing `next.config.mjs`) to add an async `headers()` allowing Notion to frame `/add-event`. Replace the `nextConfig` object with:

```js
const nextConfig = {
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  async headers() {
    return [
      {
        source: "/add-event",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https://*.notion.so https://notion.so https://*.notion.site",
          },
        ],
      },
    ];
  },
};
```

- [ ] **Step 3: Implement the client form** — `components/hub/AddEventForm.tsx`

```tsx
"use client";

import { useState } from "react";

type Result = { ok: true; event: { name: string; slots: number } } | { ok: false; error: string };

export function AddEventForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const body = new FormData(e.currentTarget);
    const res = await fetch("/api/hub/add-event", { method: "POST", body });
    setResult((await res.json()) as Result);
    setBusy(false);
  }

  const field = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <input type="hidden" name="token" value={token} />
      <label className="block text-sm">
        <span className="text-neutral-600">Luma event URL or id *</span>
        <input name="lumaEvent" required placeholder="https://lu.ma/..." className={`mt-1 ${field}`} />
      </label>
      <details className="text-sm">
        <summary className="cursor-pointer text-neutral-500">Optional overrides</summary>
        <div className="mt-2 space-y-2">
          <input name="city" placeholder="City (defaults to Luma address)" className={field} />
          <input name="slotStart" placeholder="First slot start (ISO, e.g. 2026-08-26T21:00:00Z)" className={field} />
          <input name="length" placeholder="Slot length minutes (default 30)" className={field} />
        </div>
      </details>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add event"}
      </button>
      {result?.ok ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Added <strong>{result.event.name}</strong> — {result.event.slots} slots tracked.
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `rm -rf .next && npx tsc --noEmit && npm run build`
Expected: build succeeds; `/add-event` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add app/add-event/page.tsx components/hub/AddEventForm.tsx next.config.mjs
git commit -m "feat(hub): public embeddable add-event form"
```

---

## Task 9: Dashboard queries

**Files:**
- Create: `lib/hub/queries.ts`

- [ ] **Step 1: Implement `lib/hub/queries.ts`**

```ts
import { getAdminClient } from "@/lib/supabase/admin";

export interface HubBooking {
  id: string;
  guest_name: string;
  guest_email: string | null;
  company: string | null;
  challenge: string | null;
  status: string;
  booked_by_display_name: string | null;
  booked_by_type: string | null;
  location: string | null;
  event_name: string | null;
  event_date: string | null;
  luma_event_id: string;
  slot_name: string | null;
  slot_starts_at: string | null;
}

export interface HubSlot {
  id: string;
  name: string;
  starts_at: string | null;
  event_name: string | null;
  city: string | null;
  event_date: string | null;
  booked: boolean;
  guest_name: string | null;
}

export interface HubEvent {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  luma_event_id: string;
  status: string;
  slot_count: number;
  booking_count: number;
}

export interface SyncSummary {
  lastSyncAt: string | null;
  trackedEvents: number;
}

/** All bookings with resolved event/slot context, newest event first. */
export async function listBookings(): Promise<HubBooking[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("booking_details")
    .select(
      "id,guest_name,guest_email,company,challenge,status,booked_by_display_name,booked_by_type,location,event_name,event_date,luma_event_id,slot_name,slot_starts_at",
    )
    .order("event_date", { ascending: true })
    .order("slot_starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HubBooking[];
}

/** All slots with event context and whether they are booked. */
export async function listSlots(): Promise<HubSlot[]> {
  const supabase = getAdminClient();
  const { data: slots, error } = await supabase
    .from("slots")
    .select("id,name,starts_at,event_id,events(name,city,event_date)")
    .order("starts_at", { ascending: true });
  if (error) throw error;
  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select("slot_id,guest_name,status")
    .neq("status", "cancelled");
  if (bErr) throw bErr;
  const bySlot = new Map<string, { guest_name: string }>();
  for (const b of bookings ?? []) {
    if (b.slot_id) bySlot.set(b.slot_id as string, { guest_name: b.guest_name as string });
  }
  return (slots ?? []).map((s) => {
    // Supabase returns the joined `events` relation as an object.
    const ev = (s as { events?: { name?: string; city?: string; event_date?: string } }).events;
    const booking = bySlot.get(s.id as string);
    return {
      id: s.id as string,
      name: s.name as string,
      starts_at: (s.starts_at as string) ?? null,
      event_name: ev?.name ?? null,
      city: ev?.city ?? null,
      event_date: ev?.event_date ?? null,
      booked: !!booking,
      guest_name: booking?.guest_name ?? null,
    };
  });
}

/** All events with slot + (non-cancelled) booking counts. */
export async function listEvents(): Promise<HubEvent[]> {
  const supabase = getAdminClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id,name,city,event_date,luma_event_id,status")
    .order("event_date", { ascending: true });
  if (error) throw error;
  const { data: slots, error: sErr } = await supabase.from("slots").select("event_id");
  if (sErr) throw sErr;
  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select("event_id,status")
    .neq("status", "cancelled");
  if (bErr) throw bErr;

  const slotCount = new Map<string, number>();
  for (const s of slots ?? []) slotCount.set(s.event_id as string, (slotCount.get(s.event_id as string) ?? 0) + 1);
  const bookCount = new Map<string, number>();
  for (const b of bookings ?? []) bookCount.set(b.event_id as string, (bookCount.get(b.event_id as string) ?? 0) + 1);

  return (events ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    city: (e.city as string) ?? null,
    event_date: (e.event_date as string) ?? null,
    luma_event_id: e.luma_event_id as string,
    status: e.status as string,
    slot_count: slotCount.get(e.id as string) ?? 0,
    booking_count: bookCount.get(e.id as string) ?? 0,
  }));
}

/** Last successful hub→Notion push time + count of non-cancelled events. */
export async function syncSummary(): Promise<SyncSummary> {
  const supabase = getAdminClient();
  const { data: last } = await supabase
    .from("sync_log")
    .select("created_at,direction,result")
    .in("direction", ["hub_to_dev", "hub_to_amb"])
    .eq("result", "applied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .neq("status", "cancelled");
  return {
    lastSyncAt: (last?.created_at as string) ?? null,
    trackedEvents: count ?? 0,
  };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `rm -rf .next && npx tsc --noEmit`
Expected: no errors. (If the generated Supabase types make the `events(...)` join shape an array, adjust the `ev` cast to read `Array.isArray(s.events) ? s.events[0] : s.events`.)

- [ ] **Step 3: Commit**

```bash
git add lib/hub/queries.ts
git commit -m "feat(hub): read-only dashboard queries"
```

---

## Task 10: Presentation helpers (pure, tested)

**Files:**
- Create: `lib/hub/format.ts`, `tests/hub-format.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/hub-format.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  statusPill,
  monthLabel,
  eventChips,
  filterBookings,
  groupByCity,
  relativeTime,
} from "@/lib/hub/format";
import type { HubBooking, HubEvent } from "@/lib/hub/queries";

function booking(p: Partial<HubBooking>): HubBooking {
  return {
    id: "b1", guest_name: "Ann", guest_email: "a@x.com", company: "Acme", challenge: null,
    status: "unassigned", booked_by_display_name: null, booked_by_type: null,
    location: "SF", event_name: "OH SF", event_date: "2026-08-26", luma_event_id: "evt-1",
    slot_name: "2:00-2:30 PM", slot_starts_at: "2026-08-26T21:00:00Z", ...p,
  };
}

describe("statusPill", () => {
  it("maps known statuses to labels + classes", () => {
    expect(statusPill("assigned").label).toBe("Assigned");
    expect(statusPill("checked_in").label).toBe("Checked In");
    expect(statusPill("unassigned").label).toBe("Unassigned");
    expect(statusPill("cancelled").label).toBe("Cancelled");
    expect(statusPill("assigned").className).toContain("bg-");
  });
  it("falls back for unknown status", () => {
    expect(statusPill("weird").label).toBe("weird");
  });
});

describe("monthLabel", () => {
  it("formats an ISO date to City-friendly month", () => {
    expect(monthLabel("2026-08-26")).toBe("Aug 2026");
    expect(monthLabel(null)).toBe("");
  });
});

describe("eventChips", () => {
  it("builds one chip per event with city + month label", () => {
    const events: HubEvent[] = [
      { id: "e1", name: "OH SF", city: "SF", event_date: "2026-08-26", luma_event_id: "evt-1", status: "active", slot_count: 6, booking_count: 2 },
    ];
    const chips = eventChips(events);
    expect(chips[0]).toEqual({ key: "evt-1", label: "SF — Aug 2026" });
  });
});

describe("filterBookings", () => {
  const rows = [
    booking({ id: "b1", luma_event_id: "evt-1", guest_name: "Alice", company: "Acme" }),
    booking({ id: "b2", luma_event_id: "evt-2", guest_name: "Bob", company: "Globex" }),
  ];
  it("filters by event chip key", () => {
    expect(filterBookings(rows, { chip: "evt-1", search: "" }).map((r) => r.id)).toEqual(["b1"]);
  });
  it("returns all for the 'all' chip", () => {
    expect(filterBookings(rows, { chip: "all", search: "" })).toHaveLength(2);
  });
  it("searches name/company/email case-insensitively", () => {
    expect(filterBookings(rows, { chip: "all", search: "globex" }).map((r) => r.id)).toEqual(["b2"]);
    expect(filterBookings(rows, { chip: "all", search: "ALICE" }).map((r) => r.id)).toEqual(["b1"]);
  });
});

describe("groupByCity", () => {
  it("groups rows by location, preserving order", () => {
    const rows = [booking({ id: "b1", location: "SF" }), booking({ id: "b2", location: "NYC" }), booking({ id: "b3", location: "SF" })];
    const groups = groupByCity(rows);
    expect(groups.map((g) => g.city)).toEqual(["SF", "NYC"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["b1", "b3"]);
  });
});

describe("relativeTime", () => {
  it("renders minutes/hours ago", () => {
    const now = Date.parse("2026-07-30T12:00:00Z");
    expect(relativeTime("2026-07-30T11:58:00Z", now)).toBe("2 min ago");
    expect(relativeTime("2026-07-30T10:00:00Z", now)).toBe("2 hr ago");
    expect(relativeTime(null, now)).toBe("never");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/hub-format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/hub/format.ts`**

```ts
import type { HubBooking, HubEvent } from "./queries";

const STATUS_PILLS: Record<string, { label: string; className: string }> = {
  assigned: { label: "Assigned", className: "bg-blue-100 text-blue-800" },
  checked_in: { label: "Checked In", className: "bg-green-100 text-green-800" },
  unassigned: { label: "Unassigned", className: "bg-neutral-100 text-neutral-600" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

export function statusPill(status: string): { label: string; className: string } {
  return STATUS_PILLS[status] ?? { label: status, className: "bg-neutral-100 text-neutral-600" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-26" -> "Aug 2026". Empty string for null. */
export function monthLabel(dateISO: string | null): string {
  if (!dateISO) return "";
  const [y, m] = dateISO.split("-");
  const mi = Number(m) - 1;
  if (!y || mi < 0 || mi > 11) return "";
  return `${MONTHS[mi]} ${y}`;
}

export interface Chip {
  key: string;
  label: string;
}

/** One chip per event, keyed by luma_event_id, labelled "City — Mon Year". */
export function eventChips(events: HubEvent[]): Chip[] {
  return events.map((e) => ({
    key: e.luma_event_id,
    label: `${e.city ?? "—"} — ${monthLabel(e.event_date)}`.replace(/ — $/, ""),
  }));
}

/** Filter by event chip ("all" = no filter) then by a name/company/email search. */
export function filterBookings(
  rows: HubBooking[],
  opts: { chip: string; search: string },
): HubBooking[] {
  const q = opts.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (opts.chip !== "all" && r.luma_event_id !== opts.chip) return false;
    if (!q) return true;
    return (
      r.guest_name.toLowerCase().includes(q) ||
      (r.company ?? "").toLowerCase().includes(q) ||
      (r.guest_email ?? "").toLowerCase().includes(q)
    );
  });
}

export interface CityGroup {
  city: string;
  rows: HubBooking[];
}

/** Group bookings by location, preserving first-seen city order. */
export function groupByCity(rows: HubBooking[]): CityGroup[] {
  const order: string[] = [];
  const map = new Map<string, HubBooking[]>();
  for (const r of rows) {
    const city = r.location ?? "—";
    if (!map.has(city)) {
      map.set(city, []);
      order.push(city);
    }
    map.get(city)!.push(r);
  }
  return order.map((city) => ({ city, rows: map.get(city)! }));
}

/** Compact "2 min ago" / "2 hr ago" / "3 days ago"; "never" for null. */
export function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const diff = nowMs - Date.parse(iso);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/hub-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hub/format.ts tests/hub-format.test.ts
git commit -m "feat(hub): pure presentation helpers with tests"
```

---

## Task 11: View components (StatusPill, SyncStrip, tabs)

**Files:**
- Create: `components/hub/StatusPill.tsx`, `components/hub/SyncStrip.tsx`, `components/hub/BookingsTab.tsx`, `components/hub/SlotsTab.tsx`, `components/hub/EventsTab.tsx`

- [ ] **Step 1: `components/hub/StatusPill.tsx`**

```tsx
import { statusPill } from "@/lib/hub/format";

export function StatusPill({ status }: { status: string }) {
  const p = statusPill(status);
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${p.className}`}>{p.label}</span>;
}
```

- [ ] **Step 2: `components/hub/SyncStrip.tsx`**

```tsx
import type { SyncSummary } from "@/lib/hub/queries";
import { relativeTime } from "@/lib/hub/format";

export function SyncStrip({ summary, nowMs }: { summary: SyncSummary; nowMs: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm text-neutral-600">
      <span className="inline-block h-2 w-2 rounded-full bg-green-500" aria-hidden />
      <span className="font-medium text-neutral-800">Sync engine</span>
      <span className="text-neutral-400">Hub → Notion Dev → Ambassador</span>
      <span className="ml-auto text-neutral-500">
        Last sync {relativeTime(summary.lastSyncAt, nowMs)} · {summary.trackedEvents} events tracked
      </span>
    </div>
  );
}
```

- [ ] **Step 3: `components/hub/BookingsTab.tsx`** (client — owns chip + search state)

```tsx
"use client";

import { useState } from "react";
import type { HubBooking } from "@/lib/hub/queries";
import { eventChips, filterBookings, groupByCity, type Chip } from "@/lib/hub/format";
import { StatusPill } from "./StatusPill";

export function BookingsTab({ bookings, chips }: { bookings: HubBooking[]; chips: Chip[] }) {
  const [chip, setChip] = useState("all");
  const [search, setSearch] = useState("");
  const groups = groupByCity(filterBookings(bookings, { chip, search }));
  const allChips: Chip[] = [{ key: "all", label: "All bookings" }, ...chips];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {allChips.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            className={`rounded-full border px-3 py-1 text-sm ${chip === c.key ? "border-neutral-800 bg-neutral-900 text-white" : "border-line bg-white text-neutral-700 hover:bg-neutral-50"}`}
          >
            {c.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, email"
          className="ml-auto w-64 rounded-md border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Guest</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Slot</th>
              <th className="px-3 py-2 font-medium">City</th>
              <th className="px-3 py-2 font-medium">Booked by</th>
              <th className="px-3 py-2 font-medium">Helper type</th>
              <th className="px-3 py-2 font-medium">Challenge</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RowsForCity key={g.city} city={g.city} rows={g.rows} />
            ))}
            {groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-400">
                  No bookings match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowsForCity({ city, rows }: { city: string; rows: HubBooking[] }) {
  return (
    <>
      <tr className="bg-neutral-50/60">
        <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-neutral-500">
          {city} · {rows.length}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.id} className="border-b border-line last:border-0">
          <td className="px-3 py-2 font-medium text-neutral-800">{r.guest_name}</td>
          <td className="px-3 py-2"><StatusPill status={r.status} /></td>
          <td className="px-3 py-2 text-neutral-600">{r.slot_name ?? "—"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.location ?? "—"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.booked_by_display_name ?? "Empty"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.booked_by_type ?? "—"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.challenge ?? "—"}</td>
        </tr>
      ))}
    </>
  );
}
```

- [ ] **Step 4: `components/hub/SlotsTab.tsx`**

```tsx
import type { HubSlot } from "@/lib/hub/queries";

export function SlotsTab({ slots }: { slots: HubSlot[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">City</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Slot</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 font-medium">Guest</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id} className="border-b border-line last:border-0">
              <td className="px-3 py-2 text-neutral-700">{s.event_name ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.city ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.event_date ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.name}</td>
              <td className="px-3 py-2 text-neutral-600">{s.booked ? "Booked" : "Available"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.guest_name ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: `components/hub/EventsTab.tsx`**

```tsx
import Link from "next/link";
import type { HubEvent } from "@/lib/hub/queries";

export function EventsTab({ events }: { events: HubEvent[] }) {
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Link
          href="/add-event"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          New event
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">City</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Luma id</th>
              <th className="px-3 py-2 font-medium">Slots</th>
              <th className="px-3 py-2 font-medium">Bookings</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium text-neutral-800">{e.name}</td>
                <td className="px-3 py-2 text-neutral-600">{e.city ?? "—"}</td>
                <td className="px-3 py-2 text-neutral-600">{e.event_date ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">{e.luma_event_id}</td>
                <td className="px-3 py-2 text-neutral-600">{e.slot_count}</td>
                <td className="px-3 py-2 text-neutral-600">{e.booking_count}</td>
                <td className="px-3 py-2 text-neutral-600">{e.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `rm -rf .next && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/hub/StatusPill.tsx components/hub/SyncStrip.tsx components/hub/BookingsTab.tsx components/hub/SlotsTab.tsx components/hub/EventsTab.tsx
git commit -m "feat(hub): dashboard view components"
```

---

## Task 12: Dashboard shell + gated page + final integration

**Files:**
- Create: `components/hub/Dashboard.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Implement the client shell** — `components/hub/Dashboard.tsx`

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HubBooking, HubSlot, HubEvent, SyncSummary } from "@/lib/hub/queries";
import { eventChips } from "@/lib/hub/format";
import { SyncStrip } from "./SyncStrip";
import { BookingsTab } from "./BookingsTab";
import { SlotsTab } from "./SlotsTab";
import { EventsTab } from "./EventsTab";

type Tab = "bookings" | "slots" | "events";

export function Dashboard({
  bookings,
  slots,
  events,
  summary,
  nowMs,
}: {
  bookings: HubBooking[];
  slots: HubSlot[];
  events: HubEvent[];
  summary: SyncSummary;
  nowMs: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("bookings");
  const chips = eventChips(events);
  const tabs: { key: Tab; label: string }[] = [
    { key: "bookings", label: "Bookings" },
    { key: "slots", label: "Slots" },
    { key: "events", label: "Events" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Office Hours Hub</h1>
        <button
          onClick={() => router.refresh()}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Refresh
        </button>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        One hub, three tables. Events hold the sessions, Slots hold the bookable windows,
        Bookings hold the guests. Filter by city — never fork the database.
      </p>

      <SyncStrip summary={summary} nowMs={nowMs} />

      <div className="mb-4 mt-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bookings" ? <BookingsTab bookings={bookings} chips={chips} /> : null}
      {tab === "slots" ? <SlotsTab slots={slots} /> : null}
      {tab === "events" ? <EventsTab events={events} /> : null}
    </main>
  );
}
```

- [ ] **Step 2: Replace `app/page.tsx` with the gated RSC**

```tsx
import { listBookings, listSlots, listEvents, syncSummary } from "@/lib/hub/queries";
import { Dashboard } from "@/components/hub/Dashboard";

// Always render fresh (reads the live DB); the middleware guards access.
export const dynamic = "force-dynamic";

export default async function HubPage() {
  const [bookings, slots, events, summary] = await Promise.all([
    listBookings(),
    listSlots(),
    listEvents(),
    syncSummary(),
  ]);
  return (
    <Dashboard
      bookings={bookings}
      slots={slots}
      events={events}
      summary={summary}
      nowMs={Date.now()}
    />
  );
}
```

- [ ] **Step 3: Full check + build**

Run: `rm -rf .next && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean, all tests pass, build succeeds with `/`, `/login`, `/add-event`, `/api/hub/login`, `/api/hub/add-event` in the route list.

- [ ] **Step 4: Local runtime smoke test**

Run (needs `.env.local` with `HUB_PASSWORD` + `HUB_SESSION_SECRET` set — add them first):
```bash
npm run dev
```
Then verify manually:
- Visit `http://localhost:3000/` → redirected to `/login`.
- Enter wrong password → "Incorrect password."
- Enter correct password → dashboard loads with the two live events + real bookings; tabs switch; chips + search filter; Refresh re-fetches.
- Visit `http://localhost:3000/add-event` directly (no login) → form loads; submitting a Luma URL returns a success card.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/hub/Dashboard.tsx
git commit -m "feat(hub): gated dashboard shell + wired page"
```

---

## Post-implementation (handled outside this plan)

- Add `HUB_PASSWORD` + `HUB_SESSION_SECRET` to Vercel env; deploy.
- Embed `https://<app>/add-event` in a Notion page (Embed block) to confirm framing works.
- (Standing) Rotate all previously-shared secrets.

## Self-review notes

- **Spec coverage:** add-event (public/embeddable/CSP/anti-bot) → T6-8; password gate + cookie + middleware → T2-5; Bookings/Slots/Events tabs → T9-12; sync strip → T11/T12; Tailwind → T1; tests → T2,3,6,10. All spec sections covered.
- **Type consistency:** `HubBooking`/`HubSlot`/`HubEvent`/`SyncSummary` defined in T9 and consumed unchanged in T10-12; `Chip` defined in T10 and used in T11-12; `statusPill`/`filterBookings`/`groupByCity`/`eventChips`/`relativeTime`/`monthLabel` signatures match between T10 and consumers.
- **Known adjustment point:** Supabase's typed `.select("...events(...)")` may type the relation as an array; T9 Step 2 calls this out with the fix.
