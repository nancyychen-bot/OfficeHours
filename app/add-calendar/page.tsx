import { headers } from "next/headers";
import { env } from "@/lib/env";
import { issueFormToken } from "@/lib/auth/form-token";
import { AddCalendarForm } from "@/components/hub/AddCalendarForm";

export const metadata = { title: "Connect a Luma calendar" };

export default async function AddCalendarPage() {
  await headers(); // opt out of static rendering so the token is freshly minted
  const token = await issueFormToken(env.hub.sessionSecret(), Date.now());
  const webhookUrl = `${env.app.baseUrl().replace(/\/$/, "")}/api/webhooks/luma`;
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-lg font-semibold">Connect a Luma calendar</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pre-register a region&apos;s Luma calendar so its events add themselves later. No event needed.
      </p>
      <AddCalendarForm token={token} webhookUrl={webhookUrl} />
    </main>
  );
}
