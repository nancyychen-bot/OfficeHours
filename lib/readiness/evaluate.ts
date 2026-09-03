export type IssueLevel = "error" | "warn";
export interface Issue {
  level: IssueLevel;
  message: string;
}

const err = (message: string): Issue => ({ level: "error", message });
const warn = (message: string): Issue => ({ level: "warn", message });

export interface EventCheckInput {
  city: string | null;
  timezone: string | null;
  address: string | null;
  slotCount: number;
  /** Whether the event's `luma_calendar` tag resolves to a connected calendar. */
  calendarConnected: boolean;
  /** Slack routing for the event's city, or null if none is configured. */
  slack: { postable: boolean; botInChannel: boolean | null; channelName: string | null } | null;
}

/**
 * Setup problems that would make an event silently misbehave on the day. Pure —
 * all live/DB lookups happen in the gather layer. `error` = will visibly break;
 * `warn` = degraded (still runs).
 */
export function evaluateEvent(e: EventCheckInput): Issue[] {
  const issues: Issue[] = [];

  if (!e.calendarConnected) {
    issues.push(err("Its Luma calendar isn't connected — add it at /add-calendar."));
  }
  if (e.slotCount === 0) {
    issues.push(err("No time slots — guests can't book a 1:1. Add a “Requested time slot” dropdown in Luma, then re-add the event."));
  }
  if (!e.city) {
    issues.push(err("No city — set a venue/address on the Luma event, then re-add it."));
  } else if (!e.slack || !e.slack.postable) {
    issues.push(err(`No Slack channel for ${e.city} — recruit posts won't send. Add it in slack_channels and invite @build_bar_bot.`));
  } else if (e.slack.botInChannel === false) {
    issues.push(warn(`@build_bar_bot isn't in ${e.slack.channelName ?? "the channel"} — invite it so recruit posts can send.`));
  }
  if (!e.timezone) {
    issues.push(warn("No timezone on the Luma event — calendar invite times may be wrong."));
  }
  if (!e.address) {
    issues.push(warn("No street address — calendar invites fall back to the city name."));
  }

  return issues;
}

export interface CalendarCheckInput {
  /** true = Luma accepts the key, false = rejected, null = couldn't check. */
  keyValid: boolean | null;
  hasWebhookSecret: boolean;
}

/** Setup problems with a connected calendar's credentials. */
export function evaluateCalendar(c: CalendarCheckInput): Issue[] {
  const issues: Issue[] = [];
  if (c.keyValid === false) {
    issues.push(err("Luma rejected its API key — reconnect the calendar."));
  } else if (c.keyValid === null) {
    issues.push(warn("Couldn't validate its API key (Luma unreachable) — will retry."));
  }
  if (!c.hasWebhookSecret) {
    issues.push(err("No webhook secret — new guest registrations won't sync in."));
  }
  return issues;
}
