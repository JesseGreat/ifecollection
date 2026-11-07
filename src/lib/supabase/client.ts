"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

let client: SupabaseClient | null = null;

/** Browser Supabase client (one per tab). All access is checked by RLS in Postgres. */
export function supabaseBrowser() {
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
