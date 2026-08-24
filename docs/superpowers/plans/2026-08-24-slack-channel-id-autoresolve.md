# Auto-Resolve Slack `channel_id` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill `slack_channels.channel_id` from the channel name (via the Slack API) when a city channel is saved, plus a backfill script for the existing rows — so the guest-cancel DM's `<#channel>` link works.

**Architecture:** A new best-effort `lookupChannelIdByName` (walks `conversations.list`) and a `resolveChannelIdForSave` decision helper in `lib/slack/api.ts`. The hub's channel `save` action calls the resolver; a backfill script fills existing rows via a new `setSlackChannelId` DB helper. All best-effort — a missing Slack scope degrades to `null`, never an error.

**Tech Stack:** TypeScript, Next.js route handler, Vitest, Slack Web API, Supabase, tsx script.

**Reference spec:** `docs/superpowers/specs/2026-08-24-slack-channel-id-autoresolve-design.md`

---

## File Structure

- **Modify** `lib/slack/api.ts` — add `lookupChannelIdByName` + `resolveChannelIdForSave`.
- **Modify** `tests/slack-api.test.ts` — cover both.
- **Modify** `app/api/hub/slack/route.ts` — resolve `channel_id` in the `save` action.
- **Modify** `lib/db/slack.ts` — add `setSlackChannelId(city, id)`.
- **Create** `scripts/backfill-slack-channel-ids.ts` — one-off backfill.
- **Modify** `package.json` — add `backfill:slack-ids`.

---

## Task 1: `lookupChannelIdByName` (Slack channel resolver)

**Files:**
- Modify: `lib/slack/api.ts`
- Test: `tests/slack-api.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `lookupChannelIdByName` to the existing import at the top of `tests/slack-api.test.ts`
(`import { dmByEmail, lookupUserByEmail, postToChannel, lookupChannelIdByName } from "../lib/slack/api";`),
then add this block (uses the file's existing `stubFetch`/`calls` harness):

```ts
describe("lookupChannelIdByName", () => {
  it("matches by name ignoring a leading # and case", async () => {
    stubFetch(() => ({ ok: true, channels: [{ id: "C1", name: "build-bar-nyc" }] }));
    expect(await lookupChannelIdByName("#Build-Bar-NYC")).toBe("C1");
  });
  it("walks pagination via next_cursor until it finds the channel", async () => {
    let n = 0;
    stubFetch((url) => {
      if (!url.includes("conversations.list")) return { ok: false };
      n++;
      return n === 1
        ? { ok: true, channels: [{ id: "C1", name: "other" }], response_metadata: { next_cursor: "pg2" } }
        : { ok: true, channels: [{ id: "C2", name: "build-bar-sf" }], response_metadata: { next_cursor: "" } };
    });
    expect(await lookupChannelIdByName("build-bar-sf")).toBe("C2");
    expect(n).toBe(2);
  });
  it("returns null when not found", async () => {
    stubFetch(() => ({ ok: true, channels: [{ id: "C1", name: "random" }], response_metadata: { next_cursor: "" } }));
    expect(await lookupChannelIdByName("build-bar-nyc")).toBeNull();
  });
  it("returns null on API error (e.g. missing_scope)", async () => {
    stubFetch(() => ({ ok: false, error: "missing_scope" }));
    expect(await lookupChannelIdByName("build-bar-nyc")).toBeNull();
  });
  it("sends conversations.list as form-encoded", async () => {
    stubFetch(() => ({ ok: true, channels: [{ id: "C1", name: "build-bar-nyc" }] }));
    await lookupChannelIdByName("build-bar-nyc");
    const call = calls.find((c) => c.url.includes("conversations.list"))!;
    expect(call.contentType).toContain("application/x-www-form-urlencoded");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/slack-api.test.ts`
Expected: FAIL — `lookupChannelIdByName` is not exported.

- [ ] **Step 3: Implement `lookupChannelIdByName`**

In `lib/slack/api.ts`, add (after `openDM`, so `callSlack` is in scope):

```ts
/**
 * The Slack channel id (C…) for a channel name, or null. Walks conversations.list
 * (public + private, non-archived), matching the name case-insensitively and
 * ignoring a leading "#". Best-effort: null on not-found / missing scope / error.
 * conversations.list is a read method — pass params form-encoded (like lookupByEmail).
 */
export async function lookupChannelIdByName(name: string | null | undefined): Promise<string | null> {
  const needle = (name ?? "").trim().replace(/^#/, "").toLowerCase();
  if (!needle) return null;
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;
    const body = await callSlack("conversations.list", params, true);
    if (!body.ok) return null;
    const channels = (body.channels as Array<{ id?: string; name?: string }> | undefined) ?? [];
    const match = channels.find((c) => (c.name ?? "").toLowerCase() === needle);
    if (match?.id) return match.id;
    const meta = body.response_metadata as { next_cursor?: string } | undefined;
    cursor = meta?.next_cursor || undefined;
    if (!cursor) break;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/slack-api.test.ts`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/api.ts tests/slack-api.test.ts
git commit -m "feat(slack-ids): lookupChannelIdByName via conversations.list"
```

---

## Task 2: `resolveChannelIdForSave` + wire into the save action

**Files:**
- Modify: `lib/slack/api.ts`
- Test: `tests/slack-api.test.ts`
- Modify: `app/api/hub/slack/route.ts`

- [ ] **Step 1: Write the failing tests**

Add `resolveChannelIdForSave` to the same import line in `tests/slack-api.test.ts`, then add:

```ts
describe("resolveChannelIdForSave", () => {
  it("keeps an explicitly provided id without calling Slack", async () => {
    stubFetch(() => ({ ok: false }));
    expect(await resolveChannelIdForSave("C999", "#build-bar-nyc")).toBe("C999");
    expect(calls).toHaveLength(0);
  });
  it("resolves from the channel name when no id is given", async () => {
    stubFetch(() => ({ ok: true, channels: [{ id: "C1", name: "build-bar-nyc" }] }));
    expect(await resolveChannelIdForSave("", "#build-bar-nyc")).toBe("C1");
  });
  it("returns null with no id and no name (no lookup)", async () => {
    stubFetch(() => ({ ok: true, channels: [] }));
    expect(await resolveChannelIdForSave("", null)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/slack-api.test.ts`
Expected: FAIL — `resolveChannelIdForSave` is not exported.

- [ ] **Step 3: Implement `resolveChannelIdForSave`**

In `lib/slack/api.ts`, add right after `lookupChannelIdByName`:

```ts
/**
 * The channel_id to store when saving a city channel: an explicitly provided id
 * wins; otherwise resolve it from the channel name via Slack. Null if neither yields
 * one. Best-effort (never throws) — a save must succeed even if resolution fails.
 */
export async function resolveChannelIdForSave(
  explicitId: string | null | undefined,
  channelName: string | null | undefined,
): Promise<string | null> {
  const id = (explicitId ?? "").trim();
  if (id) return id;
  return lookupChannelIdByName(channelName);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/slack-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the save action**

In `app/api/hub/slack/route.ts`, add the import:
```ts
import { resolveChannelIdForSave } from "@/lib/slack/api";
```
Then replace the `upsertSlackChannel({...})` call in the `save` branch:
```ts
      await upsertSlackChannel({
        city,
        channelName: (body.channelName ?? "").trim() || null,
        webhookUrl,
        aliases,
        channelId: body.channelId ?? null,
      });
```
with:
```ts
      const channelName = (body.channelName ?? "").trim() || null;
      const channelId = await resolveChannelIdForSave(body.channelId, channelName);
      await upsertSlackChannel({ city, channelName, webhookUrl, aliases, channelId });
```

- [ ] **Step 6: Verify typecheck + suite**

Run: `npm run typecheck && npm test -- tests/slack-api.test.ts`
Expected: clean + all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/slack/api.ts tests/slack-api.test.ts app/api/hub/slack/route.ts
git commit -m "feat(slack-ids): auto-resolve channel_id when saving a city channel"
```

---

## Task 3: `setSlackChannelId` + backfill script

**Files:**
- Modify: `lib/db/slack.ts`
- Create: `scripts/backfill-slack-channel-ids.ts`
- Modify: `package.json`

No unit test: a one-line DB update + a script, matching the codebase convention for
scripts (`send-prep.ts`, `send-cowork-notice.ts` are not unit-tested); the resolver's
logic is covered in Task 1.

- [ ] **Step 1: Add `setSlackChannelId` to `lib/db/slack.ts`**

Add after `upsertSlackChannel`:

```ts
/** Set just the channel_id for a city (used by the backfill). */
export async function setSlackChannelId(city: string, channelId: string): Promise<void> {
  await getAdminClient()
    .from("slack_channels")
    .update({ channel_id: channelId, updated_at: new Date().toISOString() })
    .eq("city", city);
}
```

- [ ] **Step 2: Create the backfill script**

Create `scripts/backfill-slack-channel-ids.ts`:

```ts
/**
 * Backfill slack_channels.channel_id for rows that have a channel name but no id,
 * resolving via the Slack API. Idempotent; safe to re-run.
 *   npm run backfill:slack-ids
 */
import { listSlackChannels, setSlackChannelId } from "../lib/db/slack";
import { lookupChannelIdByName } from "../lib/slack/api";

async function main() {
  const rows = await listSlackChannels();
  const missing = rows.filter((r) => !r.channelId && r.channelName);
  const noName = rows.filter((r) => !r.channelName).length;
  console.log(`${rows.length} channels; ${missing.length} missing an id${noName ? `; ${noName} have no name (skipped)` : ""}.`);

  let resolved = 0;
  for (const r of missing) {
    const id = await lookupChannelIdByName(r.channelName);
    if (id) {
      await setSlackChannelId(r.city, id);
      resolved++;
      console.log(`  ✓ ${r.city}: ${r.channelName} → ${id}`);
    } else {
      console.log(`  ✗ ${r.city}: ${r.channelName} → not resolved`);
    }
  }

  console.log(`\nResolved ${resolved}/${missing.length}.`);
  if (missing.length > 0 && resolved === 0) {
    console.log(
      "Resolved 0 — the Slack app likely lacks `channels:read` (and `groups:read` " +
      "for private channels). Add the scope(s), reinstall the app, and re-run.",
    );
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add after the `"backup"` script line:
```json
    "backfill:slack-ids": "tsx --env-file=.env.local scripts/backfill-slack-channel-ids.ts",
```

- [ ] **Step 4: Verify typecheck + full suite + JSON**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.
Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add lib/db/slack.ts scripts/backfill-slack-channel-ids.ts package.json
git commit -m "feat(slack-ids): setSlackChannelId + backfill script"
```

---

## Self-Review Notes

- **Spec coverage:** `lookupChannelIdByName` w/ pagination + strip-`#` + null-on-error (Task 1); auto-resolve on save, explicit-id-wins (Task 2); `setSlackChannelId` + idempotent backfill + the "resolved 0 → add scope" hint (Task 3). The scope dependency is surfaced in the script output and the spec rollout. All covered.
- **Placeholder scan:** none — concrete code/commands throughout.
- **Type consistency:** `lookupChannelIdByName`/`resolveChannelIdForSave`/`setSlackChannelId` used consistently; `listSlackChannels()` returns `channelId`/`channelName`/`city` (matches the backfill's field access).
- **Best-effort:** every Slack call degrades to `null` via `callSlack`; save and backfill never throw on a resolution miss.
