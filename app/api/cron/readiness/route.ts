import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { checkReadiness, isTransientLumaOutage, shouldSuppressReadinessEmail } from "@/lib/readiness/check";
import { emailReadinessProblems } from "@/lib/readiness/email";
import { logSync } from "@/lib/sync/log";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const TRANSIENT_MARKER = "luma_transient_outage=1";

/** Did the most recent readiness run also detect a transient Luma outage? Used to
 * escalate a SUSTAINED outage (don't suppress twice in a row). */
async function prevRunWasTransientOutage(): Promise<boolean> {
  const { data } = await getAdminClient()
    .from("sync_log")
    .select("note")
    .eq("action", "readiness_cron")
    .order("created_at", { ascending: false })
    .limit(1);
  return !!data?.[0]?.note?.includes(TRANSIENT_MARKER);
}

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

  // Hold back the noisy "all calendars unreachable" email on a first transient
  // Luma blip (not actionable — Luma was briefly down). Still escalate if the
  // previous run was also a transient outage (a sustained outage worth knowing),
  // and never suppress a real problem (a rejected key, a partial outage, any
  // event/setup warning, or an untracked event all make isTransientLumaOutage false).
  const transient = isTransientLumaOutage(report);
  const suppressed = shouldSuppressReadinessEmail(transient, await prevRunWasTransientOutage());
  const emailed = suppressed ? 0 : await emailReadinessProblems(report, env.app.baseUrl().replace(/\/$/, ""));

  await logSync({
    direction: "luma_in",
    result: report.errorCount > 0 ? "error" : "applied",
    action: "readiness_cron",
    note: `errors=${report.errorCount} warnings=${report.warnCount} events=${report.events.length} calendars=${report.calendars.length} emailed=${emailed}${transient ? ` ${TRANSIENT_MARKER}` : ""}${suppressed ? " suppressed=1" : ""}`,
  });
  return NextResponse.json({ ok: true, errors: report.errorCount, warnings: report.warnCount, emailed, suppressed });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
