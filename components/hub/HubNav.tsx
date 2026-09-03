"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard" },
  { href: "/bookings", label: "Bookings" },
  { href: "/feedback", label: "Feedback" },
  { href: "/expert-feedback", label: "Expert Feedback" },
  { href: "/readiness", label: "Readiness" },
  { href: "/settings", label: "Settings" },
];

export function HubNav() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="mb-5 flex items-center justify-between">
      <div className="flex items-center gap-1">
        <h1 className="mr-4 text-2xl font-bold">Notion Build Bar Hub</h1>
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/add-calendar"
          target="_blank"
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          + Add calendar
        </Link>
        <Link
          href="/add-event"
          target="_blank"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + Add event
        </Link>
        <button
          onClick={() => router.refresh()}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
