# Slack Channel Field on Add Event — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A required "Slack channel" field on the main Add Event form; on submit, record the channel (name + auto-resolved id) for the event's city, preserving any existing webhook, without a schema change.

**Architecture:** `registerEventFromLuma` returns the resolved `city`; the add-event route resolves the channel id (`lookupChannelIdByName`) and calls a new `setCityChannelName` that upserts the city's `slack_channels` row via a pure `mergeCityChannelRow` (preserves existing webhook/aliases, else empty). The recruit post path already no-ops on an empty webhook — no change there.

**Tech Stack:** TypeScript, Next.js route handler + client form, Vitest, Supabase.

**Reference spec:** `docs/superpowers/specs/2026-08-24-add-event-slack-channel-design.md`

---

## File Structure
- **Modify** `lib/events/register.ts` — add `city` to `RegisterResult`.
- **Modify** `lib/db/slack.ts` — add pure `mergeCityChannelRow` + `setCityChannelName`.
- **Modify** `app/api/hub/add-event/route.ts` — require `slackChannel`, resolve id, save.
- **Modify** `components/hub/AddEventForm.tsx` — required "Slack channel" field in the main form.
- **Create** `tests/slack-city-channel.test.ts` — `mergeCityChannelRow` (preserve-webhook).

---

## Task 1: `registerEventFromLuma` returns the city

**Files:**
- Modify: `lib/events/register.ts`

- [ ] **Step 1: Add `city` to the result type and return**

In `lib/events/register.ts`, add `city: string;` to the `RegisterResult` interface (alongside `eventName`). Then in the returned object (the `return { eventId, eventName, ... }` near the end), add `city,` (the `city` const is already in scope — it's validated non-empty earlier in the function).

```ts
// in interface RegisterResult { ... }
  city: string;
```
```ts
  return {
    eventId: event.id,
    eventName: event.name,
    city,
    inserted: plan.toInsert.length,
    updated: plan.toUpdate.length,
    deleted: deletable.length,
    skippedDeletes,
    importedGuests,
  };
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/events/register.ts
git commit -m "feat(add-event): registerEventFromLuma returns the resolved city"
```

---

## Task 2: `mergeCityChannelRow` (pure) + `setCityChannelName`

**Files:**
- Modify: `lib/db/slack.ts`
- Test: `tests/slack-city-channel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/slack-city-channel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeCityChannelRow } from "../lib/db/slack";

describe("mergeCityChannelRow", () => {
  it("preserves an existing city's webhook + aliases, updates name + id", () => {
    const row = mergeCityChannelRow(
      { webhook_url: "https://hooks.slack.com/x", aliases: ["brooklyn"] },
      { city: "New York", channelName: "#build-bar-nyc", channelId: "C1" },
    );
    expect(row.webhook_url).toBe("https://hooks.slack.com/x"); // never wiped
    expect(row.aliases).toEqual(["brooklyn"]);
    expect(row.channel_name).toBe("#build-bar-nyc");
    expect(row.channel_id).toBe("C1");
    expect(row.city).toBe("New York");
  });
  it("new city → empty webhook, empty aliases", () => {
    const row = mergeCityChannelRow(null, { city: "Austin", channelName: "#bb-atx", channelId: null });
    expect(row.webhook_url).toBe("");
    expect(row.aliases).toEqual([]);
    expect(row.channel_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/slack-city-channel.test.ts`
Expected: FAIL — `mergeCityChannelRow` not exported.

- [ ] **Step 3: Implement both**

In `lib/db/slack.ts`, add (near `upsertSlackChannel`):

```ts
/**
 * The slack_channels row to write when attaching a channel to a city: update
 * name + id, but PRESERVE an existing webhook/aliases (adding an event never
 * wipes them). A new city starts with an empty webhook ("" = not set up yet).
 * Pure.
 */
export function mergeCityChannelRow(
  existing: { webhook_url: string; aliases: string[] } | null,
  next: { city: string; channelName: string; channelId: string | null },
): { city: string; channel_name: string; channel_id: string | null; webhook_url: string; aliases: string[] } {
  return {
    city: next.city,
    channel_name: next.channelName,
    channel_id: next.channelId,
    webhook_url: existing?.webhook_url ?? "",
    aliases: existing?.aliases ?? [],
  };
}

/** Attach a channel (name + resolved id) to a city, preserving any existing webhook. */
export async function setCityChannelName(input: {
  city: string;
  channelName: string;
  channelId: string | null;
}): Promise<void> {
  const supabase = getAdminClient();
  const { data: existing } = await supabase
    .from("slack_channels")
    .select("webhook_url, aliases")
    .eq("city", input.city)
    .maybeSingle();
  const row = mergeCityChannelRow(
    existing ? { webhook_url: existing.webhook_url, aliases: existing.aliases ?? [] } : null,
    { city: input.city, channelName: input.channelName, channelId: input.channelId },
  );
  await supabase
    .from("slack_channels")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "city" });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/slack-city-channel.test.ts && npm run typecheck`
Expected: PASS (2 tests) + clean. (If importing `lib/db/slack.ts` in the test errors because `../supabase/admin` builds a client at module load, move `mergeCityChannelRow` to a new leaf `lib/db/slack-merge.ts` importing nothing, import it there + re-export from `lib/db/slack.ts`, and point the test at the leaf. Only if needed.)

- [ ] **Step 5: Commit**

```bash
git add lib/db/slack.ts tests/slack-city-channel.test.ts
git commit -m "feat(add-event): setCityChannelName (+ pure mergeCityChannelRow, preserve webhook)"
```

---

## Task 3: Wire the route

**Files:**
- Modify: `app/api/hub/add-event/route.ts`

- [ ] **Step 1: Require `slackChannel` + save it after register**

In `app/api/hub/add-event/route.ts`:

Add imports:
```ts
import { lookupChannelIdByName } from "@/lib/slack/api";
import { setCityChannelName } from "@/lib/db/slack";
```

After the `lumaEvent` required-check block, add the required `slackChannel` read:
```ts
  const slackChannel = String(form.get("slackChannel") ?? "").trim();
  if (!slackChannel) {
    return NextResponse.json({ ok: false, error: "A Slack channel is required." }, { status: 400 });
  }
```

In the `try` block, after `const result = await registerEventFromLuma(...)` and before the success `NextResponse.json`, add the best-effort channel save:
```ts
    // Attach the channel to the event's city (best-effort; never fails the add).
    if (result.city) {
      try {
        const channelId = await lookupChannelIdByName(slackChannel);
        await setCityChannelName({ city: result.city, channelName: slackChannel, channelId });
      } catch (chErr) {
        console.error("[add-event] channel save failed", chErr);
      }
    }
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean. (`result.city` exists now from Task 1.)

- [ ] **Step 3: Commit**

```bash
git add app/api/hub/add-event/route.ts
git commit -m "feat(add-event): require Slack channel + attach it to the event's city"
```

---

## Task 4: Add the field to the form

**Files:**
- Modify: `components/hub/AddEventForm.tsx`

- [ ] **Step 1: Add the required field in the MAIN form**

In `components/hub/AddEventForm.tsx`, add this `<label>` block immediately AFTER the Luma-event `<label>` and BEFORE the `<details>` (Optional overrides):

```tsx
      <label className="block text-sm">
        <span className="text-neutral-600">Slack channel *</span>
        <input name="slackChannel" required placeholder="#build-bar-nyc" className={`mt-1 ${field}`} />
      </label>
```

- [ ] **Step 2: Verify build + typecheck + suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests pass (incl. the 2 new `mergeCityChannelRow` tests); build succeeds (the add-event page compiles).

- [ ] **Step 3: Commit**

```bash
git add components/hub/AddEventForm.tsx
git commit -m "feat(add-event): required Slack channel field in the main form"
```

---

## Self-Review Notes
- **Spec coverage:** required main-form field (T4), register returns city (T1), route requires + attaches channel to city (T3), preserve-webhook + empty-for-new via `setCityChannelName`/`mergeCityChannelRow` (T2), channel_id auto-resolve via `lookupChannelIdByName` (T3, best-effort — null until the Slack scope lands), posting already guards empty webhook (no change). All covered.
- **Placeholder scan:** none — full code each step.
- **Type consistency:** `RegisterResult.city` (T1) consumed in T3; `setCityChannelName({city, channelName, channelId})` signature matches its T3 call; `mergeCityChannelRow` shape matches the `slack_channels` columns.
- **Best-effort:** the channel save is wrapped so it never fails the event add; `lookupChannelIdByName` returns null on missing scope (name still saved).
