# Treeoguessr — Auth & Deploy Setup

The app runs fine without any of this (guest play). Auth + progress turn on only
once the Supabase env vars are present. Do the steps in order.

## 1. Supabase project
1. Create a project at https://supabase.com (free tier is plenty).
2. **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), Run.
   For VS mode (usernames, friends, challenges), also run [`supabase/vs.sql`](supabase/vs.sql).
3. **Project Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public** key (newer dashboards call it **Publishable**) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key (secret) → `SUPABASE_SERVICE_ROLE_KEY` — **VS mode only**, server-side
     only. Never expose it to the browser or commit it.

## 2. Google sign-in
1. In **Google Cloud Console** (https://console.cloud.google.com):
   - APIs & Services → OAuth consent screen → configure (External, app name, your email).
   - Credentials → Create credentials → **OAuth client ID** → type **Web application**.
   - Under **Authorized redirect URIs** add **only** your Supabase callback:
     `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
     (Google redirects to Supabase, not to our app, so this is origin-independent.)
   - Copy the **Client ID** and **Client secret**.
2. In **Supabase → Authentication → Providers → Google**: enable it, paste the
   Client ID + secret, save.
3. In **Supabase → Authentication → URL Configuration**, add **Redirect URLs**
   (wildcards allowed) for every origin you use:
   - `http://localhost:3000/**`
   - `https://*.trycloudflare.com/**` (if still testing via the tunnel)
   - `https://<your-app>.vercel.app/**` (after deploy)
   Set **Site URL** to localhost now, switch to the Vercel URL after deploy.

## 3. Run locally
Add to `.env.local` (see [`.env.example`](.env.example)):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # VS mode only
```
Restart `npm run dev`. A **Sign in with Google** button appears top-right;
finishing a game now saves your score and shows Best / games played. The
**⚔️ Play a friend** link opens VS mode (pick a username, add friends, challenge them).

## 4. Deploy to Vercel
1. Put the code on GitHub:
   ```
   git init
   git add .
   git commit -m "Treeoguessr"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. Import the repo at https://vercel.com/new.
3. In Vercel **Project Settings → Environment Variables**, add:
   - `ROUND_SECRET` (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (for VS mode)
4. Deploy. Then add the live `https://<your-app>.vercel.app/**` URL to the
   Supabase Redirect URLs (step 2.3) and set it as the Supabase Site URL.

> Vercel's free **Hobby** plan is non-commercial. Fine for a personal project;
> a company product would need Pro.
