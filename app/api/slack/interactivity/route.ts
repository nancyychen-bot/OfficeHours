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
