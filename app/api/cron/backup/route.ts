import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { env } from "@/lib/env";
import { buildSnapshot } from "@/lib/backup/snapshot";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily off-site backup. Vercel Cron calls this; it snapshots every hub table and
 * writes one JSON to Vercel Blob (private) so the data survives even a full DB
 * wipe. No-ops (logs) if no Blob store is connected yet.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN; // optional: SDK also resolves from a linked store
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshot = await buildSnapshot(stamp);
    const { url } = await put(`backups/${stamp}.json`, JSON.stringify(snapshot), {
      access: "private", // PII — requires authentication to read
      addRandomSuffix: false,
      contentType: "application/json",
      ...(token ? { token } : {}),
    });
    await logSync({
      direction: "luma_in",
      result: "applied",
      action: "backup_cron",
      note: `rows=${JSON.stringify(snapshot.summary)} url=${url}`,
    });
    return NextResponse.json({ ok: true, summary: snapshot.summary });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", action: "backup_cron", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "backup failed" }, { status: 500 });
  }
}

export const GET = POST;
