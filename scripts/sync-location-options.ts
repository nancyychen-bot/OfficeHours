/**
 * Backfill the Notion "Location" select options from every event city in the DB,
 * on BOTH bookings data sources (Dev + Ambassador). New events already do this at
 * registration (lib/events/register.ts); this covers events registered before that
 * hook existed, or that never got a registrant (e.g. London). Additive + idempotent.
 *
 * Usage: npm run sync:location-options
 */
import { getAdminClient } from "../lib/supabase/admin";
import { ensureLocationOption } from "../lib/notion/location-options";

async function main() {
  const supabase = getAdminClient();
  const { data, error } = await supabase.from("events").select("city").not("city", "is", null);
  if (error) throw error;

  const cities = [...new Set((data ?? []).map((e) => (e.city ?? "").trim()).filter(Boolean))].sort();
  console.log(`Syncing ${cities.length} Location options: ${cities.join(", ")}`);

  let failed = 0;
  for (const city of cities) {
    try {
      await ensureLocationOption(city);
      console.log(`  ✓ ${city}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${city}`, err);
    }
  }
  if (failed) {
    console.error(`${failed} city/cities failed — run incomplete`);
    process.exit(1);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error("sync-location-options failed:", err);
  process.exit(1);
});
