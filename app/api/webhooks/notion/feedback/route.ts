import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getNotionClient } from "@/lib/notion/client";
import {
  FEEDBACK_DEV_DS,
  readFeedbackEmail,
  readFeedbackName,
  readSatisfactionSelect,
  parseSatisfactionScore,
  enrichmentProperties,
  copyableProperties,
  upsertMirrorRow,
} from "@/lib/notion/feedback";
import {
  findEventForFeedback,
  getFeedbackMirror,
  upsertFeedbackMirror,
} from "@/lib/db/feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Feedback form → hub webhook. The Ambassador feedback form creates a row; a
 * Notion automation ("When page added → Send webhook") calls this route. We:
 *   1. match the respondent's email to a recent booking → Event Date + Location
 *   2. derive a numeric Satisfaction score from the satisfaction select
 *   3. write those onto the Ambassador row (or flag Needs review if no match)
 *   4. mirror the whole response into the identical Dev feedback DB (idempotent)
 *
 * Best-effort: always returns 200 so Notion doesn't retry-storm.
 */
export async function POST(req: Request) {
  const direction = "notion_amb_in" as const;
  const raw = await req.text();
  let body: { page_id?: string; pageId?: string; id?: string; secret?: string; data?: { id?: string } } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    await logSync({ direction, result: "error", action: "feedback_received", note: `invalid json: ${raw.slice(0, 200)}` });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const provided =
    req.headers.get("x-webhook-secret") ?? req.headers.get("x-office-hours-secret") ?? body.secret;
  const secret = env.notionAmbassador.webhookSecret();
  if (secret && provided !== secret) {
    await logSync({ direction, result: "error", action: "feedback_verify", note: "bad secret" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pageId = body.data?.id ?? body.page_id ?? body.pageId ?? body.id;
  if (!pageId) {
    await logSync({ direction, result: "error", action: "feedback_received", note: "no page id" });
    return NextResponse.json({ error: "missing page id" }, { status: 400 });
  }

  try {
    const ambassador = getNotionClient("ambassador");
    const dev = getNotionClient("dev");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await ambassador.pages.retrieve({ page_id: pageId })) as any;
    const props = page.properties ?? {};

    const email = readFeedbackEmail(props);
    const guestName = readFeedbackName(props);
    const submittedAt: string = page.created_time ?? new Date().toISOString();
    const satisfactionScore = parseSatisfactionScore(readSatisfactionSelect(props));

    const match = email ? await findEventForFeedback(email, submittedAt) : null;
    const needsReview = !match;

    const enrichment = enrichmentProperties({
      guestName,
      eventDate: match?.eventDate ?? null,
      city: match?.city ?? null,
      helperName: match?.helperName ?? null,
      needsReview,
      satisfactionScore,
    });

    // 1) Enrich the Ambassador row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ambassador.pages.update({ page_id: pageId, properties: enrichment as any });

    // 2) Mirror into the Dev DB (all copyable form fields + the same enrichment).
    const mirror = await getFeedbackMirror(pageId);
    const devProps = { ...copyableProperties(props), ...enrichment };
    const devPageId = await upsertMirrorRow(dev, FEEDBACK_DEV_DS, devProps, mirror?.dev_page_id);

    await upsertFeedbackMirror({
      ambassadorPageId: pageId,
      devPageId,
      matchedEventId: match?.eventId ?? null,
      needsReview,
    });

    await logSync({
      direction,
      result: "applied",
      action: needsReview ? "feedback_unmatched" : "feedback_enriched",
      note: `email=${email ?? "none"} score=${satisfactionScore ?? "—"}${match ? ` date=${match.eventDate} city=${match.city ?? "—"}` : ""}`,
    });
    return NextResponse.json({ received: true, matched: !!match });
  } catch (err) {
    await logSync({ direction, result: "error", action: "feedback_process", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ received: true, error: "processing failed" });
  }
}
