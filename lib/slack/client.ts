import { getBookingById, getBookingDetailsById } from "../db/bookings";
import { getSlackChannelForCity, setRecruitPostedAt } from "../db/slack";
import { getNotionClient, type NotionWorkspace } from "../notion/client";
import { toCommsFields } from "../email/comms";
import type { CommsFields } from "../email/templates";
import { logSync } from "../sync/log";
import { postToChannel } from "./api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08-28" → "Aug 28" (no timezone parsing so the date never shifts). */
function shortDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : isoDate;
}

/**
 * Canonical link to a Notion card, from the API's own `page.url`. We must NOT
 * construct `notion.so/<id>` — the dev workspace lives on app.dev.notion.com and
 * the ambassador workspace on app.notion.com, so only the API URL resolves.
 * Best-effort: null on any failure (the button is then omitted).
 */
export async function fetchCardUrl(ws: NotionWorkspace, pageId: string | null | undefined): Promise<string | null> {
  if (!pageId) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await getNotionClient(ws).pages.retrieve({ page_id: pageId })) as any;
    return typeof page.url === "string" ? page.url : null;
  } catch {
    return null;
  }
}

export interface RecruitInput {
  guestName: string;
  role: string | null;
  company: string | null;
  challenge: string | null;
  eventName: string | null;
  eventDate: string | null;
  slotName: string | null;
  location: string | null;
  /** Dev-workspace card link — Notion staff claim here (recorded as `employee`). */
  devCardUrl: string | null;
  /** Ambassador-workspace card link — Ambassadors claim here (recorded as `ambassador`). */
  ambassadorCardUrl: string | null;
}

/** Block Kit blocks for a "cover this open 1:1" recruiting post. Pure/testable. */
export function buildRecruitBlocks(i: RecruitInput): unknown[] {
  const when = [shortDate(i.eventDate), i.slotName].filter(Boolean).join(" · ") || "—";
  const roleLine = [i.role, i.company].filter(Boolean).join(" @ ") || "—";
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: "*🙋 A 1:1 slot just opened up — can anyone cover it?*" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Event:*\n${i.eventName ?? "—"}` },
        { type: "mrkdwn", text: `*When:*\n${when}` },
        { type: "mrkdwn", text: `*Location:*\n${i.location ?? "—"}` },
        { type: "mrkdwn", text: `*Guest:*\n${i.guestName}` },
        { type: "mrkdwn", text: `*Role:*\n${roleLine}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*What they want help with:*\n${i.challenge ?? "—"}` } },
  ];
  // Two buttons so each person claims in their own workspace → correct type. First
  // to claim wins; the other gets an "already claimed" reply (cross-workspace arbiter).
  const elements: unknown[] = [];
  if (i.ambassadorCardUrl) {
    elements.push({ type: "button", text: { type: "plain_text", text: "Open Ambassador card", emoji: true }, url: i.ambassadorCardUrl });
  }
  if (i.devCardUrl) {
    elements.push({ type: "button", text: { type: "plain_text", text: "Open Notino card", emoji: true }, url: i.devCardUrl });
  }
  if (elements.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Want it? Open your card below — *Ambassador* if you're a Notion Ambassador, *Notino* if you work at Notion — then press *Claim* inside the card to lock it in.",
      },
    });
    blocks.push({ type: "actions", elements });
  }
  return blocks;
}

/** POST Block Kit blocks to a Slack incoming webhook. Throws on non-2xx. */
async function postBlocks(webhookUrl: string, blocks: unknown[]): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks, text: "A 1:1 slot just opened up — can anyone cover it?" }),
  });
  if (!res.ok) throw new Error(`Slack webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

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

/**
 * Post a "recruit a replacement" message to the booking's city channel after a
 * slot opens (unclaim/release). Best-effort: never throws, no-op if the city has
 * no configured webhook. Prefers the ambassador card link (the recruit pool),
 * falling back to the dev card.
 */
export async function postSlackRecruit(bookingId: string): Promise<void> {
  try {
    const booking = await getBookingById(bookingId);
    if (!booking) return;
    const details = await getBookingDetailsById(bookingId);
    if (!details) return;
    const f: CommsFields = toCommsFields(details);
    const channel = await getSlackChannelForCity(f.location);
    if (!channel) {
      await logSync({ direction: "luma_in", result: "applied", bookingId, action: "slack_recruit_skipped", note: `no channel for ${f.location ?? "?"}` });
      return;
    }
    const [devCardUrl, ambassadorCardUrl] = await Promise.all([
      fetchCardUrl("dev", booking.notion_dev_page_id),
      fetchCardUrl("ambassador", booking.notion_ambassador_page_id),
    ]);
    const blocks = buildRecruitBlocks({
      guestName: f.guestName,
      role: f.role,
      company: f.company,
      challenge: f.challenge,
      eventName: f.eventName,
      eventDate: f.eventDate,
      slotName: f.slotName,
      location: f.location,
      devCardUrl,
      ambassadorCardUrl,
    });
    await postToCityChannel(channel, blocks, "A 1:1 slot just opened up — can anyone cover it?");
    await setRecruitPostedAt(bookingId, new Date().toISOString());
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "slack_recruit_posted", note: channel.channelName ?? undefined });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "slack_recruit", note: err instanceof Error ? err.message : String(err) });
  }
}

/** Blocks for a short "covered" follow-up once a recruited slot is claimed. Pure. */
export function buildClaimedBlocks(i: { claimerName: string; guestName: string; slotName: string | null }): unknown[] {
  const slot = i.slotName ? ` (${i.slotName})` : "";
  return [
    { type: "section", text: { type: "mrkdwn", text: `✅ *Covered* — ${i.claimerName} took ${i.guestName}'s 1:1${slot}. Thanks! 🙌` } },
  ];
}

/**
 * Post a "covered" follow-up to the city channel when a previously-recruited slot
 * is claimed, then clear the recruit marker. Best-effort; no-op if this booking
 * wasn't recruited or the city has no channel. Editing/greying the original
 * recruit message isn't possible via an incoming webhook — that needs a Slack app.
 */
export async function postSlackClaimed(bookingId: string): Promise<void> {
  try {
    const booking = await getBookingById(bookingId);
    if (!booking || !booking.slack_recruit_posted_at) return; // only for recruited slots
    const details = await getBookingDetailsById(bookingId);
    if (!details) return;
    const f: CommsFields = toCommsFields(details);
    const channel = await getSlackChannelForCity(f.location);
    // Clear the marker regardless so we never double-post on re-claims.
    await setRecruitPostedAt(bookingId, null);
    if (!channel) return;
    const blocks = buildClaimedBlocks({
      claimerName: f.helperName ?? "Someone",
      guestName: f.guestName,
      slotName: f.slotName,
    });
    await postToCityChannel(channel, blocks, "A recruited 1:1 slot was covered.");
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "slack_claimed_posted", note: channel.channelName ?? undefined });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "slack_claimed", note: err instanceof Error ? err.message : String(err) });
  }
}
