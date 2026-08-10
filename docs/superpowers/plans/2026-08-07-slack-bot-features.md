# Slack Bot Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Slack Web API bot layer that (1) DMs day-of agendas, (2) DMs claim confirmations, (3) posts recruit messages via the bot, and (4) captures per-1:1 expert feedback via interactive DMs into a new Supabase table synced one-way to a Dev Notion database.

**Architecture:** A new `lib/slack/api.ts` wraps the bot token (`SLACK_BOT_TOKEN`) for `users.lookupByEmail` → `conversations.open` → `chat.postMessage` / `views.open`, all best-effort (never throw). Pure Block Kit builders live in `lib/slack/blocks.ts`. Feature 4 adds an `expert_feedback` table, a `/api/slack/interactivity` endpoint (signature-verified), an hourly cron, and a one-way Notion push to Dev DB `3b5b35e6e67f803d9b44e89ebcfa6daa`. Every DM is additive — all existing emails keep sending.

**Tech Stack:** Next.js 15 App Router (Node runtime), TypeScript, Supabase (service-role), `@notionhq/client` v5 (data-source API), Vitest. Slack via raw `fetch` (no SDK).

**Reference spec:** `docs/superpowers/specs/2026-08-07-slack-bot-features-design.md`

---

## File Structure

**New files:**
- `lib/slack/api.ts` — bot-token Web API client (lookup, open DM, post, modal, post-to-channel). Best-effort.
- `lib/slack/blocks.ts` — pure Block Kit builders: agenda, claim confirm, feedback prompt.
- `lib/slack/verify.ts` — Slack request signature verification (pure).
- `lib/db/expert-feedback.ts` — `expert_feedback` DB access + pure `buildAnswerPatch`.
- `lib/events/expert-feedback.ts` — group bookings → per-expert prompts, ended-event selection, send DMs.
- `lib/notion/expert-feedback.ts` — property constants, pure mapper, one-way `pushExpertFeedback`.
- `app/api/slack/interactivity/route.ts` — Slack interactivity endpoint.
- `app/api/cron/expert-feedback/route.ts` — hourly cron.
- `scripts/configure-expert-feedback-db.ts` — one-time Dev DB schema setup + prints data-source id.
- `supabase/migrations/0038_expert_feedback.sql`
- `supabase/migrations/0039_slack_channels_channel_id.sql`
- Tests: `tests/slack-api.test.ts`, `tests/slack-blocks.test.ts`, `tests/slack-verify.test.ts`, `tests/expert-feedback-db.test.ts`, `tests/expert-feedback-prompts.test.ts`, `tests/slack-interactivity.test.ts`, `tests/expert-feedback-notion.test.ts`.

**Modified files:**
- `lib/env.ts` — add `slack` section + Dev expert-feedback ids.
- `lib/events/agenda.ts` — additive agenda DM after email.
- `lib/slack/client.ts` — prefer bot channel post, webhook fallback.
- `lib/db/slack.ts` — carry `channel_id`.
- `app/api/webhooks/notion/[workspace]/route.ts` — claim-confirm DM at the 3 `assigned` sites.
- `vercel.json` — add the expert-feedback cron.
- `lib/supabase/types.ts` — regenerated after migrations.

**Build order (phases):** Foundation (T1–T3) → Agenda DM (T4–T5) → Claim DM (T6–T7) → Recruit-via-bot (T8–T10) → Feedback capture (T11–T20). Each phase is independently deployable.

**Testing note:** Run the whole suite with `npm test` (vitest). Run a single file with `npx vitest run tests/<file>.test.ts`. Typecheck with `npm run typecheck`.

---

## Phase 1 — Foundation

### Task 1: Env access for Slack + Dev expert-feedback ids

**Files:**
- Modify: `lib/env.ts`

- [ ] **Step 1: Add the env getters**

In `lib/env.ts`, inside the `env` object, add a `slack` section and two Dev getters. Insert the `slack` block after the `hub` block, and add the two lines inside the existing `notionDev` block:

```typescript
  notionDev: {
    token: () => required("NOTION_DEV_TOKEN"),
    bookingsDbId: () => optional("NOTION_DEV_BOOKINGS_DB_ID"),
    bookingsDataSourceId: () => required("NOTION_DEV_BOOKINGS_DATA_SOURCE_ID"),
    webhookSecret: () => optional("NOTION_DEV_WEBHOOK_SECRET"),
    expertFeedbackDbId: () => optional("NOTION_DEV_EXPERT_FEEDBACK_DB_ID"),
    expertFeedbackDataSourceId: () => optional("NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID"),
  },
```

And after the `hub` block (before the closing `} as const;`):

```typescript
  slack: {
    botToken: () => optional("SLACK_BOT_TOKEN"),
    signingSecret: () => optional("SLACK_SIGNING_SECRET"),
  },
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/env.ts
git commit -m "feat(slack): env getters for bot token, signing secret, dev feedback db"
```

---

### Task 2: Slack signature verification

**Files:**
- Create: `lib/slack/verify.ts`
- Test: `tests/slack-verify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/slack-verify.test.ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../lib/slack/verify";

const SECRET = "test-signing-secret";
function sign(body: string, ts: string): string {
  const base = `v0:${ts}:${body}`;
  return "v0=" + createHmac("sha256", SECRET).update(base).digest("hex");
}

describe("verifySlackSignature", () => {
  const now = Math.floor(Date.parse("2026-08-07T12:00:00Z") / 1000);
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

  it("accepts a correctly signed, fresh request", () => {
    const ts = String(now);
    expect(verifySlackSignature(body, ts, sign(body, ts), SECRET, now)).toBe(true);
  });

  it("rejects a bad signature", () => {
    const ts = String(now);
    expect(verifySlackSignature(body, ts, "v0=deadbeef", SECRET, now)).toBe(false);
  });

  it("rejects a stale timestamp (> 5 min skew)", () => {
    const ts = String(now - 60 * 6);
    expect(verifySlackSignature(body, ts, sign(body, ts), SECRET, now)).toBe(false);
  });

  it("returns false when the secret is missing", () => {
    const ts = String(now);
    expect(verifySlackSignature(body, ts, sign(body, ts), undefined, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack-verify.test.ts`
Expected: FAIL — cannot find module `../lib/slack/verify`.

- [ ] **Step 3: Implement `lib/slack/verify.ts`**

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Slack request signature (https://api.slack.com/authentication/verifying-requests-from-slack).
 * Pure: pass the RAW request body, the `x-slack-request-timestamp` and
 * `x-slack-signature` headers, the signing secret, and the current epoch seconds.
 * Rejects a missing secret, a timestamp skewed more than 5 minutes, or a mismatch.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 60 * 5) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/slack-verify.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/verify.ts tests/slack-verify.test.ts
git commit -m "feat(slack): request signature verification"
```

---

### Task 3: Slack Web API client (bot token)

**Files:**
- Create: `lib/slack/api.ts`
- Test: `tests/slack-api.test.ts`

- [ ] **Step 1: Write the failing test**

We test the behaviors we can control: no-op when the token is missing, correct endpoint/payload when it's present, and soft-failure on a Slack error. Stub `global.fetch`.

```typescript
// tests/slack-api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dmByEmail, postToChannel } from "../lib/slack/api";

const calls: Array<{ url: string; body: unknown }> = [];
function stubFetch(responder: (url: string) => unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => responder(url) } as unknown as Response;
  });
}

beforeEach(() => { calls.length = 0; process.env.SLACK_BOT_TOKEN = "xoxb-test"; });
afterEach(() => { delete process.env.SLACK_BOT_TOKEN; vi.restoreAllMocks(); });

describe("dmByEmail", () => {
  it("looks up the user, opens a DM, and posts", async () => {
    stubFetch((url) => {
      if (url.includes("users.lookupByEmail")) return { ok: true, user: { id: "U1" } };
      if (url.includes("conversations.open")) return { ok: true, channel: { id: "D1" } };
      if (url.includes("chat.postMessage")) return { ok: true, ts: "123.45" };
      return { ok: false };
    });
    const res = await dmByEmail("grace@x.com", [{ type: "section" }], "hi");
    expect(res.ok).toBe(true);
    expect(calls.map((c) => c.url).some((u) => u.includes("chat.postMessage"))).toBe(true);
  });

  it("soft-fails (ok:false) when the user is not found", async () => {
    stubFetch(() => ({ ok: false, error: "users_not_found" }));
    const res = await dmByEmail("nobody@x.com", [], "hi");
    expect(res.ok).toBe(false);
  });

  it("no-ops when SLACK_BOT_TOKEN is unset", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    stubFetch(() => ({ ok: true }));
    const res = await dmByEmail("grace@x.com", [], "hi");
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0); // never hit the network
  });
});

describe("postToChannel", () => {
  it("posts blocks to a channel id", async () => {
    stubFetch(() => ({ ok: true, ts: "9.9" }));
    const res = await postToChannel("C123", [{ type: "section" }], "yo");
    expect(res.ok).toBe(true);
    expect(calls[0].url).toContain("chat.postMessage");
    expect((calls[0].body as { channel: string }).channel).toBe("C123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack-api.test.ts`
Expected: FAIL — cannot find module `../lib/slack/api`.

- [ ] **Step 3: Implement `lib/slack/api.ts`**

```typescript
import { env } from "../env";
import { logSync } from "../sync/log";

export interface SlackResult {
  ok: boolean;
  ts?: string;
  error?: string;
}

const SLACK_API = "https://slack.com/api";

/** Low-level authed POST to a Slack Web API method. Returns the parsed body or a soft failure. */
async function callSlack(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = env.slack.botToken();
  if (!token) return { ok: false, error: "no_bot_token" };
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!body.ok) {
      await logSync({ direction: "luma_in", result: "error", action: `slack_${method}`, note: String(body.error ?? "unknown") });
    }
    return body;
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", action: `slack_${method}`, note: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "network" };
  }
}

/** Slack user id for an email, or null (not found / not in workspace / no token). */
export async function lookupUserByEmail(email: string): Promise<string | null> {
  const body = await callSlack("users.lookupByEmail", { email });
  const user = body.user as { id?: string } | undefined;
  return body.ok && user?.id ? user.id : null;
}

/** DM channel id for a user id, or null. */
export async function openDM(userId: string): Promise<string | null> {
  const body = await callSlack("conversations.open", { users: userId });
  const channel = body.channel as { id?: string } | undefined;
  return body.ok && channel?.id ? channel.id : null;
}

/** Post Block Kit blocks to a channel/DM id. Best-effort. */
export async function postToChannel(channel: string, blocks: unknown[], text: string): Promise<SlackResult> {
  const body = await callSlack("chat.postMessage", { channel, blocks, text });
  return { ok: !!body.ok, ts: body.ts as string | undefined, error: body.error as string | undefined };
}

/** Update an existing message (used by the interactivity handler to confirm a choice). */
export async function updateMessage(channel: string, ts: string, blocks: unknown[], text: string): Promise<SlackResult> {
  const body = await callSlack("chat.update", { channel, ts, blocks, text });
  return { ok: !!body.ok, error: body.error as string | undefined };
}

/** Open a modal from a trigger id. Best-effort. */
export async function openModal(triggerId: string, view: unknown): Promise<SlackResult> {
  const body = await callSlack("views.open", { trigger_id: triggerId, view });
  return { ok: !!body.ok, error: body.error as string | undefined };
}

/** Convenience: email → user → DM → post. Best-effort; ok:false if any step fails. */
export async function dmByEmail(email: string, blocks: unknown[], text: string): Promise<SlackResult> {
  if (!env.slack.botToken()) return { ok: false, error: "no_bot_token" };
  const userId = await lookupUserByEmail(email);
  if (!userId) return { ok: false, error: "user_not_found" };
  const dm = await openDM(userId);
  if (!dm) return { ok: false, error: "dm_open_failed" };
  return postToChannel(dm, blocks, text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/slack-api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/api.ts tests/slack-api.test.ts
git commit -m "feat(slack): best-effort Web API client (lookup, DM, post, modal)"
```

---

## Phase 2 — Agenda DM (Feature 1)

### Task 4: Agenda Block Kit builder

**Files:**
- Create: `lib/slack/blocks.ts`
- Test: `tests/slack-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/slack-blocks.test.ts
import { describe, it, expect } from "vitest";
import { buildAgendaBlocks } from "../lib/slack/blocks";

const agenda = {
  email: "grace@x.com",
  name: "Grace Hopper",
  anchorBookingId: "b1",
  eventName: "Build Bar NYC",
  eventDate: "2026-08-26",
  items: [
    { guestName: "Ada", slotName: "2:00 PM", slotStartsAt: "2026-08-26T18:00:00Z", challenge: "Roadmaps", role: "PM", company: "Acme" },
    { guestName: "Bo", slotName: "2:30 PM", slotStartsAt: "2026-08-26T18:30:00Z", challenge: "Databases", role: null, company: null },
  ],
};

describe("buildAgendaBlocks", () => {
  it("renders a header and one line per 1:1 with time, guest, challenge", () => {
    const json = JSON.stringify(buildAgendaBlocks(agenda));
    expect(json).toContain("Build Bar NYC");
    expect(json).toContain("Ada");
    expect(json).toContain("Roadmaps");
    expect(json).toContain("2:00 PM");
    expect(json).toContain("Bo");
    expect(json).toContain("Databases");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack-blocks.test.ts`
Expected: FAIL — cannot find module `../lib/slack/blocks`.

- [ ] **Step 3: Implement `buildAgendaBlocks` in `lib/slack/blocks.ts`**

```typescript
import type { ExpertAgenda } from "../events/agenda";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : isoDate;
}

/** DM blocks for one expert's day-of agenda. Pure. Mirrors the agenda email content. */
export function buildAgendaBlocks(a: ExpertAgenda): unknown[] {
  const when = shortDate(a.eventDate);
  const header = `📅 *Your Build Bar schedule today* — ${a.eventName ?? "Build Bar"}${when ? ` (${when})` : ""}`;
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: header } }, { type: "divider" }];
  for (const it of a.items) {
    const role = [it.role, it.company].filter(Boolean).join(" @ ");
    const lines = [
      `*${it.slotName ?? "—"}* · ${it.guestName}${role ? ` · ${role}` : ""}`,
      it.challenge ? `_${it.challenge}_` : null,
    ].filter(Boolean).join("\n");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: lines } });
  }
  return blocks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/slack-blocks.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/blocks.ts tests/slack-blocks.test.ts
git commit -m "feat(slack): agenda Block Kit builder"
```

---

### Task 5: Send the agenda DM alongside the email

**Files:**
- Modify: `lib/events/agenda.ts`

- [ ] **Step 1: Add imports and the additive DM**

At the top of `lib/events/agenda.ts`, add these imports after the existing import block:

```typescript
import { dmByEmail } from "../slack/api";
import { buildAgendaBlocks } from "../slack/blocks";
```

In `sendAgendasForEvent`, inside the `for (const a of agendas)` loop, add a best-effort DM at the very top of the loop body (before the `reserveCommsSlot` email gate) so a DM is attempted regardless of email dedup:

```typescript
  for (const a of agendas) {
    // Additive Slack DM (best-effort; email still sends below and is the source of truth).
    try {
      const dm = buildAgendaBlocks(a);
      await dmByEmail(a.email, dm, `Your Build Bar schedule today — ${a.eventName ?? "Build Bar"}`);
    } catch (err) {
      await logSync({ direction: "luma_in", result: "error", bookingId: a.anchorBookingId, action: "agenda_dm", note: err instanceof Error ? err.message : String(err) });
    }

    const firstName = (a.name.trim().split(/\s+/)[0] || "there");
    // ...existing email code unchanged...
```

- [ ] **Step 2: Verify existing agenda tests still pass + typecheck**

Run: `npx vitest run tests/agenda.test.ts && npm run typecheck`
Expected: PASS (3 tests), no type errors. (`buildAgendas` is unchanged; the DM path is only exercised in `sendAgendasForEvent`, which the pure tests don't call.)

- [ ] **Step 3: Commit**

```bash
git add lib/events/agenda.ts
git commit -m "feat(slack): DM day-of agenda alongside the email"
```

---

## Phase 3 — Claim confirmation DM (Feature 2)

### Task 6: Claim-confirm block builder + sender

**Files:**
- Modify: `lib/slack/blocks.ts`
- Create sender in: `lib/slack/api.ts` is not ideal (it's transport); put the sender in `lib/slack/notify.ts`
- Create: `lib/slack/notify.ts`
- Test: `tests/slack-blocks.test.ts` (extend)

- [ ] **Step 1: Write the failing test (extend blocks test)**

Append to `tests/slack-blocks.test.ts`:

```typescript
import { buildClaimConfirmBlocks } from "../lib/slack/blocks";

describe("buildClaimConfirmBlocks", () => {
  it("confirms the guest/slot and tells them to accept the calendar invite", () => {
    const json = JSON.stringify(buildClaimConfirmBlocks({
      guestName: "Ada", slotName: "2:00 PM", eventName: "Build Bar NYC", eventDate: "2026-08-26",
      cardUrl: "https://app.notion.com/abc",
    }));
    expect(json).toContain("Ada");
    expect(json).toContain("2:00 PM");
    expect(json).toContain("accept the calendar invite");
    expect(json).toContain("https://app.notion.com/abc");
  });

  it("omits the card link line when there is no URL", () => {
    const json = JSON.stringify(buildClaimConfirmBlocks({
      guestName: "Ada", slotName: "2:00 PM", eventName: null, eventDate: null, cardUrl: null,
    }));
    expect(json).not.toContain("Open your card");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack-blocks.test.ts`
Expected: FAIL — `buildClaimConfirmBlocks` is not exported.

- [ ] **Step 3: Implement `buildClaimConfirmBlocks` in `lib/slack/blocks.ts`**

Add to `lib/slack/blocks.ts`:

```typescript
export interface ClaimConfirmInput {
  guestName: string;
  slotName: string | null;
  eventName: string | null;
  eventDate: string | null;
  cardUrl: string | null;
}

/** DM blocks confirming a claim, including the "accept the calendar invite" nudge. Pure. */
export function buildClaimConfirmBlocks(i: ClaimConfirmInput): unknown[] {
  const when = [shortDate(i.eventDate), i.slotName].filter(Boolean).join(" · ");
  const ev = i.eventName ? ` · ${i.eventName}` : "";
  const lines = [
    `✅ *You're confirmed to help ${i.guestName}*${when ? ` at *${when}*` : ""}${ev}.`,
    `📅 *Please accept the calendar invite in your email* so the 1:1 lands on your calendar.`,
    i.cardUrl ? `<${i.cardUrl}|Open your card>` : null,
  ].filter(Boolean).join("\n");
  return [{ type: "section", text: { type: "mrkdwn", text: lines } }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/slack-blocks.test.ts`
Expected: PASS (agenda + 2 new).

- [ ] **Step 5: Implement the sender `lib/slack/notify.ts`**

```typescript
import { getBookingById, getBookingDetailsById } from "../db/bookings";
import { toCommsFields } from "../email/comms";
import { fetchCardUrl } from "./client";
import { dmByEmail } from "./api";
import { buildClaimConfirmBlocks } from "./blocks";
import { logSync } from "../sync/log";

/**
 * DM the expert a claim/assignment confirmation (best-effort; additive to the
 * `assigned` email). Prefers the card link matching where the booking is claimed:
 * ambassador card for an ambassador, dev card otherwise.
 */
export async function postClaimConfirmDM(bookingId: string): Promise<void> {
  try {
    const booking = await getBookingById(bookingId);
    if (!booking?.booked_by_email) return;
    const details = await getBookingDetailsById(bookingId);
    if (!details) return;
    const f = toCommsFields(details);
    const isAmbassador = booking.booked_by_type === "ambassador";
    const cardUrl = isAmbassador
      ? await fetchCardUrl("ambassador", booking.notion_ambassador_page_id)
      : await fetchCardUrl("dev", booking.notion_dev_page_id);
    const blocks = buildClaimConfirmBlocks({
      guestName: f.guestName,
      slotName: f.slotName,
      eventName: f.eventName,
      eventDate: f.eventDate,
      cardUrl,
    });
    await dmByEmail(booking.booked_by_email, blocks, `You're confirmed to help ${f.guestName}`);
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "claim_confirm_dm" });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "claim_confirm_dm", note: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `booking.booked_by_type` is not on the returned type, confirm the column name in `lib/db/bookings.ts`; the bookings row includes `booked_by_type` per the schema. Use `booking.booked_by_type` exactly.)

- [ ] **Step 7: Commit**

```bash
git add lib/slack/blocks.ts lib/slack/notify.ts tests/slack-blocks.test.ts
git commit -m "feat(slack): claim confirmation DM with calendar-invite nudge"
```

---

### Task 7: Wire the claim-confirm DM into the webhook

**Files:**
- Modify: `app/api/webhooks/notion/[workspace]/route.ts`

- [ ] **Step 1: Add the import**

Add to the imports (next to the existing `postSlackRecruit, postSlackClaimed` import on line 30):

```typescript
import { postClaimConfirmDM } from "@/lib/slack/notify";
```

- [ ] **Step 2: Call it at all three `assigned` sites**

There are three places that send the `assigned` email (verify with `grep -n 'sendBookingComms(.*"assigned")' app/api/webhooks/notion/\[workspace\]/route.ts`). Immediately after each `await sendBookingComms(<id>, "assigned");`, add:

```typescript
      await postClaimConfirmDM(<id>);
```

Concretely:
- After line ~202 `await sendBookingComms(updated.id, "assigned");` → `await postClaimConfirmDM(updated.id);`
- After line ~259 `await sendBookingComms(updated.id, "assigned");` → `await postClaimConfirmDM(updated.id);`
- After line ~322 `await sendBookingComms(claim.booking.id, "assigned");` → `await postClaimConfirmDM(claim.booking.id);`

- [ ] **Step 3: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; existing suite green (the webhook route has no unit test; `postClaimConfirmDM` is best-effort and no-ops without a bot token).

- [ ] **Step 4: Commit**

```bash
git add "app/api/webhooks/notion/[workspace]/route.ts"
git commit -m "feat(slack): DM expert on claim/reassign confirmation"
```

---

## Phase 4 — Recruit posts via bot (Feature 3)

### Task 8: Migration — `slack_channels.channel_id`

**Files:**
- Create: `supabase/migrations/0039_slack_channels_channel_id.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- 0039_slack_channels_channel_id.sql
-- Bot posting (chat.postMessage) targets a channel id; when present it is
-- preferred over the incoming webhook. Nullable so webhook-only cities still work.
alter table slack_channels add column if not exists channel_id text;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name `slack_channels_channel_id`) or `supabase db push`. Confirm the column exists.

- [ ] **Step 3: Regenerate types**

Run: `npm run gen:types`
Expected: `lib/supabase/types.ts` now shows `channel_id: string | null` on the `slack_channels` Row/Insert/Update.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0039_slack_channels_channel_id.sql lib/supabase/types.ts
git commit -m "feat(slack): add channel_id to slack_channels"
```

---

### Task 9: Carry `channel_id` in the DB access layer

**Files:**
- Modify: `lib/db/slack.ts`

- [ ] **Step 1: Extend the read/return shapes**

In `lib/db/slack.ts`:

1. Add `channelId` to `SlackChannel`:

```typescript
export interface SlackChannel {
  webhookUrl: string;
  channelName: string | null;
  channelId: string | null;
}
```

2. In `getSlackChannelForCity`, select and return `channel_id`:

```typescript
  const { data } = await supabase.from("slack_channels").select("webhook_url, channel_name, channel_id, city, aliases");
  const match = (data ?? []).find((row) => {
    const names = [row.city, ...(row.aliases ?? [])].map((n) => (n ?? "").trim().toLowerCase());
    return names.includes(needle);
  });
  if (!match) return null;
  return { webhookUrl: match.webhook_url, channelName: match.channel_name, channelId: match.channel_id ?? null };
```

Note: the guard changes from `if (!match?.webhook_url)` to `if (!match)` because a bot-only city may have a `channel_id` and no webhook.

3. Add `channelId` to `SlackChannelRow` and include it in `listSlackChannels` + `upsertSlackChannel`:

```typescript
export interface SlackChannelRow {
  city: string;
  channelName: string | null;
  aliases: string[];
  webhookUrl: string;
  channelId: string | null;
}
```

In `listSlackChannels` add `channel_id` to the select and map `channelId: r.channel_id ?? null`. In `upsertSlackChannel` add `channelId: string | null` to the input and write `channel_id: input.channelId` in the upsert payload.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: type errors at the `upsertSlackChannel` call site in `app/api/hub/slack/route.ts` (it doesn't pass `channelId`). Fix that call to pass `channelId: body.channelId ?? null` (read from the request body). Re-run typecheck → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/db/slack.ts "app/api/hub/slack/route.ts"
git commit -m "feat(slack): thread channel_id through db access + hub api"
```

---

### Task 10: Prefer bot channel post, fall back to webhook

**Files:**
- Modify: `lib/slack/client.ts`

- [ ] **Step 1: Add a channel-or-webhook post helper**

In `lib/slack/client.ts`, add the import at the top:

```typescript
import { postToChannel } from "./api";
```

Replace `postBlocks` usage in `postSlackRecruit` / `postSlackClaimed` with a helper that prefers the bot. Add this function near `postBlocks`:

```typescript
/**
 * Post to a city channel, preferring the bot (chat.postMessage by channel id) when
 * a channel_id is configured, else the incoming webhook. Throws on hard failure so
 * the caller's try/catch logs it.
 */
async function postToCityChannel(
  channel: { webhookUrl: string; channelId: string | null; channelName: string | null },
  blocks: unknown[],
  fallbackText: string,
): Promise<void> {
  if (channel.channelId) {
    const res = await postToChannel(channel.channelId, blocks, fallbackText);
    if (res.ok) return;
    // fall through to webhook if the bot post failed and a webhook exists
  }
  if (channel.webhookUrl) {
    await postBlocks(channel.webhookUrl, blocks);
    return;
  }
  throw new Error("no channel_id or webhook_url for city");
}
```

- [ ] **Step 2: Use it in both posters**

In `postSlackRecruit`, replace:

```typescript
    await postBlocks(channel.webhookUrl, blocks);
```

with:

```typescript
    await postToCityChannel(channel, blocks, "A 1:1 slot just opened up — can anyone cover it?");
```

In `postSlackClaimed`, replace:

```typescript
    await postBlocks(channel.webhookUrl, blocks);
```

with:

```typescript
    await postToCityChannel(channel, blocks, "A recruited 1:1 slot was covered.");
```

- [ ] **Step 3: Verify existing slack tests + typecheck**

Run: `npx vitest run tests/slack.test.ts && npm run typecheck`
Expected: PASS (pure block builders unchanged); no type errors. `getSlackChannelForCity` now returns `channelId`, satisfying `postToCityChannel`'s parameter.

- [ ] **Step 4: Commit**

```bash
git add lib/slack/client.ts
git commit -m "feat(slack): recruit/covered posts prefer bot channel, webhook fallback"
```

---

## Phase 5 — Expert feedback capture (Feature 4)

### Task 11: Migration — `expert_feedback` table

**Files:**
- Create: `supabase/migrations/0038_expert_feedback.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

> Note: file is numbered 0038 but may be applied after 0039 from Task 8; ordering across these two independent DDLs does not matter.

- [ ] **Step 1: Write the migration**

```sql
-- 0038_expert_feedback.sql
-- Expert-facing post-event feedback, one row per 1:1 (booking). One-way synced to a
-- Dev Notion database. Rows are created (answers null) when the feedback DM is sent;
-- the presence of rows for an (event_id, expert_email) means "already prompted".
create table if not exists expert_feedback (
  booking_id uuid primary key references bookings(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  expert_email text not null,
  expert_name text,
  guest_name text,
  guest_email text,
  attended boolean,
  rating int check (rating between 1 and 5),
  note text,
  responded_at timestamptz,
  notion_dev_page_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expert_feedback_event_expert_idx
  on expert_feedback (event_id, lower(expert_email));
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name `expert_feedback`) or `supabase db push`. Confirm the table exists.

- [ ] **Step 3: Regenerate types**

Run: `npm run gen:types`
Expected: `expert_feedback` appears in `lib/supabase/types.ts`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0038_expert_feedback.sql lib/supabase/types.ts
git commit -m "feat(feedback): expert_feedback table"
```

---

### Task 12: Expert-feedback DB access + pure `buildAnswerPatch`

**Files:**
- Create: `lib/db/expert-feedback.ts`
- Test: `tests/expert-feedback-db.test.ts`

- [ ] **Step 1: Write the failing test (pure patch logic)**

```typescript
// tests/expert-feedback-db.test.ts
import { describe, it, expect } from "vitest";
import { buildAnswerPatch } from "../lib/db/expert-feedback";

describe("buildAnswerPatch", () => {
  it("stamps responded_at on the first answer", () => {
    const patch = buildAnswerPatch({ attended: true }, null, "2026-08-26T22:00:00Z");
    expect(patch.attended).toBe(true);
    expect(patch.responded_at).toBe("2026-08-26T22:00:00Z");
    expect(patch.updated_at).toBe("2026-08-26T22:00:00Z");
  });

  it("does NOT overwrite an existing responded_at", () => {
    const patch = buildAnswerPatch({ rating: 5 }, "2026-08-26T21:00:00Z", "2026-08-26T22:00:00Z");
    expect(patch.rating).toBe(5);
    expect(patch.responded_at).toBeUndefined(); // unchanged
    expect(patch.updated_at).toBe("2026-08-26T22:00:00Z");
  });

  it("passes through only provided fields", () => {
    const patch = buildAnswerPatch({ note: "great chat" }, "2026-08-26T21:00:00Z", "2026-08-26T22:00:00Z");
    expect(patch).toMatchObject({ note: "great chat" });
    expect("attended" in patch).toBe(false);
    expect("rating" in patch).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/expert-feedback-db.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/db/expert-feedback.ts`**

```typescript
import { getAdminClient } from "../supabase/admin";

export interface FeedbackRowInput {
  bookingId: string;
  eventId: string | null;
  expertEmail: string;
  expertName: string | null;
  guestName: string | null;
  guestEmail: string | null;
}

export interface AnswerInput {
  attended?: boolean;
  rating?: number;
  note?: string;
}

export interface AnswerPatch {
  attended?: boolean;
  rating?: number;
  note?: string;
  responded_at?: string;
  updated_at: string;
}

/**
 * Pure: build the DB patch for one answer. Stamps responded_at ONLY when there
 * isn't one yet (first answer wins the timestamp). Always bumps updated_at.
 */
export function buildAnswerPatch(answer: AnswerInput, existingRespondedAt: string | null, nowIso: string): AnswerPatch {
  const patch: AnswerPatch = { updated_at: nowIso };
  if (answer.attended !== undefined) patch.attended = answer.attended;
  if (answer.rating !== undefined) patch.rating = answer.rating;
  if (answer.note !== undefined) patch.note = answer.note;
  if (!existingRespondedAt) patch.responded_at = nowIso;
  return patch;
}

/** Insert one row per booking when the DM is sent. Idempotent (skips existing PKs). */
export async function createFeedbackRows(rows: FeedbackRowInput[]): Promise<void> {
  if (!rows.length) return;
  await getAdminClient()
    .from("expert_feedback")
    .upsert(
      rows.map((r) => ({
        booking_id: r.bookingId,
        event_id: r.eventId,
        expert_email: r.expertEmail,
        expert_name: r.expertName,
        guest_name: r.guestName,
        guest_email: r.guestEmail,
      })),
      { onConflict: "booking_id", ignoreDuplicates: true },
    );
}

/** True if we've already created feedback rows for this (event, expert). Dedup guard. */
export async function hasFeedbackRows(eventId: string, expertEmail: string): Promise<boolean> {
  const { data } = await getAdminClient()
    .from("expert_feedback")
    .select("booking_id")
    .eq("event_id", eventId)
    .ilike("expert_email", expertEmail)
    .limit(1);
  return (data ?? []).length > 0;
}

/** Apply one answer to a booking's feedback row. Returns nothing; best-effort caller. */
export async function upsertFeedbackAnswer(bookingId: string, answer: AnswerInput): Promise<void> {
  const supabase = getAdminClient();
  const { data: existing } = await supabase
    .from("expert_feedback")
    .select("responded_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const patch = buildAnswerPatch(answer, existing?.responded_at ?? null, new Date().toISOString());
  await supabase.from("expert_feedback").update(patch).eq("booking_id", bookingId);
}

export interface ExpertFeedbackRow {
  booking_id: string;
  event_id: string | null;
  expert_email: string;
  expert_name: string | null;
  guest_name: string | null;
  guest_email: string | null;
  attended: boolean | null;
  rating: number | null;
  note: string | null;
  responded_at: string | null;
  notion_dev_page_id: string | null;
}

/** Read a single feedback row (for the Notion push). */
export async function getFeedbackRow(bookingId: string): Promise<ExpertFeedbackRow | null> {
  const { data } = await getAdminClient().from("expert_feedback").select("*").eq("booking_id", bookingId).maybeSingle();
  return (data as ExpertFeedbackRow | null) ?? null;
}

/** Store the Notion page id after the first push (idempotency for subsequent updates). */
export async function setFeedbackNotionPageId(bookingId: string, pageId: string): Promise<void> {
  await getAdminClient().from("expert_feedback").update({ notion_dev_page_id: pageId }).eq("booking_id", bookingId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/expert-feedback-db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/expert-feedback.ts tests/expert-feedback-db.test.ts
git commit -m "feat(feedback): expert_feedback db access + pure answer patch"
```

---

### Task 13: Feedback prompt grouping + block builder

**Files:**
- Create: `lib/events/expert-feedback.ts` (grouping only in this task)
- Modify: `lib/slack/blocks.ts` (feedback blocks)
- Test: `tests/expert-feedback-prompts.test.ts`, extend `tests/slack-blocks.test.ts`

- [ ] **Step 1: Write the failing grouping test**

```typescript
// tests/expert-feedback-prompts.test.ts
import { describe, it, expect } from "vitest";
import { buildFeedbackPrompts } from "../lib/events/expert-feedback";

const row = (over: Record<string, unknown>) => ({
  id: "b1", guest_name: "Ada", guest_email: "ada@x.com", challenge: "Roadmaps",
  slot_name: "2:00 PM", slot_starts_at: "2026-08-26T18:00:00Z",
  booked_by_email: "grace@x.com", booked_by_display_name: "Grace Hopper",
  status: "checked_in", event_id: "e1", event_name: "NYC", event_date: "2026-08-26", ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe("buildFeedbackPrompts", () => {
  it("groups by expert, keeps booking ids, ignores unclaimed/cancelled/no-show", () => {
    const prompts = buildFeedbackPrompts([
      row({ id: "b1", booked_by_email: "grace@x.com" }),
      row({ id: "b2", booked_by_email: "grace@x.com", guest_name: "Bo", status: "assigned" }),
      row({ id: "b3", booked_by_email: null }),
      row({ id: "b4", booked_by_email: "grace@x.com", status: "no_show" }),
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].email).toBe("grace@x.com");
    expect(prompts[0].items.map((i) => i.bookingId)).toEqual(["b1", "b2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/expert-feedback-prompts.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement grouping in `lib/events/expert-feedback.ts`**

```typescript
export interface FeedbackDetailRow {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  challenge: string | null;
  slot_name: string | null;
  slot_starts_at: string | null;
  booked_by_email: string | null;
  booked_by_display_name: string | null;
  status: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
}

export interface FeedbackItem {
  bookingId: string;
  guestName: string;
  guestEmail: string | null;
  slotName: string | null;
  challenge: string | null;
}

export interface ExpertFeedbackPrompt {
  email: string;
  name: string;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  items: FeedbackItem[];
}

/** Pure: group an event's completed 1:1s into one feedback prompt per expert. Keeps
 * booking ids so each interaction maps back to a row. Only assigned/checked_in. */
export function buildFeedbackPrompts(rows: FeedbackDetailRow[]): ExpertFeedbackPrompt[] {
  const byEmail = new Map<string, ExpertFeedbackPrompt>();
  for (const r of rows) {
    if (!r.booked_by_email) continue;
    if (r.status !== "assigned" && r.status !== "checked_in") continue;
    const key = r.booked_by_email.trim().toLowerCase();
    const p =
      byEmail.get(key) ??
      {
        email: r.booked_by_email,
        name: r.booked_by_display_name ?? "there",
        eventId: r.event_id,
        eventName: r.event_name,
        eventDate: r.event_date,
        items: [] as FeedbackItem[],
      };
    p.items.push({
      bookingId: r.id,
      guestName: r.guest_name ?? "Guest",
      guestEmail: r.guest_email,
      slotName: r.slot_name,
      challenge: r.challenge,
    });
    byEmail.set(key, p);
  }
  for (const p of byEmail.values()) {
    p.items.sort((a, b) => (a.slotName ?? "").localeCompare(b.slotName ?? ""));
  }
  return [...byEmail.values()];
}
```

- [ ] **Step 4: Run grouping test to verify it passes**

Run: `npx vitest run tests/expert-feedback-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing feedback-blocks test (extend slack-blocks)**

Append to `tests/slack-blocks.test.ts`:

```typescript
import { buildFeedbackBlocks } from "../lib/slack/blocks";

describe("buildFeedbackBlocks", () => {
  const prompt = {
    email: "grace@x.com", name: "Grace", eventId: "e1", eventName: "NYC", eventDate: "2026-08-26",
    items: [
      { bookingId: "b1", guestName: "Ada", guestEmail: "ada@x.com", slotName: "2:00 PM", challenge: "Roadmaps" },
      { bookingId: "b2", guestName: "Bo", guestEmail: null, slotName: "2:30 PM", challenge: null },
    ],
  };

  it("renders a row per 1:1 with attendance buttons, rating select, and note button carrying the booking id", () => {
    const blocks = buildFeedbackBlocks(prompt) as Array<{ type: string; elements?: Array<{ action_id?: string; value?: string }> }>;
    const actionBlocks = blocks.filter((b) => b.type === "actions");
    expect(actionBlocks).toHaveLength(2); // one per 1:1
    const first = actionBlocks[0].elements ?? [];
    const ids = first.map((e) => e.action_id);
    expect(ids).toContain("fb_attend");
    expect(ids).toContain("fb_rating");
    expect(ids).toContain("fb_note");
    // attendance/note carry booking id in value; note = bare id, attend = id:yes / id:no
    const attendValues = first.filter((e) => e.action_id === "fb_attend").map((e) => e.value);
    expect(attendValues).toEqual(["b1:yes", "b1:no"]);
    expect(first.find((e) => e.action_id === "fb_note")?.value).toBe("b1");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/slack-blocks.test.ts`
Expected: FAIL — `buildFeedbackBlocks` not exported.

- [ ] **Step 7: Implement `buildFeedbackBlocks` in `lib/slack/blocks.ts`**

Add these imports/exports to `lib/slack/blocks.ts`:

```typescript
import type { ExpertFeedbackPrompt } from "../events/expert-feedback";

/** DM blocks: one message per expert, one interactive row per 1:1. Pure.
 * action_ids: fb_attend (value `${id}:yes|no`), fb_rating (select option value
 * `${id}:${n}`), fb_note (value `${id}`, opens a modal). */
export function buildFeedbackBlocks(p: ExpertFeedbackPrompt): unknown[] {
  const when = shortDate(p.eventDate);
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `🙌 *How did your Build Bar 1:1s go?* — ${p.eventName ?? "Build Bar"}${when ? ` (${when})` : ""}\nTap for each guest — every tap saves.` } },
    { type: "divider" },
  ];
  for (const it of p.items) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${it.guestName}*${it.slotName ? ` · ${it.slotName}` : ""}${it.challenge ? `\n_${it.challenge}_` : ""}` },
    });
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", action_id: "fb_attend", text: { type: "plain_text", text: "✅ Showed up", emoji: true }, value: `${it.bookingId}:yes`, style: "primary" },
        { type: "button", action_id: "fb_attend", text: { type: "plain_text", text: "🚫 No-show", emoji: true }, value: `${it.bookingId}:no` },
        {
          type: "static_select",
          action_id: "fb_rating",
          placeholder: { type: "plain_text", text: "Rating", emoji: true },
          options: [1, 2, 3, 4, 5].map((n) => ({ text: { type: "plain_text", text: String(n) }, value: `${it.bookingId}:${n}` })),
        },
        { type: "button", action_id: "fb_note", text: { type: "plain_text", text: "📝 Note", emoji: true }, value: it.bookingId },
      ],
    });
  }
  return blocks;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/slack-blocks.test.ts && npx vitest run tests/expert-feedback-prompts.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/events/expert-feedback.ts lib/slack/blocks.ts tests/expert-feedback-prompts.test.ts tests/slack-blocks.test.ts
git commit -m "feat(feedback): prompt grouping + interactive feedback blocks"
```

---

### Task 14: Send feedback DMs for ended events

**Files:**
- Modify: `lib/events/expert-feedback.ts` (add sender + ended-event selection)
- Test: extend `tests/expert-feedback-prompts.test.ts`

- [ ] **Step 1: Write the failing selection test**

Append to `tests/expert-feedback-prompts.test.ts`:

```typescript
import { lastSlotEndedHoursAgo } from "../lib/events/expert-feedback";

describe("lastSlotEndedHoursAgo", () => {
  const now = new Date("2026-08-26T23:00:00Z");
  it("true when the latest slot ended >= threshold hours ago", () => {
    // slot ends 20:30Z → 2.5h before now
    expect(lastSlotEndedHoursAgo(["2026-08-26T20:00:00Z"], 30, 2, now)).toBe(true);
  });
  it("false when the latest slot is too recent", () => {
    // slot ends 22:30Z → 0.5h before now
    expect(lastSlotEndedHoursAgo(["2026-08-26T22:00:00Z"], 30, 2, now)).toBe(false);
  });
  it("false when there are no slots", () => {
    expect(lastSlotEndedHoursAgo([], 30, 2, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/expert-feedback-prompts.test.ts`
Expected: FAIL — `lastSlotEndedHoursAgo` not exported.

- [ ] **Step 3: Implement the selection helper + sender**

Add to `lib/events/expert-feedback.ts`:

```typescript
import { getAdminClient } from "../supabase/admin";
import { dmByEmail } from "../slack/api";
import { buildFeedbackBlocks } from "../slack/blocks";
import { createFeedbackRows, hasFeedbackRows } from "../db/expert-feedback";
import { logSync } from "../sync/log";

/** Pure: has the latest slot's END (start + slotMinutes) passed at least
 * thresholdHours before `now`? slotStartsAt values are ISO strings. */
export function lastSlotEndedHoursAgo(slotStartsAt: string[], slotMinutes: number, thresholdHours: number, now: Date): boolean {
  const ends = slotStartsAt
    .map((s) => Date.parse(s))
    .filter((n) => Number.isFinite(n))
    .map((n) => n + slotMinutes * 60_000);
  if (!ends.length) return false;
  const latestEnd = Math.max(...ends);
  return now.getTime() - latestEnd >= thresholdHours * 3_600_000;
}

/** Send the feedback DM for one event: build prompts, create rows, DM each expert.
 * Idempotent per (event, expert) via hasFeedbackRows. Returns experts prompted. */
export async function sendFeedbackForEvent(eventId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data } = await supabase
    .from("booking_details")
    .select("id, guest_name, guest_email, challenge, slot_name, slot_starts_at, booked_by_email, booked_by_display_name, status, event_id, event_name, event_date")
    .eq("event_id", eventId);
  const prompts = buildFeedbackPrompts((data ?? []) as FeedbackDetailRow[]);
  let prompted = 0;
  for (const p of prompts) {
    if (await hasFeedbackRows(eventId, p.email)) continue; // already prompted
    await createFeedbackRows(
      p.items.map((it) => ({
        bookingId: it.bookingId,
        eventId: p.eventId,
        expertEmail: p.email,
        expertName: p.name,
        guestName: it.guestName,
        guestEmail: it.guestEmail,
      })),
    );
    try {
      await dmByEmail(p.email, buildFeedbackBlocks(p), `How did your ${p.eventName ?? "Build Bar"} 1:1s go?`);
      prompted++;
    } catch (err) {
      await logSync({ direction: "luma_in", result: "error", action: "expert_feedback_dm", note: err instanceof Error ? err.message : String(err) });
    }
  }
  return prompted;
}

/**
 * Send feedback DMs for every event whose last slot ended >= 2h ago and hasn't
 * been prompted yet. Uses slot rows to compute the end. Returns counts.
 */
export async function sendFeedbackForEndedEvents(now: Date = new Date()): Promise<{ events: number; experts: number }> {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data: events } = await supabase
    .from("events")
    .select("id, status, event_date")
    .in("event_date", [today, yesterday])
    .neq("status", "cancelled");
  let eventsPrompted = 0;
  let experts = 0;
  for (const ev of (events ?? []) as Array<{ id: string; event_date: string }>) {
    const { data: slots } = await supabase.from("slots").select("starts_at, duration_minutes").eq("event_id", ev.id);
    const starts = (slots ?? []).map((s: { starts_at: string }) => s.starts_at);
    const minutes = (slots?.[0]?.duration_minutes as number | undefined) ?? 30;
    if (!lastSlotEndedHoursAgo(starts, minutes, 2, now)) continue;
    const n = await sendFeedbackForEvent(ev.id);
    if (n > 0) { eventsPrompted++; experts += n; }
  }
  return { events: eventsPrompted, experts };
}
```

> Note on `duration_minutes`: confirm the slots column name via `grep -n "duration" lib/supabase/types.ts`. If slots store an explicit `ends_at`, prefer that: select `ends_at` and pass it directly (adjust `lastSlotEndedHoursAgo` to take end times). Use whichever exists; do not invent a column.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/expert-feedback-prompts.test.ts`
Expected: PASS (grouping + 3 selection tests).

- [ ] **Step 5: Commit**

```bash
git add lib/events/expert-feedback.ts tests/expert-feedback-prompts.test.ts
git commit -m "feat(feedback): send feedback DMs for ended events (idempotent)"
```

---

### Task 15: Cron endpoint for expert feedback

**Files:**
- Create: `app/api/cron/expert-feedback/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Implement the cron route (mirror the agenda cron)**

```typescript
// app/api/cron/expert-feedback/route.ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendFeedbackForEndedEvents } from "@/lib/events/expert-feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly. DMs each expert an interactive feedback prompt for events whose last
 * slot ended >= 2h ago. Idempotent per (event, expert): rows already created =
 * skip. Safe to fire repeatedly.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { events, experts } = await sendFeedbackForEndedEvents();
  await logSync({ direction: "luma_in", result: "applied", action: "expert_feedback_cron", note: `events=${events} experts=${experts}` });
  return NextResponse.json({ events, experts });
}

export const GET = POST;
```

- [ ] **Step 2: Add the cron to `vercel.json`**

Add this entry to the `crons` array in `vercel.json`:

```json
{ "path": "/api/cron/expert-feedback", "schedule": "0 * * * *" }
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/api/cron/expert-feedback/route.ts" vercel.json
git commit -m "feat(feedback): hourly expert-feedback cron"
```

---

### Task 16: Interactivity payload parser (pure)

**Files:**
- Create: `lib/slack/interaction.ts`
- Test: `tests/slack-interactivity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/slack-interactivity.test.ts
import { describe, it, expect } from "vitest";
import { parseInteraction } from "../lib/slack/interaction";

describe("parseInteraction", () => {
  it("parses an attendance button click", () => {
    const payload = {
      type: "block_actions",
      actions: [{ action_id: "fb_attend", value: "b1:no" }],
      container: { channel_id: "D1", message_ts: "9.9" },
    };
    expect(parseInteraction(payload)).toEqual({ kind: "attend", bookingId: "b1", attended: false, channel: "D1", ts: "9.9" });
  });

  it("parses a rating select", () => {
    const payload = {
      type: "block_actions",
      actions: [{ action_id: "fb_rating", selected_option: { value: "b2:4" } }],
      container: { channel_id: "D1", message_ts: "9.9" },
    };
    expect(parseInteraction(payload)).toEqual({ kind: "rating", bookingId: "b2", rating: 4, channel: "D1", ts: "9.9" });
  });

  it("parses a note button (opens modal)", () => {
    const payload = {
      type: "block_actions",
      actions: [{ action_id: "fb_note", value: "b3" }],
      trigger_id: "T1",
    };
    expect(parseInteraction(payload)).toEqual({ kind: "note_open", bookingId: "b3", triggerId: "T1" });
  });

  it("parses a note modal submission", () => {
    const payload = {
      type: "view_submission",
      view: {
        private_metadata: "b4",
        state: { values: { note_block: { note_input: { value: "wonderful session" } } } },
      },
    };
    expect(parseInteraction(payload)).toEqual({ kind: "note_submit", bookingId: "b4", note: "wonderful session" });
  });

  it("returns ignore for unknown actions", () => {
    expect(parseInteraction({ type: "block_actions", actions: [{ action_id: "other" }] })).toEqual({ kind: "ignore" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack-interactivity.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/slack/interaction.ts`**

```typescript
export type Interaction =
  | { kind: "attend"; bookingId: string; attended: boolean; channel?: string; ts?: string }
  | { kind: "rating"; bookingId: string; rating: number; channel?: string; ts?: string }
  | { kind: "note_open"; bookingId: string; triggerId: string }
  | { kind: "note_submit"; bookingId: string; note: string }
  | { kind: "ignore" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = any;

/** Pure: turn a parsed Slack interactivity payload into a typed Interaction. */
export function parseInteraction(payload: Payload): Interaction {
  if (payload?.type === "view_submission") {
    const bookingId = payload.view?.private_metadata as string | undefined;
    const note = payload.view?.state?.values?.note_block?.note_input?.value as string | undefined;
    if (bookingId) return { kind: "note_submit", bookingId, note: note ?? "" };
    return { kind: "ignore" };
  }
  if (payload?.type === "block_actions") {
    const action = payload.actions?.[0];
    const channel = payload.container?.channel_id as string | undefined;
    const ts = payload.container?.message_ts as string | undefined;
    if (action?.action_id === "fb_attend") {
      const [bookingId, yn] = String(action.value ?? "").split(":");
      if (bookingId) return { kind: "attend", bookingId, attended: yn === "yes", channel, ts };
    }
    if (action?.action_id === "fb_rating") {
      const [bookingId, n] = String(action.selected_option?.value ?? "").split(":");
      if (bookingId) return { kind: "rating", bookingId, rating: Number(n), channel, ts };
    }
    if (action?.action_id === "fb_note") {
      const bookingId = String(action.value ?? "");
      if (bookingId) return { kind: "note_open", bookingId, triggerId: payload.trigger_id as string };
    }
  }
  return { kind: "ignore" };
}

/** The modal opened by the 📝 Note button. `bookingId` rides in private_metadata. */
export function noteModalView(bookingId: string): unknown {
  return {
    type: "modal",
    private_metadata: bookingId,
    title: { type: "plain_text", text: "Add a note" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "note_block",
        label: { type: "plain_text", text: "How did it go?" },
        element: { type: "plain_text_input", action_id: "note_input", multiline: true },
        optional: true,
      },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/slack-interactivity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/interaction.ts tests/slack-interactivity.test.ts
git commit -m "feat(feedback): pure interactivity payload parser + note modal view"
```

---

### Task 17: Interactivity endpoint route

**Files:**
- Create: `app/api/slack/interactivity/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/slack/interactivity/route.ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifySlackSignature } from "@/lib/slack/verify";
import { parseInteraction, noteModalView } from "@/lib/slack/interaction";
import { openModal } from "@/lib/slack/api";
import { upsertFeedbackAnswer } from "@/lib/db/expert-feedback";
import { pushExpertFeedback } from "@/lib/notion/expert-feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";

/**
 * Slack interactivity endpoint (Request URL in the app config). Verifies the
 * signature, parses the payload, persists the answer, and best-effort pushes to
 * Notion. Acks fast; Slack requires a 200 within 3s. Note-button clicks open a
 * modal via views.open (needs trigger_id, so it happens before the ack returns).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifySlackSignature(
    raw,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
    env.slack.signingSecret(),
  );
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  // Body is application/x-www-form-urlencoded with a single `payload` field.
  const params = new URLSearchParams(raw);
  let payload: unknown;
  try {
    payload = JSON.parse(params.get("payload") ?? "{}");
  } catch {
    return NextResponse.json({ ok: true }); // ignore unparseable
  }

  const interaction = parseInteraction(payload);

  try {
    switch (interaction.kind) {
      case "attend":
        await upsertFeedbackAnswer(interaction.bookingId, { attended: interaction.attended });
        void pushExpertFeedback(interaction.bookingId);
        break;
      case "rating":
        await upsertFeedbackAnswer(interaction.bookingId, { rating: interaction.rating });
        void pushExpertFeedback(interaction.bookingId);
        break;
      case "note_open":
        await openModal(interaction.triggerId, noteModalView(interaction.bookingId));
        break;
      case "note_submit":
        await upsertFeedbackAnswer(interaction.bookingId, { note: interaction.note });
        void pushExpertFeedback(interaction.bookingId);
        break;
      case "ignore":
        break;
    }
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", action: "slack_interactivity", note: err instanceof Error ? err.message : String(err) });
  }

  // view_submission must return an empty 200 to close the modal; others too.
  return NextResponse.json({});
}
```

- [ ] **Step 2: Confirm the route is public (middleware already excludes `/api/*`)**

Verify: `middleware.ts` matcher excludes `api`. No change needed. Confirm with `grep -n "api" middleware.ts`.

- [ ] **Step 3: Verify typecheck (will fail until Task 18 creates `pushExpertFeedback`)**

Run: `npm run typecheck`
Expected: error — `@/lib/notion/expert-feedback` not found. This is expected; Task 18 creates it. Do NOT commit yet; proceed to Task 18, then typecheck+commit together.

---

### Task 18: Notion one-way sync for expert feedback

**Files:**
- Create: `lib/notion/expert-feedback.ts`
- Test: `tests/expert-feedback-notion.test.ts`

- [ ] **Step 1: Write the failing mapper test**

```typescript
// tests/expert-feedback-notion.test.ts
import { describe, it, expect } from "vitest";
import { expertFeedbackProperties } from "../lib/notion/expert-feedback";

describe("expertFeedbackProperties", () => {
  it("maps a fully-answered row to Notion properties", () => {
    const props = expertFeedbackProperties({
      booking_id: "b1", event_id: "e1",
      expert_email: "grace@x.com", expert_name: "Grace Hopper",
      guest_name: "Ada", guest_email: "ada@x.com",
      attended: true, rating: 5, note: "great chat",
      responded_at: "2026-08-26T22:00:00Z", notion_dev_page_id: null,
      slot_name: "2:00 PM", event_name: "NYC", event_date: "2026-08-26", location: "New York",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const json = JSON.stringify(props);
    expect(json).toContain("Grace Hopper");
    expect(json).toContain("great chat");
    expect(json).toContain("Showed up");
    expect((props["Rating"] as { number: number }).number).toBe(5);
    expect((props["Booking ID"] as { rich_text: Array<{ text: { content: string } }> }).rich_text[0].text.content).toBe("b1");
  });

  it("renders No-show and omits rating when null", () => {
    const props = expertFeedbackProperties({
      booking_id: "b2", event_id: "e1", expert_email: "g@x.com", expert_name: "G",
      guest_name: "Bo", guest_email: null, attended: false, rating: null, note: null,
      responded_at: null, notion_dev_page_id: null, slot_name: null, event_name: null, event_date: null, location: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect((props["Attended"] as { select: { name: string } | null }).select?.name).toBe("No-show");
    expect((props["Rating"] as { number: number | null }).number).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/expert-feedback-notion.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/notion/expert-feedback.ts`**

```typescript
import { getNotionClient } from "./client";
import { env } from "../env";
import { getFeedbackRow, setFeedbackNotionPageId } from "../db/expert-feedback";
import { logSync } from "../sync/log";

/** Property names on the Dev "Expert Feedback" database. Must match the DB schema
 * (configure with scripts/configure-expert-feedback-db.ts). */
export const EF = {
  expert: "Expert",
  expertEmail: "Expert email",
  guest: "Guest",
  guestEmail: "Guest email",
  eventDate: "Event Date",
  location: "Location",
  event: "Event",
  slot: "Slot",
  attended: "Attended",
  rating: "Rating",
  note: "Note",
  respondedAt: "Responded at",
  bookingId: "Booking ID",
} as const;

type Props = Record<string, unknown>;

function rich(text: string | null): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return { rich_text: text ? [{ type: "text", text: { content: text.slice(0, 2000) } }] : [] };
}

/** Row shape passed to the mapper (feedback row joined with event/slot context). */
export interface ExpertFeedbackNotionRow {
  booking_id: string;
  expert_name: string | null;
  expert_email: string;
  guest_name: string | null;
  guest_email: string | null;
  event_date: string | null;
  location: string | null;
  event_name: string | null;
  slot_name: string | null;
  attended: boolean | null;
  rating: number | null;
  note: string | null;
  responded_at: string | null;
}

/** Pure: map a feedback row to Dev Notion database properties. */
export function expertFeedbackProperties(r: ExpertFeedbackNotionRow): Props {
  const attended = r.attended === null ? null : r.attended ? "Showed up" : "No-show";
  return {
    [EF.expert]: { title: r.expert_name ? [{ type: "text", text: { content: r.expert_name.slice(0, 2000) } }] : [] },
    [EF.expertEmail]: rich(r.expert_email),
    [EF.guest]: rich(r.guest_name),
    [EF.guestEmail]: rich(r.guest_email),
    [EF.eventDate]: { date: r.event_date ? { start: r.event_date } : null },
    [EF.location]: rich(r.location),
    [EF.event]: rich(r.event_name),
    [EF.slot]: rich(r.slot_name),
    [EF.attended]: { select: attended ? { name: attended } : null },
    [EF.rating]: { number: r.rating ?? null },
    [EF.note]: rich(r.note),
    [EF.respondedAt]: { date: r.responded_at ? { start: r.responded_at } : null },
    [EF.bookingId]: rich(r.booking_id),
  };
}

/** One-way push of a feedback row to the Dev Notion DB. Best-effort; no-op if not
 * configured. Creates on first push (stores page id), updates thereafter. */
export async function pushExpertFeedback(bookingId: string): Promise<void> {
  const dataSourceId = env.notionDev.expertFeedbackDataSourceId();
  if (!dataSourceId) return; // not configured yet
  try {
    const row = await getFeedbackRow(bookingId);
    if (!row) return;
    // Join event/slot context for display fields.
    const { getAdminClient } = await import("../supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bd } = await (getAdminClient() as any)
      .from("booking_details")
      .select("event_name, event_date, city, slot_name")
      .eq("id", bookingId)
      .maybeSingle();
    const props = expertFeedbackProperties({
      booking_id: row.booking_id,
      expert_name: row.expert_name,
      expert_email: row.expert_email,
      guest_name: row.guest_name,
      guest_email: row.guest_email,
      attended: row.attended,
      rating: row.rating,
      note: row.note,
      responded_at: row.responded_at,
      event_name: bd?.event_name ?? null,
      event_date: bd?.event_date ?? null,
      location: bd?.city ?? null,
      slot_name: bd?.slot_name ?? null,
    });
    const client = getNotionClient("dev");
    if (row.notion_dev_page_id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = (await client.pages.retrieve({ page_id: row.notion_dev_page_id })) as any;
        if (!existing.archived && !existing.in_trash) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await client.pages.update({ page_id: row.notion_dev_page_id, properties: props as any });
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not[ _]?found|could not find/i.test(msg)) throw err;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = (await client.pages.create({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: props as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as any;
    await setFeedbackNotionPageId(bookingId, created.id as string);
  } catch (err) {
    await logSync({ direction: "notion_in", result: "error", bookingId, action: "expert_feedback_notion", note: err instanceof Error ? err.message : String(err) });
  }
}
```

> `direction: "notion_in"` — confirm the allowed `SyncDirection` values in `lib/sync/types.ts`. If `notion_in` isn't valid, use whatever the enum defines for outbound Notion writes (e.g. `notion_out`/`luma_in`). Match an existing value; don't invent one.

- [ ] **Step 4: Run mapper test to verify it passes**

Run: `npx vitest run tests/expert-feedback-notion.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck the interactivity route + this module together**

Run: `npm run typecheck`
Expected: no errors (Task 17's import now resolves).

- [ ] **Step 6: Commit (route + notion sync together)**

```bash
git add lib/notion/expert-feedback.ts tests/expert-feedback-notion.test.ts "app/api/slack/interactivity/route.ts"
git commit -m "feat(feedback): interactivity endpoint + one-way Notion sync"
```

---

### Task 19: One-time Dev DB configuration script

**Files:**
- Create: `scripts/configure-expert-feedback-db.ts`
- Modify: `package.json` (add script)

- [ ] **Step 1: Implement the script**

```typescript
// scripts/configure-expert-feedback-db.ts
// Run once: sets the Dev "Expert Feedback" DB schema to match the mapper and
// prints its data-source id for NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID.
// Usage: npm run setup:expert-feedback
import { Client } from "@notionhq/client";

const DB_ID = process.env.NOTION_DEV_EXPERT_FEEDBACK_DB_ID ?? "3b5b35e6e67f803d9b44e89ebcfa6daa";

async function main() {
  const token = process.env.NOTION_DEV_TOKEN;
  if (!token) throw new Error("NOTION_DEV_TOKEN missing");
  const notion = new Client({ auth: token });

  // The mapper writes these; the title property already exists (rename via update).
  const properties: Record<string, unknown> = {
    "Expert": { title: {} },
    "Expert email": { rich_text: {} },
    "Guest": { rich_text: {} },
    "Guest email": { rich_text: {} },
    "Event Date": { date: {} },
    "Location": { rich_text: {} },
    "Event": { rich_text: {} },
    "Slot": { rich_text: {} },
    "Attended": { select: { options: [{ name: "Showed up", color: "green" }, { name: "No-show", color: "red" }] } },
    "Rating": { number: {} },
    "Note": { rich_text: {} },
    "Responded at": { date: {} },
    "Booking ID": { rich_text: {} },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await notion.databases.update({ database_id: DB_ID, properties: properties as any });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await notion.databases.retrieve({ database_id: DB_ID })) as any;
  const ds = db.data_sources?.[0]?.id ?? "(none — check API version / sharing)";
  console.log("Expert Feedback DB configured.");
  console.log("NOTION_DEV_EXPERT_FEEDBACK_DB_ID=" + DB_ID);
  console.log("NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID=" + ds);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add:

```json
    "setup:expert-feedback": "tsx --env-file=.env.local scripts/configure-expert-feedback-db.ts",
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors. (Do NOT run the script here — it mutates the live Notion DB and requires the DB to be shared with the integration. It's part of manual rollout.)

- [ ] **Step 4: Commit**

```bash
git add scripts/configure-expert-feedback-db.ts package.json
git commit -m "feat(feedback): one-time Dev feedback DB config script"
```

---

### Task 20: Full suite green + final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass (existing + new: slack-verify, slack-api, slack-blocks, expert-feedback-db, expert-feedback-prompts, slack-interactivity, expert-feedback-notion).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit any lint fixes (if needed)**

```bash
git add -A
git commit -m "chore(slack): lint/typecheck cleanup"
```

---

## Manual rollout (user, after merge)

1. Add `SLACK_BOT_TOKEN` to Vercel **production** env (already in `.env.local`).
2. Slack app → **Interactivity & Shortcuts** → enable → Request URL `https://office-hours-three.vercel.app/api/slack/interactivity` → save.
3. Share the Dev DB `3b5b35e6e67f803d9b44e89ebcfa6daa` with the Dev integration → run `npm run setup:expert-feedback` → copy the printed `NOTION_DEV_EXPERT_FEEDBACK_DB_ID` and `NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID` into Vercel prod env.
4. (Feature 3, gradual) Invite `@Build Bar Bot` to each city channel → add each `channel_id` via Settings → Slack (or directly in `slack_channels`).

---

## Self-Review

**Spec coverage:**
- Component 1 (Slack Web API foundation) → Tasks 1, 3. ✓
- Component 2 (agenda DM, additive) → Tasks 4, 5. ✓
- Component 3 (claim/assignment confirm DM + calendar-invite nudge) → Tasks 6, 7. ✓
- Component 4 (recruit via bot, webhook fallback) → Tasks 8, 9, 10. ✓
- Component 5a (hourly cron, ≥2h ended, idempotent) → Tasks 14, 15. ✓
- Component 5b (feedback DM, buttons + rating + note modal, per-1:1 rows) → Tasks 13, 16. ✓
- Component 5c (`expert_feedback` table + access + patch) → Tasks 11, 12. ✓
- Component 5d (interactivity endpoint, signature verify, immediate persist) → Tasks 2, 16, 17. ✓
- Component 5e (one-way Dev Notion sync, exact props, DB `3b5b…`) → Tasks 18, 19. ✓
- Migrations 0038/0039 + type regen → Tasks 8, 11. ✓
- vercel.json cron → Task 15. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases". Two explicit "confirm the column/enum name" notes (slots duration, SyncDirection, booked_by_type) direct the engineer to verify against real schema rather than guess — intentional, not placeholders.

**Type consistency:** `SlackResult`, `ExpertAgenda` (imported), `ExpertFeedbackPrompt`/`FeedbackItem`, `Interaction`, `AnswerPatch`, `ExpertFeedbackNotionRow`, `EF` property names, and action_ids (`fb_attend`/`fb_rating`/`fb_note`, value formats `id:yes|no`, `id:n`, bare `id`, modal `private_metadata`) are consistent across Tasks 13, 16, 17, 18. Notion property names in the mapper (Task 18) match the config script (Task 19). ✓
