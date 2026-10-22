import { notFound } from "next/navigation";
import { getCityBySlug, listCitySentLog } from "@/lib/db/cities";
import { HubNav } from "@/components/hub/HubNav";
import { CityTabs } from "@/components/hub/CityTabs";

export const dynamic = "force-dynamic";

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const city = await getCityBySlug(slug);
  if (!city) notFound();
  const sentLog = await listCitySentLog(slug);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <HubNav />
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-bold">{city.name}</h2>
        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs text-violet-700">locale: {city.locale}</span>
      </div>
      <CityTabs sentLog={sentLog} />
    </main>
  );
}
