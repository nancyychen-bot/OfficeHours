import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { registerEventFromLuma, CalendarNotConnectedError } from "@/lib/events/register";
import { listUntrackedEvents } from "@/lib/readiness/untracked";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RegisterResult {
  eventId: string;
  ok: boolean;
  name?: string;
  slots?: number;
  importedGuests?: number;
  error?: string;
}

/**
 * Register + backfill one untracked event (by `evt-` id) or, with no id, every
 * untracked event the sync log has seen. Registration resolves the owning calendar
 * from the stored keys and backfills all guests who already registered. The "either"
 * to /add-event's manual "or". Operator-only.
 */
export async function POST(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { eventId?: string };
  const one = String(body.eventId ?? "").trim();
  const ids = one ? [one] : (await listUntrackedEvents()).map((u) => u.eventId);

  const results: RegisterResult[] = [];
  for (const eventId of ids) {
    try {
      const r = await registerEventFromLuma({ lumaEvent: eventId });
      results.push({ eventId, ok: true, name: r.eventName, slots: r.inserted + r.updated, importedGuests: r.importedGuests });
    } catch (err) {
      const msg =
        err instanceof CalendarNotConnectedError
          ? "Its calendar isn't connected — add it at /add-calendar first."
          : err instanceof Error
            ? err.message
            : "failed";
      results.push({ eventId, ok: false, error: msg });
    }
  }

  const registered = results.filter((r) => r.ok).length;
  const guests = results.reduce((n, r) => n + (r.importedGuests ?? 0), 0);
  await logSync({
    direction: "luma_in",
    result: results.some((r) => !r.ok) ? "error" : "applied",
    action: "register_untracked",
    note: `registered=${registered}/${ids.length} guestsBackfilled=${guests}`,
  });

  return NextResponse.json({ ok: true, registered, total: ids.length, results });
}
