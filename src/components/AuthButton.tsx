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

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Signed in";
  const firstName = String(fullName).split(/[\s@]/)[0];

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[8rem] truncate text-sm opacity-70 sm:inline">{firstName}</span>
      <button
        onClick={() => sb.auth.signOut()}
        className="whitespace-nowrap rounded-md border border-black/15 px-2.5 py-1.5 text-xs font-medium transition hover:border-red-400 hover:text-red-600 dark:border-white/20 dark:hover:text-red-400"
      >
        Sign out
      </button>
    </div>
  );
}
