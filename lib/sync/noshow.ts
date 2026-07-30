/** Minutes past a slot's end before an un-checked-in booking is a no-show. */
export const NO_SHOW_GRACE_MINUTES = 15;

/** Slots that ended before this cutoff are eligible for the no-show sweep. */
export function noShowCutoffISO(now: Date, graceMinutes = NO_SHOW_GRACE_MINUTES): string {
  return new Date(now.getTime() - graceMinutes * 60_000).toISOString();
}
