import { list, put } from "@vercel/blob";
import { buildSnapshot, type Snapshot } from "./snapshot";

// On Vercel the SDK resolves credentials from the linked Blob store; locally a
// token would be needed (we don't run Blob locally).
const token = process.env.BLOB_READ_WRITE_TOKEN;
const auth = token ? { token } : {};

export interface BackupEntry {
  pathname: string;
  downloadUrl: string;
  size: number;
  uploadedAt: string;
  stamp: string;
}

/** All daily snapshots in the Blob store, newest first. */
export async function listBackups(): Promise<BackupEntry[]> {
  const { blobs } = await list({ prefix: "backups/", ...auth });
  return blobs
    .map((b) => ({
      pathname: b.pathname,
      // For private blobs this is the authenticated URL to fetch the content.
      downloadUrl: (b as { downloadUrl?: string }).downloadUrl ?? b.url,
      size: b.size,
      uploadedAt: typeof b.uploadedAt === "string" ? b.uploadedAt : new Date(b.uploadedAt).toISOString(),
      stamp: b.pathname.replace(/^backups\//, "").replace(/\.json$/, ""),
    }))
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

/** Fetch + parse a snapshot by its pathname (e.g. "backups/2026-08-06T09-00-00Z.json"). */
export async function readSnapshotByPathname(pathname: string): Promise<Snapshot> {
  const entry = (await listBackups()).find((b) => b.pathname === pathname);
  if (!entry) throw new Error("backup not found");
  const res = await fetch(entry.downloadUrl);
  if (!res.ok) throw new Error(`could not read backup (HTTP ${res.status})`);
  return (await res.json()) as Snapshot;
}

/** Take a fresh snapshot now and store it (same shape/location as the daily cron). */
export async function createBackupNow(): Promise<{ summary: Record<string, number>; pathname: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const pathname = `backups/${stamp}.json`;
  const snapshot = await buildSnapshot(stamp);
  await put(pathname, JSON.stringify(snapshot), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    ...auth,
  });
  return { summary: snapshot.summary, pathname };
}
