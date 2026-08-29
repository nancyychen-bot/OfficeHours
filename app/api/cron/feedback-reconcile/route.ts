import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { reconcileFeedbackAttribution } from "@/lib/events/feedback-reconcile";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Feedback attribution reconciler. Vercel Cron calls this hourly; it re-reads the
 * Notion agent's Event Date + Location for still-unresolved feedback rows and
 * attributes them to the matching hub event (clearing needs_review). Best-effort.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { scanned, reconciled } = await reconcileFeedbackAttribution();
  if (reconciled > 0) {
    await logSync({
      direction: "notion_dev_in",
      result: "applied",
      action: "feedback_reconcile_cron",
      note: `scanned=${scanned} reconciled=${reconciled}`,
    });
  }
  return NextResponse.json({ scanned, reconciled });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
