import { Resend } from "resend";
import { env } from "../env";

/** Send a plain-text email via Resend. Throws on failure; callers treat as best-effort. */
export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<void> {
  const resend = new Resend(env.email.apiKey());
  const { error } = await resend.emails.send({
    from: env.email.from(),
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? String(error)}`);
}
