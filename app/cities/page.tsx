import Link from "next/link";
import { listCities } from "@/lib/db/cities";
import { HubNav } from "@/components/hub/HubNav";

export const dynamic = "force-dynamic";

export default async function CitiesIndexPage() {
  const cities = await listCities();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        The comms flow + sent log, per city. Pick a city to see every email a guest or expert could receive, and what has actually gone out.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cities.map((c) => (
          <Link key={c.slug} href={`/cities/${c.slug}`} className="rounded-xl border border-line bg-white p-4 hover:bg-neutral-50">
            <div className="font-medium">{c.name}</div>
            <div className="mt-1 text-xs text-neutral-500">locale: {c.locale}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
