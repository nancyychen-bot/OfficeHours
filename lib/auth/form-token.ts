import { signToken, verifyToken } from "./token";

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * A stateless anti-bot token embedded in the public add-event form. It carries
 * the issue time; the API accepts it only if the signature is valid and it was
 * issued within MAX_AGE_MS. This stops drive-by/bot posts without requiring a
 * login or a cookie (important — the form is embedded in a Notion iframe).
 */
export async function issueFormToken(secret: string, nowMs: number): Promise<string> {
  return signToken(`form.${nowMs}`, secret);
}

export async function verifyFormToken(
  token: string,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  const payload = await verifyToken(token, secret);
  if (!payload || !payload.startsWith("form.")) return false;
  const issued = Number(payload.slice("form.".length));
  if (!Number.isFinite(issued)) return false;
  return nowMs - issued <= MAX_AGE_MS && nowMs >= issued;
}
