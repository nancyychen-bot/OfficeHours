// Minutes past a booking slot's START before an un-checked-in booking is a
// no-show. 4.5 (not 5) so a slot on a :00/:30 boundary becomes eligible at
// start+4:30 and is caught by the very next 5-minute cron tick (~5 min after
// start), instead of landing on the boundary and slipping to the following tick.
export const NO_SHOW_GRACE_MINUTES = 4.5;

/** Slots whose start is before this cutoff are eligible for the no-show sweep. */
export function noShowCutoffISO(now: Date, graceMinutes = NO_SHOW_GRACE_MINUTES): string {
  return new Date(now.getTime() - graceMinutes * 60_000).toISOString();
}
