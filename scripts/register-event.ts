/**
 * Register an Office Hours event from Luma.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/register-event.ts \
 *     --luma <evt-id-or-url> [--city "New York"] [--slot-start 2026-08-26T21:00:00Z] [--length 30]
 *
 * --city is optional; it defaults to the Luma event's address city.
 */
import { registerEventFromLuma } from "../lib/events/register";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const lumaEvent = arg("--luma");
  const city = arg("--city"); // optional — defaults to the Luma event's address city
  if (!lumaEvent) {
    console.error("Required: --luma <evt-id-or-url>   (optional: --city, --slot-start, --length)");
    process.exit(1);
  }
  const slotStart = arg("--slot-start");
  const length = arg("--length");
  const result = await registerEventFromLuma({
    lumaEvent,
    city,
    slotStart,
    slotLengthMinutes: length ? Number(length) : undefined,
  });
  console.log("Registered:", result.eventName);
  console.log(`  slots — inserted ${result.inserted}, updated ${result.updated}, deleted ${result.deleted}, kept-booked ${result.skippedDeletes}`);
}

main().catch((err) => {
  console.error("register-event failed:", err);
  process.exit(1);
});
