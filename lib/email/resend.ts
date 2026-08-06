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
