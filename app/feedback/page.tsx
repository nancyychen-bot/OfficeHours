import { listFeedback, listEvents } from "@/lib/hub/queries";
import { eventChips } from "@/lib/hub/format";
import { HubNav } from "@/components/hub/HubNav";
import { FeedbackTab } from "@/components/hub/FeedbackTab";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const [feedback, events] = await Promise.all([listFeedback(), listEvents()]);
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Post-event feedback responses, enriched with the matched event and Notion Expert.
      </p>
      <FeedbackTab feedback={feedback} chips={eventChips(events)} />
    </main>
  );
}
