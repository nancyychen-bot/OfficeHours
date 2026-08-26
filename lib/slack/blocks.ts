import type { ExpertAgenda } from "../events/agenda";
import type { ExpertFeedbackPrompt } from "../events/expert-feedback";
import { shortDate } from "./format";

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

/** DM blocks: one message per expert, one "Give feedback" button per 1:1. Pure.
 * Each button (action_id fb_open, value `${bookingId}`) opens a modal form with a
 * Submit button — the actual attendance/rating/note are captured there in one go. */
export function buildFeedbackBlocks(p: ExpertFeedbackPrompt): unknown[] {
  const when = shortDate(p.eventDate);
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `🙌 *How did your Build Bar go?* — ${p.eventName ?? "Build Bar"}${when ? ` (${when})` : ""}` } },
  ];
  // Overall event feedback (guest-less) at the top — opens a written-box modal.
  if (p.eventId) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "Share your overall thoughts on the event 👇" },
      accessory: { type: "button", action_id: "gfb_open", text: { type: "plain_text", text: "📝 Overall event feedback", emoji: true }, value: `${p.eventId}|${p.email}` },
    });
  }
  blocks.push({ type: "divider" });
  if (p.items.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Optionally, leave feedback on each 1:1:" }] });
  }
  for (const it of p.items) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${it.guestName}*${it.slotName ? ` · ${it.slotName}` : ""}${it.challenge ? `\n_${it.challenge}_` : ""}` },
      accessory: { type: "button", action_id: "fb_open", text: { type: "plain_text", text: "Give feedback", emoji: true }, value: it.bookingId },
    });
  }
  return blocks;
}

export interface GuestCancelledInput {
  guestName: string;
  eventName: string | null;
  eventDate: string | null;
  slotName: string | null;
  /** City recruit channel id for a clickable <#…> mention, or null if none configured. */
  channelId: string | null;
}

/** DM blocks nudging an expert to claim a replacement after their guest cancels. Pure. */
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
