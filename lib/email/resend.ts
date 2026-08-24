import { Resend } from "resend";
import { env } from "../env";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  /** MIME type, e.g. "text/calendar; method=REQUEST" so clients render an invite. */
  contentType?: string;
}

/**
 * Send one email via Resend. Throws on failure; callers treat sending as
 * best-effort and record the outcome in email_log.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  const resend = new Resend(env.comms.apiKey());
  const replyTo = env.comms.replyTo();
  const { data, error } = await resend.emails.send({
    from: env.comms.from(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(replyTo ? { replyTo } : {}),
    ...(input.attachments?.length
      ? {
          attachments: input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentType ? { content_type: a.contentType } : {}),
          })),
        }
      : {}),
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? String(error)}`);
  return { id: data?.id ?? "" };
}

/**
 * Fetch a previously-sent email's exact content from Resend by id, or null
 * (empty id / aged-out 404 / error). Best-effort — used by the Hub email log.
 */
export async function getSentEmail(
  resendId: string,
): Promise<{ subject: string; html: string; text: string; to: string[] } | null> {
  if (!resendId) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/${resendId}`, {
      headers: { Authorization: `Bearer ${env.comms.apiKey()}` },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { subject?: string; html?: string; text?: string; to?: string[] | string };
    return {
      subject: d.subject ?? "",
      html: d.html ?? "",
      text: d.text ?? "",
      to: Array.isArray(d.to) ? d.to : d.to ? [d.to] : [],
    };
  } catch {
    return null;
  }
}
