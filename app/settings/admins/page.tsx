import { HubNav } from "@/components/hub/HubNav";
import { SettingsNav } from "@/components/hub/SettingsNav";
import { AdminsManager } from "@/components/hub/AdminsManager";
import { listAdmins } from "@/lib/db/admins";

export const dynamic = "force-dynamic";

export default async function SettingsAdminsPage() {
  const admins = await listAdmins();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <SettingsNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Who can unclaim any spot, and a manual re-sync to correct Notion drift from the source of truth.
      </p>
      <AdminsManager admins={admins} />
    </main>
  );
}
