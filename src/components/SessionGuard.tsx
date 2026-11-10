"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock, formatCountdown } from "@/lib/format";
import { closingState, type ClosingState, type SessionStatus } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";

// Also how quickly a device notices it was replaced by a newer login elsewhere.
const RECHECK_MS = 60 * 1000;

/**
 * Everyone: re-checks with the server so a device replaced by a newer login (one device per account)
 * goes back to the login page. Staff: shows a countdown before closing and logs out at closing time.
 * The countdown starts from the SERVER's seconds_until_close; the phone only measures elapsed time
 * (performance.now), so a wrong phone clock changes nothing. The server enforces the rule anyway
 * (proxy + RLS); this is just so staff are warned and the screen does not sit there stale.
 */
export function SessionGuard({ initial }: { initial: SessionStatus }) {
  const warnMinutes = initial.warn_minutes ?? 10;
  // When we last heard from the server, and how many seconds it said were left.
  const base = useRef({ secs: initial.seconds_until_close ?? null, at: 0 });
  const leaving = useRef(false);
  const [state, setState] = useState<ClosingState>({ phase: "open" });

  const goToLogin = useCallback(async (reason: "closed" | "inactive" | "elsewhere") => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      // The server checks its own clock, records the closing-time logout and ends the session.
      if (reason === "closed") await fetch("/api/session", { cache: "no-store" });
    } catch {
      /* offline: still leave this screen */
    }
    await supabaseBrowser().auth.signOut({ scope: "local" }).catch(() => {});
    window.location.replace(`/login?reason=${reason}`);
  }, []);

  const evaluate = useCallback(() => {
    const s = closingState(base.current.secs, warnMinutes, performance.now() - base.current.at);
    setState(s);
    if (s.phase === "closed") goToLogin("closed");
  }, [warnMinutes, goToLogin]);

  const recheck = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      const s = (await res.json()) as SessionStatus;
      if (!s.signed_in) return window.location.replace("/login");
      if (!s.allowed) return goToLogin(s.replaced ? "elsewhere" : s.active === false ? "inactive" : "closed");
      base.current = { secs: s.seconds_until_close ?? null, at: performance.now() };
      evaluate();
    } catch {
      /* offline: keep counting with what we have */
    }
  }, [goToLogin, evaluate]);

  useEffect(() => {
    base.current.at = performance.now();
    const tick = setInterval(evaluate, 1000);
    const poll = setInterval(recheck, RECHECK_MS);
    // Re-check with the server when the app is reopened from the background or comes back online.
    const onVisible = () => document.visibilityState === "visible" && recheck();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", recheck);
    window.addEventListener("pageshow", recheck);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", recheck);
      window.removeEventListener("pageshow", recheck);
    };
  }, [evaluate, recheck]);

  if (state.phase === "warning") {
    return (
      <div
        role="timer"
        aria-live="polite"
        data-testid="closing-warning"
        className="sticky top-0 z-40 bg-amber-400 px-4 py-2 text-center text-base font-bold text-black print:hidden"
      >
        Closing in {formatCountdown(state.secondsLeft)} – finish your sale. IfeCollection closes at{" "}
        {formatClock(initial.close_time ?? "20:00")}.{" "}
        {initial.opening_done && !initial.closing_done && (
          <Link href="/count" className="underline">
            Do closing count
          </Link>
        )}
      </div>
    );
  }
  if (state.phase === "closed") {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-800 p-6 text-center text-xl font-bold text-white">
        IfeCollection is closed. Logging out…
      </div>
    );
  }
  return null;
}
