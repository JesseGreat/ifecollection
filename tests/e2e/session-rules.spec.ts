import { expect, test } from "@playwright/test";
import { ADMIN, login, newPhone, openShop, sql, STAFF } from "./helpers";

test.beforeEach(async () => openShop());

const ELSEWHERE = "You were logged out because your account was used to log in on another device.";

test("one device per account: logging in on a second phone logs the first one out", async ({ browser }) => {
  const a = await newPhone(browser);
  const b = await newPhone(browser);

  await login(a, STAFF);
  await a.waitForURL("**/sell");
  await login(b, STAFF);
  await b.waitForURL("**/sell");

  // Phone A is cut off: when it is reopened...
  await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await a.waitForURL(/\/login\?reason=elsewhere/);
  await expect(a.getByText(ELSEWHERE)).toBeVisible();
  // ...and on any navigation.
  await a.goto("/my-sales");
  await expect(a).toHaveURL(/\/login/);

  // Phone B keeps working.
  await b.goto("/my-sales");
  await expect(b.getByRole("heading", { name: "My sales today" })).toBeVisible();

  const audit = await sql<{ n: number }>(
    `select count(*)::int n from public.audit_log a join public.profiles p on p.id = a.actor_id
      where p.username = $1 and a.action = 'session_replaced' and a.created_at > now() - interval '2 minutes'`,
    [STAFF.username],
  );
  expect(audit[0].n).toBeGreaterThanOrEqual(1);
});

test("the admin is limited to one device too (PC login logs the phone out)", async ({ browser }) => {
  const phone = await newPhone(browser);
  const pc = await newPhone(browser, { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  await login(phone, ADMIN);
  await phone.waitForURL("**/admin");
  await login(pc, ADMIN);
  await pc.waitForURL("**/admin");
  await phone.goto("/admin/products");
  await expect(phone).toHaveURL(/\/login\?reason=elsewhere/);
  await pc.goto("/admin/products");
  await expect(pc.getByRole("heading", { name: "Products" })).toBeVisible();
});

test("log out asks 'Are you sure?' first", async ({ page }) => {
  await login(page, STAFF);
  await page.waitForURL("**/sell");
  const nav = page.getByRole("navigation", { name: "Main" });

  await nav.getByRole("button", { name: "Log out" }).click();
  const dialog = page.getByRole("dialog", { name: "Log out?" });
  await expect(dialog.getByText("Are you sure you want to log out of IfeCollection?")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/sell/); // still logged in

  await nav.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("dialog", { name: "Log out?" }).getByRole("button", { name: "Yes, log out" }).click();
  await page.waitForURL(/\/login$/);
  await page.goto("/sell");
  await expect(page).toHaveURL(/\/login/);
});

test("staff must share their location to log in; it is recorded with the login", async ({ browser }) => {
  // Location refused -> no login, clear message, attempt recorded.
  const refused = await newPhone(browser, { allowLocation: false });
  await login(refused, STAFF);
  await expect(refused.getByText(/IfeCollection needs your location to log in/)).toBeVisible();
  await expect(refused).toHaveURL(/\/login/);
  const blocked = await sql<{ details: Record<string, unknown> }>(
    `select a.details from public.audit_log a join public.profiles p on p.id = a.actor_id
      where p.username = $1 and a.action = 'login_blocked_location' order by a.id desc limit 1`,
    [STAFF.username],
  );
  expect(blocked[0].details).toMatchObject({ location_error: "denied" });

  // Location allowed -> logged in, GPS + device in the audit log.
  const allowed = await newPhone(browser);
  await login(allowed, STAFF);
  await allowed.waitForURL("**/sell");
  const ok = await sql<{ details: Record<string, unknown> }>(
    `select a.details from public.audit_log a join public.profiles p on p.id = a.actor_id
      where p.username = $1 and a.action = 'login' order by a.id desc limit 1`,
    [STAFF.username],
  );
  expect(ok[0].details).toMatchObject({ lat: 6.6018, lng: 3.3515, accuracy: 15 });
  expect(String(ok[0].details.device)).toMatch(/Android/);
});

test("the admin is asked for location but can still log in without it (e.g. on a PC)", async ({ browser }) => {
  const pc = await newPhone(browser, { allowLocation: false, viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  await login(pc, ADMIN);
  await pc.waitForURL("**/admin");
  await pc.goto("/admin/activity?type=logins");
  await expect(pc.getByText("No GPS: location refused").first()).toBeVisible();
});
