import type { ExpertAgenda } from "../events/agenda";
import type { ExpertFeedbackPrompt } from "../events/expert-feedback";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : isoDate;
}

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
