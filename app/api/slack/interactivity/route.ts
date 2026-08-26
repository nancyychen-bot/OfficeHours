import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { verifySlackSignature } from "@/lib/slack/verify";
import { parseInteraction, feedbackModalView, generalFeedbackModalView } from "@/lib/slack/interaction";
import { openModal } from "@/lib/slack/api";
import { upsertFeedbackAnswer, getFeedbackRow } from "@/lib/db/expert-feedback";
import { getGeneralFeedback, upsertGeneralFeedback } from "@/lib/db/expert-general-feedback";
import { pushExpertFeedback } from "@/lib/notion/expert-feedback";
import { pushGeneralFeedback } from "@/lib/notion/expert-general-feedback";
import { getAdminClient } from "@/lib/supabase/admin";
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
      case "feedback_submit": {
        // One write captures the per-guest form; sync the single Notion page after ack.
        await upsertFeedbackAnswer(interaction.bookingId, {
          attended: interaction.attended,
          rating: interaction.rating,
          note: interaction.note,
        });
        after(() => pushExpertFeedback(interaction.bookingId));
        break;
      }
      case "open_general": {
        // Overall event feedback (guest-less) — pre-fill from any prior submission.
        const gen = await getGeneralFeedback(interaction.eventId, interaction.expertEmail);
        await openModal(
          interaction.triggerId,
          generalFeedbackModalView(interaction.eventId, interaction.expertEmail, { note: gen?.note ?? null }),
        );
        break;
      }
      case "general_submit": {
        const { eventId, expertEmail, note } = interaction;
        // Pull the event + expert display context for the Notion page.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: bd } = await (getAdminClient() as any)
          .from("booking_details")
          .select("event_name, event_date, location, booked_by_display_name")
          .eq("event_id", eventId)
          .eq("booked_by_email", expertEmail)
          .limit(1)
          .maybeSingle();
        await upsertGeneralFeedback({
          eventId,
          expertEmail,
          expertName: bd?.booked_by_display_name ?? null,
          note: note ?? "",
          eventName: bd?.event_name ?? null,
          eventDate: bd?.event_date ?? null,
          location: bd?.location ?? null,
        });
        after(() => pushGeneralFeedback(eventId, expertEmail));
        break;
      }
      case "ignore":
        break;
    }
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", action: "slack_interactivity", note: err instanceof Error ? err.message : String(err) });
  }

  // view_submission must return an empty 200 to close the modal; others too.
  return NextResponse.json({});
}
