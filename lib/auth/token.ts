/**
 * Stateless signed tokens via HMAC-SHA256 (Web Crypto, so it runs in both the
 * Node runtime and Edge middleware). A token is `${payload}.${hexSignature}`.
 * `verifyToken` returns the payload only when the signature matches, using a
 * constant-time comparison.
 */

async function hmacHex(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(payload: string, secret: string): Promise<string> {
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmacHex(payload, secret);
  return timingSafeEqual(sig, expected) ? payload : null;
}

/** Constant-time string equality (exported for password checks). */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(a, b);
}
