import { renderComms, type CommsFields, type CommsKind, type Recipient } from "@/lib/email/templates";
import { HubNav } from "@/components/hub/HubNav";

// A live gallery of every transactional/automated email, rendered with sample
// data. Behind the existing login. Pure render — no DB.
export const dynamic = "force-static";

const BASE: CommsFields = {
  bookingId: "preview",
  guestName: "Nancy Chen",
  guestEmail: "guest@example.com",
  company: "Notion",
  role: "Community",
  challenge: "Automating my team's roadmap in Notion",
  guestPhone: "+1 555-0100",
  slotName: "2:00–2:30 PM",
  slotStartsAt: "2026-08-28T21:00:00Z",
  slotEndsAt: "2026-08-28T21:30:00Z",
  eventName: "Notion Build Bar",
  eventDate: "2026-08-28",
  location: "New York",
  address: "123 Example St, New York, NY",
  helperName: "Alex Rivera",
  helperEmail: "alex@example.com",
  status: "assigned",
};

// Lifecycle order, with human labels + a note on when each fires.
const ITEMS: Array<{ kind: CommsKind; roles: Recipient[]; label: string; when: string; sample?: Partial<CommsFields> }> = [
  { kind: "prep_reminder", roles: ["guest"], label: "Prep reminder", when: "3 days before — approved guests" },
  { kind: "assigned", roles: ["guest", "helper"], label: "1:1 confirmed / assigned", when: "when an expert claims a booking (calendar invite attached)" },
  { kind: "checked_in", roles: ["guest", "helper"], label: "Checked in", when: "guest checks in at the door" },
  { kind: "checked_in", roles: ["guest"], label: "Checked in — no expert matched", when: "guest wanted a 1:1 but wasn't claimed", sample: { helperName: null } },
  { kind: "arrived_after_no_show", roles: ["guest", "helper"], label: "Arrived after no-show", when: "guest checks in after being marked no-show" },
  { kind: "no_show", roles: ["helper"], label: "No-show", when: "guest never checked in (5 min after slot start)" },
  { kind: "expert_unavailable", roles: ["guest", "helper"], label: "Expert unavailable / unclaimed", when: "an expert releases a booking" },
  { kind: "double_booked", roles: ["helper"], label: "Double-booked", when: "an expert claims 2+ guests in the same slot" },
  { kind: "waitlisted", roles: ["guest", "helper"], label: "Waitlisted", when: "Luma Status set to Waitlist" },
  { kind: "declined", roles: ["guest", "helper"], label: "Declined (at capacity)", when: "Luma Status set to Declined" },
  { kind: "cancelled", roles: ["guest", "helper"], label: "Cancelled", when: "guest cancels their registration" },
  { kind: "event_cancelled", roles: ["guest", "helper"], label: "Event cancelled", when: "the whole event is cancelled" },
  { kind: "feedback_request", roles: ["guest"], label: "Feedback request", when: "the minute the event ends — checked-in guests" },
];

function roleBadge(role: Recipient) {
  const cls = role === "guest" ? "bg-blue-100 text-blue-800" : "bg-violet-100 text-violet-700";
  return <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${cls}`}>{role}</span>;
}

export default function EmailsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <p className="mb-6 max-w-2xl text-sm text-neutral-500">
        Every automated email, rendered with sample data. Copy edits live in <code className="rounded bg-neutral-100 px-1">lib/email/templates.ts</code>.
      </p>

      <div className="space-y-8">
        {ITEMS.map((item, idx) => (
          <section key={`${item.kind}-${idx}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-neutral-900">{item.label}</h2>
              {item.roles.map((r) => roleBadge(r))}
              <span className="text-xs text-neutral-400">— {item.when}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {item.roles.map((role) => {
                const rendered = renderComms(item.kind, role, { ...BASE, ...item.sample });
                if (!rendered) return null;
                return (
                  <div key={role} className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
                    <div className="border-b border-line bg-neutral-50 px-4 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-400">Subject · to {role}</div>
                      <div className="text-sm font-medium text-neutral-800">{rendered.subject}</div>
                    </div>
                    <div className="px-4 py-3 text-sm leading-relaxed text-neutral-700" dangerouslySetInnerHTML={{ __html: rendered.html }} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
