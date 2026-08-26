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
import { findNotion101Event } from "@/lib/notion/notion101";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Feedback form → hub webhook. The Ambassador feedback form creates a row; a
 * Notion automation ("When page added → Send webhook") calls this route. We:
 *   1. attach the Helper (Notion Expert) — the expert from the guest's most
 *      recent Build Bar 1:1, which only the hub knows.
 *   2. fill Event Date / Location by cross-referencing the guest's email against
 *      both event sources (hub Build Bar bookings + the Notion 101 Guest DB) and
 *      taking the most recent. Best-effort + never writes null, so it's a safety
 *      net that never clobbers what the Notion agent set.
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

    // Cross-reference both event sources by email (the code plays "agent"):
    //  - Build Bar attendees live in the hub (Supabase) — also drives the results
    //    dashboard attribution + the 1:1 helper.
    //  - Everyone else (Notion 101, …) lives in the Notion 101 Guest Database.
    const bbMatch = email ? await findEventForFeedback(email, submittedAt) : null;
    const n101 = email ? await findNotion101Event(email, submittedAt) : null;
    const needsReview = !bbMatch; // hub/dashboard attribution is Build Bar only
    const helper = email ? await findHelperForGuest(email, submittedAt) : null;

    // Event Date + Location come from whichever event is most recent across the
    // two sources. Best-effort (never writes null → never clobbers the agent).
    const sources = [
      bbMatch && { eventDate: bbMatch.eventDate, city: bbMatch.city },
      n101 && { eventDate: n101.eventDate, city: n101.city },
    ].filter(Boolean) as Array<{ eventDate: string; city: string | null }>;
    const chosen = sources.sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1))[0] ?? null;

    const enrichment = enrichmentProperties({
      guestName,
      eventDate: chosen?.eventDate ?? null,
      city: chosen?.city ?? null,
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
      matchedEventId: bbMatch?.eventId ?? null,
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
      action: chosen ? "feedback_enriched" : "feedback_unmatched",
      note: `email=${email ?? "none"} score=${content.satisfactionScore ?? "—"} helper=${helper?.helperName ?? "—"}${chosen ? ` date=${chosen.eventDate} city=${chosen.city ?? "—"} src=${bbMatch ? "buildbar" : "notion101"}` : ""}`,
    });
    return NextResponse.json({ received: true, matched: !!chosen });
  } catch (err) {
    await logSync({ direction, result: "error", action: "feedback_process", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ received: true, error: "processing failed" });
  }
}
