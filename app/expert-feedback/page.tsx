import { listExpertFeedback } from "@/lib/hub/expert-feedback";
import { HubNav } from "@/components/hub/HubNav";
import { ExpertFeedbackTab } from "@/components/hub/ExpertFeedbackTab";

export const dynamic = "force-dynamic";

export default async function ExpertFeedbackPage() {
  const rows = await listExpertFeedback();
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Feedback experts submitted in Slack after their 1:1s — per-guest (Guest) and overall (General).
      </p>
      <ExpertFeedbackTab rows={rows} />
    </main>
  );
}
