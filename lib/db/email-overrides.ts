import { getAdminClient } from "../supabase/admin";
import type { OverrideMap } from "../email/templates";

/** email_overrides isn't in the generated types; access it loosely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getAdminClient() as any).from("email_overrides");
}

export interface OverrideRow {
  key: string;
  draft_subject: string | null;
  draft_body: string | null;
  draft_note: string | null;
  draft_updated_at: string | null;
  live_subject: string | null;
  live_body: string | null;
  live_updated_at: string | null;
}

/** All override rows (draft + live) for the editor. */
export async function listOverrides(): Promise<OverrideRow[]> {
  const { data, error } = await table().select("*");
  if (error) throw error;
  return (data ?? []) as OverrideRow[];
}

/** Map of key → published subject/body (only where a live override exists). */
export async function getLiveOverrideMap(): Promise<OverrideMap> {
  const { data, error } = await table().select("key,live_subject,live_body");
  if (error) throw error;
  const map: OverrideMap = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) {
    if (r.live_subject != null || r.live_body != null) {
      map.set(r.key as string, { subject: r.live_subject ?? undefined, body: r.live_body ?? undefined });
    }
  }
  return map;
}

/** Save (upsert) a draft for a template. */
export async function saveDraft(key: string, subject: string, body: string, note: string | null): Promise<void> {
  const { error } = await table().upsert(
    { key, draft_subject: subject, draft_body: body, draft_note: note, draft_updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) throw error;
}

/** Publish: copy the draft into live, then clear the draft. */
export async function publishDraft(key: string): Promise<void> {
  const { data, error } = await table().select("draft_subject,draft_body").eq("key", key).maybeSingle();
  if (error) throw error;
  if (!data || (data.draft_subject == null && data.draft_body == null)) return; // nothing to publish
  const { error: upErr } = await table()
    .update({
      live_subject: data.draft_subject,
      live_body: data.draft_body,
      live_updated_at: new Date().toISOString(),
      draft_subject: null,
      draft_body: null,
      draft_note: null,
      draft_updated_at: null,
    })
    .eq("key", key);
  if (upErr) throw upErr;
}

/** Discard the draft for a template (leaves live untouched). */
export async function discardDraft(key: string): Promise<void> {
  const { error } = await table()
    .update({ draft_subject: null, draft_body: null, draft_note: null, draft_updated_at: null })
    .eq("key", key);
  if (error) throw error;
}
