import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { verifySlackSignature } from "@/lib/slack/verify";
import { parseInteraction, feedbackModalView } from "@/lib/slack/interaction";
import { openModal } from "@/lib/slack/api";
import { upsertFeedbackAnswer, getFeedbackRow } from "@/lib/db/expert-feedback";
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
      case "open_feedback": {
        // Fetch current answers so the modal pre-fills (re-open shows what was saved).
        const row = await getFeedbackRow(interaction.bookingId);
        await openModal(
          interaction.triggerId,
          feedbackModalView(interaction.bookingId, {
            guestName: row?.guest_name ?? "this guest",
            attended: row?.attended,
            rating: row?.rating,
            note: row?.note,
          }),
        );
        break;
      }
      case "feedback_submit":
        // One write captures the whole form; sync the single Notion page after ack.
        await upsertFeedbackAnswer(interaction.bookingId, {
          attended: interaction.attended,
          rating: interaction.rating,
          note: interaction.note,
        });
        after(() => pushExpertFeedback(interaction.bookingId));
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
