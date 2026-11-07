// Create the FIRST admin account (there is no sign-up page).
// Usage: npm run create-admin -- --username ife --name "Ife Owner" --password "a-strong-password"
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  const username = (arg("username") ?? "").trim().toLowerCase();
  const fullName = (arg("name") ?? "").trim();
  const password = arg("password") ?? "";
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('--username: 3–30 small letters/numbers, e.g. "ife"');
  if (!fullName) throw new Error('--name is required, e.g. --name "Ife Owner"');
  if (password.length < 8) throw new Error("--password must be at least 8 characters");

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.admin.createUser({
    email: `${username}@staff.ifecollection.app`,
    password,
    email_confirm: true,
    app_metadata: { username, full_name: fullName, role: "admin" },
  });
  if (error) throw new Error(error.message);
  console.log(`✓ Admin "${fullName}" created. Log in to IfeCollection with username "${username}". (id ${data.user.id})`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
