import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { checkReadiness } from "@/lib/readiness/check";
import { emailReadinessProblems } from "@/lib/readiness/email";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily setup health check. Emails hub admins a digest ONLY when a connected
 * calendar or an upcoming event has a setup problem (bad key, no webhook secret,
 * no slots, no city, no Slack channel, bot not invited, …) — so a green setup is
 * silent and a broken one is loud. Idempotent (safe to fire more than once/day).
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report = await checkReadiness();
  const emailed = await emailReadinessProblems(report, env.app.baseUrl().replace(/\/$/, ""));
  await logSync({
    direction: "luma_in",
    result: report.errorCount > 0 ? "error" : "applied",
    action: "readiness_cron",
    note: `errors=${report.errorCount} warnings=${report.warnCount} events=${report.events.length} calendars=${report.calendars.length} emailed=${emailed}`,
  });
  return NextResponse.json({ ok: true, errors: report.errorCount, warnings: report.warnCount, emailed });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
