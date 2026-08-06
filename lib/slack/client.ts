import { getBookingById, getBookingDetailsById } from "../db/bookings";
import { getSlackChannelForCity } from "../db/slack";
import { toCommsFields } from "../email/comms";
import type { CommsFields } from "../email/templates";
import { logSync } from "../sync/log";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08-28" → "Aug 28" (no timezone parsing so the date never shifts). */
function shortDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : isoDate;
}

/** Direct link to a Notion card (experts click through and hit its Claim button). */
export function notionCardUrl(pageId: string | null | undefined): string | null {
  if (!pageId) return null;
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
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
  cardUrl: string | null;
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
  if (i.cardUrl) {
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "Claim this 1:1 in Notion", emoji: true }, url: i.cardUrl, style: "primary" },
      ],
    });
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
    const cardUrl = notionCardUrl(booking.notion_ambassador_page_id ?? booking.notion_dev_page_id);
    const blocks = buildRecruitBlocks({
      guestName: f.guestName,
      role: f.role,
      company: f.company,
      challenge: f.challenge,
      eventName: f.eventName,
      eventDate: f.eventDate,
      slotName: f.slotName,
      location: f.location,
      cardUrl,
    });
    await postBlocks(channel.webhookUrl, blocks);
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "slack_recruit_posted", note: channel.channelName ?? undefined });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "slack_recruit", note: err instanceof Error ? err.message : String(err) });
  }
}
