import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import type { SessionStatus } from "@/lib/session";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/** Supabase client acting as the logged-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}

/** Service-role client. Bypasses RLS – only use after checking the caller is an admin. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createPlainClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * The session status that proxy.ts already fetched from Postgres for this request.
 * proxy.ts always overwrites this header, so a client cannot fake it.
 */
export async function getSessionStatus(): Promise<SessionStatus> {
  const h = await headers();
  const raw = h.get("x-ife-session");
  if (raw) {
    try {
      return JSON.parse(decodeURIComponent(raw)) as SessionStatus;
    } catch {
      /* fall through */
    }
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("session_status");
  return (data as SessionStatus) ?? { signed_in: false };
}

/** For server actions: re-check with the database (never trust a header for writes). */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("session_status");
  const status = data as SessionStatus | null;
  if (!status?.signed_in || status.role !== "admin" || !status.active) {
    throw new Error("ADMIN_ONLY");
  }
  return { supabase, status };
}
