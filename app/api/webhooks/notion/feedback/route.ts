import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { constantTimeEquals } from "@/lib/auth/token";
import { getNotionClient } from "@/lib/notion/client";
import {
  FEEDBACK_DEV_DS,
  readFeedbackEmail,
  readFeedbackName,
  readFeedbackContent,
  enrichmentProperties,
  copyableProperties,
  upsertMirrorRow,
} from "@/lib/notion/feedback";
import {
  findEventForFeedback,
  findHelperForGuest,
  getFeedbackMirror,
  upsertFeedbackMirror,
} from "@/lib/db/feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Feedback form → hub webhook. The Ambassador feedback form creates a row; a
 * Notion automation ("When page added → Send webhook") calls this route. We:
 *   1. attach the Helper (Notion Expert) — the expert from the guest's most
 *      recent Build Bar 1:1, which only the hub knows.
 *   2. fill Event Date / Location best-effort from a Build Bar match — a safety
 *      net so they aren't blank if the Notion agent (which owns event/location/
 *      date across all event types) fails; the agent overrides. Never clobbers.
 *   3. derive a numeric Satisfaction score; mirror the row into the Dev DB
 *   4. keep the Supabase feedback_mirror attribution (matched_event_id) current
 *      so the hub results dashboard's per-event rollups still work
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
  if (secret && !constantTimeEquals(provided ?? "", secret)) {
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
    const content = readFeedbackContent(props);

    // Build Bar match from the hub: Supabase attribution (feeds the results
    // dashboard) + a best-effort Event Date/Location safety net for Notion.
    const eventMatch = email ? await findEventForFeedback(email, submittedAt) : null;
    const needsReview = !eventMatch;
    // The Helper: the expert from the guest's most recent Build Bar 1:1. Computed
    // independently of the event pick.
    const helper = email ? await findHelperForGuest(email, submittedAt) : null;

    const enrichment = enrichmentProperties({
      guestName,
      eventDate: eventMatch?.eventDate ?? null,
      city: eventMatch?.city ?? null,
      helperName: helper?.helperName ?? null,
      satisfactionScore: content.satisfactionScore,
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
      matchedEventId: eventMatch?.eventId ?? null,
      needsReview,
      guestName,
      guestEmail: email,
      satisfactionScore: content.satisfactionScore,
      satisfactionLabel: content.satisfactionLabel,
      confidence: content.confidence,
      interests: content.interests,
      featureIntent: content.featureIntent,
      highlight: content.highlight,
      notionExpert: helper?.helperName ?? null,
      submittedAt,
    });

    await logSync({
      direction,
      result: "applied",
      action: needsReview ? "feedback_unmatched" : "feedback_enriched",
      note: `email=${email ?? "none"} score=${content.satisfactionScore ?? "—"} helper=${helper?.helperName ?? "—"}${eventMatch ? ` date=${eventMatch.eventDate} city=${eventMatch.city ?? "—"}` : ""}`,
    });
    return NextResponse.json({ received: true, matched: !!eventMatch });
  } catch (err) {
    await logSync({ direction, result: "error", action: "feedback_process", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ received: true, error: "processing failed" });
  }
}
