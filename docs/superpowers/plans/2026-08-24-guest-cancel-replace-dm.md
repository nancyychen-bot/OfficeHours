# Expert "Replace Your Booking" Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a guest self-cancels a claimed 1:1, nudge the expert to grab a replacement — via both a new Slack DM (with a clickable link to their city's recruit channel) and an added line in the existing `guest_cancelled` email.

**Architecture:** A new pure `buildGuestCancelledBlocks` (Slack mrkdwn) + a new best-effort `postGuestCancelledDM(bookingId)` (mirrors `postClaimConfirmDM`), fired right after the existing `guest_cancelled` email in `ingestRegistration`. The email template gains a "pick up another" line. City channel resolved via the existing `getSlackChannelForCity`.

**Tech Stack:** TypeScript, Next.js, Vitest, Slack Web API (via existing `lib/slack/*`), Resend.

**Reference spec:** `docs/superpowers/specs/2026-08-24-guest-cancel-replace-dm-design.md`

---

## File Structure

- **Modify** `lib/slack/blocks.ts` — add `GuestCancelledInput` + `buildGuestCancelledBlocks`.
- **Modify** `lib/email/templates.ts` — add the replace nudge to `guest_cancelled__helper`.
- **Modify** `lib/slack/notify.ts` — add `postGuestCancelledDM(bookingId)`.
- **Modify** `lib/events/ingest.ts` — fire the DM after the `guest_cancelled` email.
- **Modify** `tests/slack-blocks.test.ts` — cover the new blocks builder.
- **Modify** `tests/comms-templates.test.ts` — cover the email nudge.

---

## Task 1: `buildGuestCancelledBlocks` (Slack DM body)

**Files:**
- Modify: `lib/slack/blocks.ts`
- Test: `tests/slack-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/slack-blocks.test.ts` (import it alongside the existing blocks imports at the top: change the import line to include `buildGuestCancelledBlocks`):

```ts
describe("buildGuestCancelledBlocks", () => {
  it("names the guest and links the city channel when one is known", () => {
    const json = JSON.stringify(buildGuestCancelledBlocks({
      guestName: "Ada Lovelace", eventName: "Build Bar NYC", eventDate: "2026-08-26",
      slotName: "2:00 PM", channelId: "C12345",
    }));
    expect(json).toContain("Ada Lovelace");
    expect(json).toContain("<#C12345>");   // clickable channel mention
    expect(json).toContain("freed up");
  });
  it("falls back to a generic nudge when no channel is known", () => {
    const json = JSON.stringify(buildGuestCancelledBlocks({
      guestName: "Ada Lovelace", eventName: null, eventDate: null, slotName: null, channelId: null,
    }));
    expect(json).toContain("Ada Lovelace");
    expect(json).not.toContain("<#");
    expect(json.toLowerCase()).toContain("build bar channel");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/slack-blocks.test.ts`
Expected: FAIL — `buildGuestCancelledBlocks` is not exported.

- [ ] **Step 3: Implement the builder**

In `lib/slack/blocks.ts`, add (near `buildClaimConfirmBlocks`; `shortDate` is already imported and used in this file):

```ts
export interface GuestCancelledInput {
  guestName: string;
  eventName: string | null;
  eventDate: string | null;
  slotName: string | null;
  /** City recruit channel id for a clickable <#…> mention, or null if none configured. */
  channelId: string | null;
}

export function buildGuestCancelledBlocks(i: GuestCancelledInput): unknown[] {
  const when = [i.eventDate ? shortDate(i.eventDate) : null, i.slotName].filter(Boolean).join(" · ");
  const ev = i.eventName ? ` · ${i.eventName}` : "";
  const lines = [
    `😕 *${i.guestName}'s 1:1 was cancelled*, so your slot${when ? ` at *${when}*` : ""}${ev} just freed up.`,
    i.channelId
      ? `Want to pick up another? Grab an open 1:1 in <#${i.channelId}>.`
      : `Want to pick up another? Check your city's Build Bar channel for an open 1:1.`,
  ].join("\n");
  return [{ type: "section", text: { type: "mrkdwn", text: lines } }];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/slack-blocks.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/blocks.ts tests/slack-blocks.test.ts
git commit -m "feat(replace-dm): buildGuestCancelledBlocks for the expert nudge"
```

---

## Task 2: Add the "pick up another" nudge to the email

**Files:**
- Modify: `lib/email/templates.ts`
- Test: `tests/comms-templates.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the existing `guest_cancelled → helper only …` test in `tests/comms-templates.test.ts` with this (keeps the old assertions, adds the nudge check):

```ts
  it("guest_cancelled → helper: slot freed + a nudge to pick up another", () => {
    const h = renderComms("guest_cancelled", "helper", fields())!;
    expect(h.subject.toLowerCase()).toContain("freed");
    expect(h.text).toContain("cancelled their booking");
    expect(h.text).toContain("released");
    expect(h.text).not.toContain("at capacity");
    expect(h.text.toLowerCase()).toContain("pick up another");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/comms-templates.test.ts`
Expected: FAIL — the body has no "pick up another" line yet.

- [ ] **Step 3: Update the template body**

In `lib/email/templates.ts`, replace the `guest_cancelled__helper` `body` (currently the "Nothing you need to do." version) with:

```ts
    body: b(
      "Hi {{firstName}},", "",
      "Quick update: {{guestName}} has cancelled their booking and won't be joining, so the slot you'd claimed has been released.", "",
      "Want to pick up another? Head to your city's Build Bar Slack channel to claim an open 1:1 — we'd love to keep you building.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/comms-templates.test.ts && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts tests/comms-templates.test.ts
git commit -m "feat(replace-dm): add 'pick up another' nudge to guest_cancelled email"
```

---

## Task 3: `postGuestCancelledDM` + wire into ingest

**Files:**
- Modify: `lib/slack/notify.ts`
- Modify: `lib/events/ingest.ts`

No new unit test: `postGuestCancelledDM` is a best-effort orchestrator like `postClaimConfirmDM` (which is likewise untested at the orchestration layer); the pure blocks builder from Task 1 carries the unit coverage.

- [ ] **Step 1: Add `postGuestCancelledDM` to `lib/slack/notify.ts`**

Add the import for the channel resolver and the new blocks builder at the top of `lib/slack/notify.ts`:
```ts
import { getSlackChannelForCity } from "../db/slack";
import { buildClaimConfirmBlocks, buildGuestCancelledBlocks } from "./blocks";
```
(Change the existing `import { buildClaimConfirmBlocks } from "./blocks";` line to the combined form above.)

Then add the function:
```ts
/**
 * DM the expert that their guest self-cancelled and nudge them to claim a
 * replacement in their city's recruit channel (best-effort; additive to the
 * `guest_cancelled` email). No-op if there's no assigned expert.
 */
export async function postGuestCancelledDM(bookingId: string): Promise<void> {
  try {
    const booking = await getBookingById(bookingId);
    if (!booking?.booked_by_email) return;
    const details = await getBookingDetailsById(bookingId);
    if (!details) return;
    const f = toCommsFields(details);
    const channel = await getSlackChannelForCity(f.location);
    const blocks = buildGuestCancelledBlocks({
      guestName: f.guestName,
      eventName: f.eventName,
      eventDate: f.eventDate,
      slotName: f.slotName,
      channelId: channel?.channelId ?? null,
    });
    await dmByEmail(booking.booked_by_email, blocks, "A 1:1 slot just freed up");
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "guest_cancelled_dm" });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "guest_cancelled_dm", note: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: clean. Confirms `getSlackChannelForCity` is exported from `lib/db/slack` (it is) and returns `{ channelId, channelName, webhookUrl }` (so `channel?.channelId` is valid), and that `toCommsFields`/`getBookingById`/`getBookingDetailsById`/`dmByEmail`/`logSync` are already imported in this file (they are — used by `postClaimConfirmDM`).

- [ ] **Step 3: Wire it into `ingestRegistration`**

In `lib/events/ingest.ts`, add the import near the other imports:
```ts
import { postGuestCancelledDM } from "../slack/notify";
```
Then change the downgrade block (currently line ~41):
```ts
    if (shouldSendGuestCancelled(prior, nextLumaStatus)) await sendBookingComms(prior.id, "guest_cancelled");
    else if (nextLumaStatus === "waitlist") await sendBookingComms(prior.id, "waitlisted");
```
to:
```ts
    if (shouldSendGuestCancelled(prior, nextLumaStatus)) {
      await sendBookingComms(prior.id, "guest_cancelled");
      await postGuestCancelledDM(prior.id);
    } else if (nextLumaStatus === "waitlist") {
      await sendBookingComms(prior.id, "waitlisted");
    }
```

- [ ] **Step 4: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/slack/notify.ts lib/events/ingest.ts
git commit -m "feat(replace-dm): DM the expert to claim a replacement on guest cancel"
```

---

## Self-Review Notes

- **Spec coverage:** Slack DM builder with city-channel mention + fallback (Task 1); email nudge (Task 2); `postGuestCancelledDM` best-effort + city resolution + wire-up on the guest_cancelled path only (Task 3). Trigger stays guest-cancel-only (unchanged `shouldSendGuestCancelled`). All covered.
- **Placeholder scan:** none — concrete code/commands throughout.
- **Type consistency:** `GuestCancelledInput`/`buildGuestCancelledBlocks`/`postGuestCancelledDM` consistent across tasks; `channelId` sourced from `getSlackChannelForCity(...).channelId`; `f.location` is the city (a `CommsFields` field).
- **Fallbacks:** no expert → early return; no channel → linkless nudge; any error logged + swallowed (never blocks the email or ingest).
