import { redirect } from "next/navigation";
import { homeFor } from "@/lib/session";
import { getSessionStatus } from "@/lib/supabase/server";

// proxy.ts normally redirects "/" before we get here; this is a fallback.
export default async function Home() {
  const status = await getSessionStatus();
  redirect(status.signed_in && status.allowed ? homeFor(status.role) : "/login");
}
