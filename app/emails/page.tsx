import { HubNav } from "@/components/hub/HubNav";
import { EmailEditor } from "@/components/hub/EmailEditor";
import { listOverrides } from "@/lib/db/email-overrides";

export const dynamic = "force-dynamic";

export default async function EmailsPage() {
  const overrides = await listOverrides();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Edit any email, save a draft, then publish (with the passphrase) to make it the copy that actually sends. Changes to unedited emails fall back to the built-in defaults.
      </p>
      <EmailEditor overrides={overrides} />
    </main>
  );
}
