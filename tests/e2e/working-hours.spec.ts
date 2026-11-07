import { expect, test, type BrowserContext } from "@playwright/test";
import { formatClock } from "../../src/lib/format";
import { ADMIN, login, openShop, sql, STAFF } from "./helpers";

const API = "http://127.0.0.1:54321";

/** The logged-in user's access token, read from the Supabase auth cookie. */
async function accessToken(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies())
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const raw = parts.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64").toString() : decodeURIComponent(raw);
  return JSON.parse(json).access_token;
}

async function lagosNow() {
  return (await sql<{ t: string }>("select to_char(now() at time zone 'Africa/Lagos', 'HH24:MI') t"))[0].t;
}

test.afterAll(async () => openShop());

test("staff are warned before closing and logged out at closing time (server clock)", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  // Opening time 8:00am when possible so the message reads exactly like the real one.
  const openTime = (await lagosNow()) >= "08:01" ? "08:00" : "00:00";
  await openShop(70, openTime); // closes in 70 seconds by the DATABASE clock

  await login(page, STAFF);
  await page.waitForURL("**/sell");
  const warning = page.getByTestId("closing-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(/Closing in [01]:\d\d/);
  const token = await accessToken(context);

  // At closing time the app logs out by itself and shows the closed message.
  await page.waitForURL(/\/login\?reason=closed/, { timeout: 120_000 });
  const closedMsg = `IfeCollection is closed. You can log in from ${formatClock(openTime)}.`;
  await expect(page.getByText(closedMsg)).toBeVisible();

  // Logging in again is refused until opening time.
  await login(page, STAFF);
  await expect(page.getByText(closedMsg)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // Even a direct API call with the old (still unexpired) token is refused by Postgres.
  const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` };
  const products = await request.get(`${API}/rest/v1/products?select=id`, { headers });
  expect(await products.json()).toEqual([]);
  const variant = (await sql<{ id: string }>("select id from public.product_variants where quantity > 0 limit 1"))[0].id;
  const sale = await request.post(`${API}/rest/v1/rpc/create_sale`, {
    headers,
    data: {
      p_items: [{ variant_id: variant, qty: 1 }],
      p_payments: [{ method: "cash", amount: null }],
      p_idempotency_key: crypto.randomUUID(),
    },
  });
  expect(sale.status()).toBeGreaterThanOrEqual(400);
  expect(await sale.text()).toContain("STORE_CLOSED");

  // The admin is not time-restricted.
  await login(page, ADMIN);
  await page.waitForURL("**/admin");

  const audit = await sql<{ action: string }>(
    `select a.action from public.audit_log a join public.profiles p on p.id = a.actor_id
      where p.username = $1 and a.created_at > now() - interval '5 minutes' order by a.id`,
    [STAFF.username],
  );
  expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["login", "auto_logout", "login_blocked_hours"]));
});

test("before opening time staff cannot log in", async ({ page }) => {
  await sql(`update public.settings set
      staff_open_time = ((now() at time zone 'Africa/Lagos') + interval '1 hour')::time,
      staff_close_time = ((now() at time zone 'Africa/Lagos') + interval '2 hours')::time`);
  const open = (await sql<{ t: string }>("select to_char(staff_open_time, 'HH24:MI') t from public.settings"))[0].t;
  await login(page, STAFF);
  await expect(page.getByText(`IfeCollection is closed. You can log in from ${formatClock(open)}.`)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("reopening the app after closing time logs staff out", async ({ page }) => {
  await openShop(3600);
  await login(page, STAFF);
  await page.waitForURL("**/sell");
  // While the phone was in a pocket, closing time passed (on the server).
  await sql(`update public.settings set
      staff_open_time = ((now() at time zone 'Africa/Lagos') + interval '1 hour')::time,
      staff_close_time = ((now() at time zone 'Africa/Lagos') + interval '2 hours')::time`);
  // Staff opens the app again.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForURL(/\/login\?reason=closed/);
  // And any navigation is refused by the proxy too.
  await page.goto("/sell");
  await expect(page).toHaveURL(/\/login/);
});
