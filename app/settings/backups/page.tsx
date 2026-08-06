import { HubNav } from "@/components/hub/HubNav";
import { SettingsNav } from "@/components/hub/SettingsNav";
import { BackupsManager, type BackupView } from "@/components/hub/BackupsManager";
import { listBackups } from "@/lib/backup/blob";

export const dynamic = "force-dynamic";

export default async function SettingsBackupsPage() {
  let backups: BackupView[] = [];
  let error: string | null = null;
  try {
    backups = (await listBackups()).map((b) => ({ pathname: b.pathname, uploadedAt: b.uploadedAt, size: b.size }));
  } catch (e) {
    error = e instanceof Error ? e.message : "failed to list backups";
  }
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <SettingsNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Daily off-site snapshots of the database. Restore one to re-add anything that was deleted and rebuild the Notion
        mirror cards — safely, without touching newer data.
      </p>
      <BackupsManager backups={backups} error={error} />
    </main>
  );
}
