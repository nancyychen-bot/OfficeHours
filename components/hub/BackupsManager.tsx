"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface BackupView {
  pathname: string;
  uploadedAt: string;
  size: number;
}

interface RestoreReport {
  added: Record<string, number>;
  notion: { recreated: number; updated: number };
  orphans: { dev: string[]; ambassador: string[] } | null;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupsManager({ backups, error }: { backups: BackupView[]; error: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null); // pathname mid-confirm
  const [passphrase, setPassphrase] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);

  async function backupNow() {
    setBusy("backup"); setMsg(null); setReport(null);
    try {
      const res = await fetch("/api/hub/backups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup-now" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Backup failed.");
      setMsg({ kind: "ok", text: "Backup created." });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
    } finally { setBusy(null); }
  }

  async function confirmRestore(pathname: string) {
    setBusy("restore"); setMsg(null); setReport(null);
    try {
      const res = await fetch("/api/hub/backups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", pathname, passphrase }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === "bad passphrase" ? "Wrong passphrase." : (data.error ?? "Restore failed."));
      setReport(data.report as RestoreReport);
      setMsg({ kind: "ok", text: "Restore complete." });
      setRestoring(null); setPassphrase("");
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Backups</h2>
            <p className="mt-1 text-sm text-neutral-500">
              A snapshot is taken automatically every day at 9am and stored off-site. Restoring is
              <span className="font-medium"> merge-only</span> — it re-adds anything missing and rebuilds the Notion cards,
              and can never delete or overwrite newer data.
            </p>
          </div>
          <button onClick={backupNow} disabled={busy !== null}
            className="shrink-0 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            {busy === "backup" ? "Backing up…" : "Back up now"}
          </button>
        </div>
        {msg && <p className={`mt-3 text-sm ${msg.kind === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}
      </section>

      {report && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-neutral-700">
          <p className="mb-1 font-semibold text-green-800">Restore summary</p>
          <ul className="ml-4 list-disc space-y-0.5">
            {Object.entries(report.added).map(([t, n]) => <li key={t}>{t}: added {n}</li>)}
            <li>Notion cards: {report.notion.recreated} recreated, {report.notion.updated} updated</li>
            <li>
              Orphan Notion cards (no matching booking):{" "}
              {report.orphans
                ? `${report.orphans.dev.length} dev, ${report.orphans.ambassador.length} ambassador (left as-is)`
                : "scan skipped"}
            </li>
          </ul>
        </section>
      )}

      <section>
        {error ? (
          <p className="text-sm text-red-600">Couldn’t load backups: {error}</p>
        ) : backups.length === 0 ? (
          <p className="text-sm text-neutral-500">No backups yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr><th className="px-4 py-2 font-medium">Snapshot</th><th className="px-4 py-2 font-medium">Size</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {backups.map((b) => (
                  <tr key={b.pathname}>
                    <td className="px-4 py-2 font-medium">{fmtDate(b.uploadedAt)}</td>
                    <td className="px-4 py-2 text-neutral-500">{fmtSize(b.size)}</td>
                    <td className="px-4 py-2 text-right">
                      {restoring === b.pathname ? (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                            placeholder="Passphrase" autoFocus
                            className="w-36 rounded-md border border-line px-2 py-1 text-xs"
                          />
                          <button onClick={() => confirmRestore(b.pathname)} disabled={busy !== null || !passphrase}
                            className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
                            {busy === "restore" ? "Restoring…" : "Confirm"}
                          </button>
                          <button onClick={() => { setRestoring(null); setPassphrase(""); }} disabled={busy !== null}
                            className="text-xs text-neutral-500 hover:underline">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => { setRestoring(b.pathname); setMsg(null); setReport(null); }}
                          className="text-xs font-medium text-blue-600 hover:underline">
                          Restore
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
