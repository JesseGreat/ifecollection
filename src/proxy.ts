// Runs before every page request (Next 16 renamed "middleware" to "proxy").
// 1. Refreshes the Supabase session cookie.
// 2. Asks POSTGRES (not the phone, not this server's clock) whether this user may use the app now.
// 3. Signs staff out and sends them to the login page outside working hours.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gateDecision, type SessionStatus } from "@/lib/session";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  // Never let a client supply our internal header.
  const forwarded = new Headers(request.headers);
  forwarded.delete("x-ife-session");

  let response = NextResponse.next({ request: { headers: forwarded } });
  const cookieWrites: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        cookieWrites.push(...list);
      },
    },
  });

  let status: SessionStatus | null = null;
  // getSession() refreshes an expired access token. We do NOT trust it on its own: the RPC below is
  // verified by Supabase (JWT signature) and answered by Postgres.
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    const { data, error } = await supabase.rpc("session_status");
    status = error ? { signed_in: false } : (data as SessionStatus);
  }

  const decision = gateDecision(status, request.nextUrl.pathname);

  if (decision.kind === "redirect") {
    if (decision.signOut) {
      // Record closing-time logouts here: once the shop is closed, the phone's own request is refused.
      if (status?.signed_in && status.role === "staff" && status.active && !status.replaced && !status.within_hours) {
        await supabase.rpc("log_auth_event", { p_action: "auto_logout" });
      }
      await supabase.auth.signOut({ scope: "local" });
    }
    response = NextResponse.redirect(new URL(decision.to, request.url));
  } else {
    if (status?.signed_in) {
      forwarded.set("x-ife-session", encodeURIComponent(JSON.stringify(status)));
    }
    response = NextResponse.next({ request: { headers: forwarded } });
  }

  cookieWrites.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    // Everything except static files, images, the service worker, manifest, icons and API routes
    // (API routes check the session themselves).
    "/((?!_next/static|_next/image|api/|sw.js|manifest.webmanifest|icons/|favicon.ico|offline|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)",
  ],
};
