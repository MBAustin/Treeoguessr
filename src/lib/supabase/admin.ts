import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True only once the server-only service-role key is configured. */
export const adminEnabled = Boolean(url && serviceKey);

let admin: SupabaseClient | null = null;

/**
 * Service-role Supabase client for privileged server-side writes (freezing
 * match rounds, recording validated scores). Bypasses RLS — never import this
 * into client code, and always authenticate the user first in the route.
 */
export function createAdminClient(): SupabaseClient {
  if (!adminEnabled) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  if (!admin) {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
