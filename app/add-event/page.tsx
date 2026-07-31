import { headers } from "next/headers";
import { env } from "@/lib/env";
import { issueFormToken } from "@/lib/auth/form-token";
import { AddEventForm } from "@/components/hub/AddEventForm";

// Allow embedding inside a Notion page (iframe). We deliberately do NOT set
// X-Frame-Options; frame-ancestors below is the modern, granular control.
export const metadata = { title: "Add an Office Hours event" };

export default async function AddEventPage() {
  await headers(); // opt out of static rendering so the token is freshly minted
  const token = await issueFormToken(env.hub.sessionSecret(), Date.now());
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-lg font-semibold">Track an Office Hours event</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Paste the Luma event link. We&apos;ll pull its details and slots into the hub.
      </p>
      <AddEventForm token={token} />
    </main>
  );
}
