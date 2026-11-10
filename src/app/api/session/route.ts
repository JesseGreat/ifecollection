import { NextResponse } from "next/server";
import type { SessionStatus } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Called by the phone when the app comes back from the background, comes back online,
// and every few minutes. The answer comes from the Postgres clock.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("session_status");
  const status: SessionStatus = error || !data ? { signed_in: false } : (data as SessionStatus);
  if (status.signed_in && !status.allowed) {
    if (status.role === "staff" && status.active && !status.replaced && !status.within_hours) {
      await supabase.rpc("log_auth_event", { p_action: "auto_logout" });
    }
    await supabase.auth.signOut({ scope: "local" });
  }
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
