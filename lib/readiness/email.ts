import { sendEmail } from "../email/resend";
import { problemsOnly, type CalendarReport, type EventReport, type ReadinessReport } from "./check";

/** Who gets the setup-problem alert. Defaults to Nancy; override with a
 * comma-separated READINESS_ALERT_EMAILS env var if the recipients change. */
function alertRecipients(): string[] {
  const configured = process.env.READINESS_ALERT_EMAILS?.split(",").map((s) => s.trim()).filter(Boolean);
  return configured?.length ? configured : ["nchen@makenotion.com"];
}

const icon = (level: string) => (level === "error" ? "🔴" : "🟠");

function renderText(calendars: CalendarReport[], events: EventReport[], baseUrl: string): string {
  const lines: string[] = ["Build Bar setup needs attention.\n"];
  if (calendars.length) {
    lines.push("CALENDARS:");
    for (const c of calendars) {
      lines.push(`  ${c.id}`);
      for (const i of c.issues) lines.push(`    ${icon(i.level)} ${i.message}`);
    }
    lines.push("");
  }
  if (events.length) {
    lines.push("EVENTS:");
    for (const e of events) {
      lines.push(`  ${e.name} — ${e.city ?? "?"} (${e.eventDate})`);
      for (const i of e.issues) lines.push(`    ${icon(i.level)} ${i.message}`);
    }
    lines.push("");
  }
  lines.push(`Full status: ${baseUrl}/readiness`);
  return lines.join("\n");
}

function renderHtml(calendars: CalendarReport[], events: EventReport[], baseUrl: string): string {
  const section = (title: string, rows: string) =>
    rows ? `<h3 style="margin:16px 0 6px">${title}</h3>${rows}` : "";
  const issueList = (issues: { level: string; message: string }[]) =>
    `<ul style="margin:4px 0 10px 18px;padding:0">${issues
      .map((i) => `<li style="margin:2px 0">${icon(i.level)} ${escapeHtml(i.message)}</li>`)
      .join("")}</ul>`;
  const calRows = calendars
    .map((c) => `<div><strong>${escapeHtml(c.id)}</strong>${issueList(c.issues)}</div>`)
    .join("");
  const evRows = events
    .map((e) => `<div><strong>${escapeHtml(e.name)}</strong> — ${escapeHtml(e.city ?? "?")} (${e.eventDate})${issueList(e.issues)}</div>`)
    .join("");
  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#111;max-width:620px">`,
    `<p>Some Build Bar setup needs attention before these events run:</p>`,
    section("Calendars", calRows),
    section("Events", evRows),
    `<p style="margin-top:16px"><a href="${baseUrl}/readiness">Open the full readiness page →</a></p>`,
    `</div>`,
  ].join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/**
 * Email hub admins a digest of setup problems. No-op (returns 0) when there are no
 * problems or no admins — so a daily cron only ever emails when something's wrong.
 */
export async function emailReadinessProblems(report: ReadinessReport, baseUrl: string): Promise<number> {
  const { calendars, events } = problemsOnly(report);
  if (!calendars.length && !events.length) return 0;
  const recipients = alertRecipients();

  const subject = `⚠️ Build Bar setup needs attention (${report.errorCount} error${report.errorCount === 1 ? "" : "s"}, ${report.warnCount} warning${report.warnCount === 1 ? "" : "s"})`;
  const html = renderHtml(calendars, events, baseUrl);
  const text = renderText(calendars, events, baseUrl);
  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html, text });
      sent++;
    } catch (err) {
      console.error("[readiness] alert email failed for", to, err);
    }
  }
  return sent;
}
