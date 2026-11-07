"use server";
import { redirect } from "next/navigation";
import { formatClock } from "@/lib/format";
import { homeFor, type SessionStatus } from "@/lib/session";
import { usernameToEmail } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; closed?: boolean };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) {
    if (/banned/i.test(error.message)) return { error: "Your account is turned off. Please ask the admin." };
    if (/fetch|network/i.test(error.message)) return { error: "No internet. Check your connection and try again." };
    return { error: "Wrong username or password." };
  }

  // Password is right. Now ask the DATABASE clock whether this person may come in.
  const { data } = await supabase.rpc("session_status");
  const status = data as SessionStatus | null;

  if (!status?.found || !status.active) {
    await supabase.rpc("log_auth_event", { p_action: "login_blocked_inactive" });
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Your account is turned off. Please ask the admin." };
  }
  if (status.role === "staff" && !status.within_hours) {
    await supabase.rpc("log_auth_event", { p_action: "login_blocked_hours" });
    await supabase.auth.signOut({ scope: "local" });
    return {
      closed: true,
      error: `IfeCollection is closed. You can log in from ${formatClock(status.open_time ?? "08:00")}.`,
    };
  }

  await supabase.rpc("log_auth_event", { p_action: "login" });
  redirect(homeFor(status.role));
}

export async function logout(reason: "logout" | "auto_logout" = "logout") {
  const supabase = await createClient();
  await supabase.rpc("log_auth_event", { p_action: reason }).then(
    () => {},
    () => {},
  );
  await supabase.auth.signOut({ scope: "local" });
  redirect(reason === "auto_logout" ? "/login?reason=closed" : "/login");
}
