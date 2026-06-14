import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google (via Supabase) redirects back here with a `code` to exchange for a
// session. See https://supabase.com/docs/guides/auth/server-side/nextjs
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
