"use server";
// Account management needs the service-role key (Supabase Auth admin API).
// Every action first re-checks with Postgres that the caller is an active admin.
import { revalidatePath } from "next/cache";
import { isValidUsername, usernameToEmail } from "@/lib/supabase/env";
import { createAdminClient, requireAdmin } from "@/lib/supabase/server";

export type ActionResult = { ok?: string; error?: string };

async function audit(actorId: string, action: string, entityId: string, details: Record<string, unknown> = {}) {
  await createAdminClient().from("audit_log").insert({ actor_id: actorId, action, entity: "profile", entity_id: entityId, details });
}

export async function createStaff(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).status.user_id!;
  } catch {
    return { error: "Only the admin can do this." };
  }
  const fullName = String(form.get("full_name") ?? "").trim();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const role = form.get("role") === "admin" ? "admin" : "staff";
  if (!fullName) return { error: "Enter the person's name." };
  if (!isValidUsername(username)) return { error: "Username: 3–30 letters/numbers, no spaces (e.g. amaka)." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const { data, error } = await createAdminClient().auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    app_metadata: { username, full_name: fullName, role },
  });
  if (error) return { error: /already|exists|registered/i.test(error.message) ? "That username is taken." : error.message };
  await audit(adminId, "staff_create", data.user.id, { username, full_name: fullName, role });
  revalidatePath("/admin/staff");
  return { ok: `${fullName} can now log in as “${username}”.` };
}

export async function resetPassword(userId: string, password: string): Promise<ActionResult> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).status.user_id!;
  } catch {
    return { error: "Only the admin can do this." };
  }
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };
  await audit(adminId, "password_reset", userId);
  return { ok: "Password changed." };
}

export async function setActive(userId: string, active: boolean): Promise<ActionResult> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).status.user_id!;
  } catch {
    return { error: "Only the admin can do this." };
  }
  if (userId === adminId) return { error: "You cannot turn off your own account." };
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ active }).eq("id", userId);
  if (error) return { error: error.message };
  // Also block the login itself (ban), so a deactivated person cannot even get a token.
  await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  await audit(adminId, active ? "staff_reactivate" : "staff_deactivate", userId);
  revalidatePath("/admin/staff");
  return { ok: active ? "Account turned on." : "Account turned off. They are logged out on their next tap." };
}
