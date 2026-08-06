import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { listBackups, readSnapshotByPathname, createBackupNow } from "@/lib/backup/blob";
import { restoreFromSnapshot } from "@/lib/backup/restore";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 120; // restore re-pushes every booking to Notion

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

/** List available backups. */
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, backups: await listBackups() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed to list" }, { status: 500 });
  }
}

/**
 * action=backup-now — take a fresh snapshot to Blob.
 * action=restore     — merge a snapshot back in + reconcile Notion (requires passphrase).
 */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { action?: string; pathname?: string; passphrase?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    if (body.action === "backup-now") {
      const { summary, pathname } = await createBackupNow();
      return NextResponse.json({ ok: true, summary, pathname });
    }
    if (body.action === "restore") {
      const secret = process.env.HUB_PUBLISH_SECRET;
      if (!secret || body.passphrase !== secret) {
        return NextResponse.json({ error: "bad passphrase" }, { status: 403 });
      }
      if (!body.pathname) return NextResponse.json({ error: "pathname required" }, { status: 400 });
      const snapshot = await readSnapshotByPathname(body.pathname);
      const report = await restoreFromSnapshot(snapshot);
      await logSync({
        direction: "luma_in",
        result: "applied",
        action: "restore",
        note: `from=${body.pathname} added=${JSON.stringify(report.added)} notion=${JSON.stringify(report.notion)}`,
      });
      return NextResponse.json({ ok: true, report });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", action: "restore", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
