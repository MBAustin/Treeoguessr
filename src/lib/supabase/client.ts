import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True only once Supabase env vars are configured. Auth/progress is optional. */
export const supabaseEnabled = Boolean(url && key);

let client: SupabaseClient | null = null;

/** Memoized browser client, or null if Supabase isn't configured yet. */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (!supabaseEnabled) return null;
  if (!client) client = createBrowserClient(url!, key!);
  return client;
}
