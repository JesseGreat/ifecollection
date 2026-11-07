// Pure logic shared by the proxy (server) and the session guard (phone). Unit-tested.

export type Role = "admin" | "staff";

/** Shape returned by the SQL function public.session_status(). */
export type SessionStatus = {
  signed_in: boolean;
  user_id?: string;
  found?: boolean;
  role?: Role | null;
  full_name?: string | null;
  username?: string | null;
  active?: boolean;
  within_hours?: boolean;
  allowed?: boolean;
  server_time?: string;
  today?: string;
  open_time?: string;
  close_time?: string;
  warn_minutes?: number;
  seconds_until_close?: number | null;
};

export const PUBLIC_PATHS = ["/login", "/offline"];

export type GateDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string; signOut: boolean };

export function homeFor(role: Role | null | undefined) {
  return role === "admin" ? "/admin" : "/sell";
}

/**
 * Decide what to do with a request. `status` is null when there is no Supabase session cookie.
 * The server (Postgres clock) is the only source of truth for "within_hours".
 */
export function gateDecision(status: SessionStatus | null, pathname: string): GateDecision {
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!status || !status.signed_in) {
    return isPublic ? { kind: "allow" } : { kind: "redirect", to: "/login", signOut: false };
  }
  if (!status.found || !status.active) {
    return { kind: "redirect", to: "/login?reason=inactive", signOut: true };
  }
  if (status.role === "staff" && !status.within_hours) {
    return { kind: "redirect", to: "/login?reason=closed", signOut: true };
  }
  if (pathname === "/" || pathname === "/login") {
    return { kind: "redirect", to: homeFor(status.role), signOut: false };
  }
  if (pathname.startsWith("/admin") && status.role !== "admin") {
    return { kind: "redirect", to: "/sell", signOut: false };
  }
  return { kind: "allow" };
}

export type ClosingState = { phase: "open" } | { phase: "warning"; secondsLeft: number } | { phase: "closed" };

/**
 * Where are we relative to closing time? Uses only the server's `secondsUntilClose` and the time that
 * has passed on the phone since we received it (a duration, so a wrong phone clock does not matter).
 */
export function closingState(
  secondsUntilClose: number | null | undefined,
  warnMinutes: number,
  elapsedMs: number,
): ClosingState {
  if (secondsUntilClose == null) return { phase: "open" }; // admin: never closes
  const left = secondsUntilClose - elapsedMs / 1000;
  if (left <= 0) return { phase: "closed" };
  if (left <= warnMinutes * 60) return { phase: "warning", secondsLeft: Math.ceil(left) };
  return { phase: "open" };
}
