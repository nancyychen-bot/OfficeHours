import { signToken, verifyToken } from "./token";

/** Name of the dashboard session cookie. */
export const SESSION_COOKIE = "hub_session";

/** Max cookie age in seconds (30 days). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Issue a signed session token. Payload is a constant marker; the cookie's
 * Max-Age handles expiry. The signature proves the server minted it.
 */
export async function issueSession(secret: string): Promise<string> {
  return signToken("hub-authenticated", secret);
}

/** True when the cookie value is a validly-signed session token. */
export async function isValidSession(
  token: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const payload = await verifyToken(token, secret);
  return payload === "hub-authenticated";
}
