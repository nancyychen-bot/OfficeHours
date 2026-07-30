import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { env } from "../env";

/**
 * Server-only Supabase client using the service-role key.
 *
 * The hub is the single source of truth (PRD §7.2) and the arbiter for slot
 * claims (PRD §13). It always acts server-side with the service-role key, which
 * bypasses RLS. NEVER import this into client components.
 */
let cached: SupabaseClient<Database> | null = null;

export function getAdminClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(env.supabase.url(), env.supabase.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
