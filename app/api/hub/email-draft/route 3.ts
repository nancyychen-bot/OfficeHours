import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { saveDraft, publishDraft, discardDraft } from "@/lib/db/email-overrides";
import { TEMPLATE_REGISTRY, type TemplateKey } from "@/lib/email/templates";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

/**
 * Email-copy editor actions (all require a valid hub session):
 *   action=save     — write a draft for a template key
 *   action=discard  — clear a draft
 *   action=publish  — promote draft → live (ALSO requires the publish passphrase)
 */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { action?: string; key?: string; subject?: string; body?: string; note?: string; passphrase?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const key = body.key as TemplateKey | undefined;
  if (!key || !(key in TEMPLATE_REGISTRY)) {
    return NextResponse.json({ error: "unknown template key" }, { status: 400 });
  }

  try {
    if (body.action === "save") {
      await saveDraft(key, body.subject ?? "", body.body ?? "", body.note ?? null);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "discard") {
      await discardDraft(key);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "publish") {
      const secret = process.env.HUB_PUBLISH_SECRET;
      if (!secret || body.passphrase !== secret) {
        return NextResponse.json({ error: "bad passphrase" }, { status: 403 });
      }
      await publishDraft(key);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
