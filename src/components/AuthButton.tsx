"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowser, supabaseEnabled } from "@/lib/supabase/client";

export default function AuthButton() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Hide entirely until Supabase is configured, so guest play is unaffected.
  if (!supabaseEnabled) return null;
  const sb = getSupabaseBrowser()!;

  if (!user) {
    return (
      <button
        onClick={() =>
          sb.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: `${window.location.origin}/auth/callback` },
          })
        }
        className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition hover:border-green-500 dark:border-white/20"
      >
        Sign in with Google
      </button>
    );
  }

  const name =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Signed in";

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="max-w-[10rem] truncate opacity-70">{name}</span>
      <button
        onClick={() => sb.auth.signOut()}
        className="rounded-md border border-black/15 px-2 py-1 text-xs font-medium transition hover:border-red-400 dark:border-white/20"
      >
        Sign out
      </button>
    </div>
  );
}
