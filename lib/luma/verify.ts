import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an inbound Luma webhook signature (see docs/research/luma-api.md).
 *
 * Header `Webhook-Signature: t=<unix>,v1=<hex>`. Signed payload is
 * `{t}.{rawBody}` (the RAW request body, before JSON.parse). HMAC-SHA256 keyed
 * with the `whsec_...` secret, hex digest, constant-time compared to v1.
 *
 * NOTE: this is Luma's scheme, NOT the Svix `{id}.{t}.{body}` triple.
 */
export function verifyLumaSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
  /** Reject signatures older than this many seconds (default 5 min); 0 disables. */
  toleranceSec?: number;
  /** Injectable clock for tests (unix seconds). */
  nowSec?: number;
}): boolean {
  const { rawBody, signatureHeader, secret } = params;
  if (!signatureHeader) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const { t, v1 } = parsed;

  const tolerance = params.toleranceSec ?? 300;
  if (tolerance > 0) {
    const now = params.nowSec ?? Math.floor(Date.now() / 1000);
    const ts = Number(t);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;
  }

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return safeEqualHex(expected, v1);
}

function parseSignatureHeader(header: string): { t: string; v1: string } | null {
  const parts = header.split(",").map((p) => p.trim());
  let t: string | undefined;
  let v1: string | undefined;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === "t") t = val;
    else if (key === "v1") v1 = val;
  }
  if (!t || !v1) return null;
  return { t, v1 };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
