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
