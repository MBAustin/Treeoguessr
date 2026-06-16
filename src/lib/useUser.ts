"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowser, supabaseEnabled } from "./supabase/client";

/**
 * The currently signed-in Supabase user, or null (guest / Supabase not
 * configured). Mirrors the subscription in AuthButton so other components can
 * react to sign-in/out. `loading` is true until the first auth check resolves.
 */
export function useUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  // Only "loading" if there's actually an auth check to run; guests resolve
  // immediately (and avoids a synchronous setState inside the effect).
  const [loading, setLoading] = useState(supabaseEnabled);

  useEffect(() => {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
