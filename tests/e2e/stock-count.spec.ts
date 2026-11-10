import { expect, test } from "@playwright/test";
import { ADMIN, login, newPhone, openShop, sql } from "./helpers";

const TUNDE = { username: "tunde", password: process.env.SEED_STAFF_PASSWORD ?? "IfeStaff2026!" };
const stockOf = async () =>
  (
    await sql<{ quantity: number }>(
      `select v.quantity from public.product_variants v join public.products p on p.id = v.product_id
        where p.name = 'Adire shirt' and v.colour = 'Blue' and v.size = 'L'`,
    )
  )[0].quantity;

test.beforeEach(async () => {
  await openShop();
  // Known starting stock for the item we "find missing" (earlier tests may have sold them all).
  await sql(
    `update public.product_variants v set quantity = 3 from public.products p
      where p.id = v.product_id and p.name = 'Adire shirt' and v.colour = 'Blue' and v.size = 'L'`,
  );
  // Start tunde's day fresh (the test may run more than once on the same day).
  await sql(
    `delete from public.stock_counts where business_day = (now() at time zone 'Africa/Lagos')::date
       and staff_id = (select id from public.profiles where username = 'tunde')`,
  );
});

test("morning count before selling, 'count tomorrow' at closing, admin reviews the difference", async ({ browser }) => {
  test.setTimeout(120_000);
  const phone = await newPhone(browser);
  const systemL = await stockOf();

  // Logging in sends the sales person to the morning count: no selling yet.
  await login(phone, TUNDE);
  await phone.waitForURL("**/count/opening");
  await phone.goto("/sell");
  await phone.waitForURL("**/count/opening");

  const progress = phone.getByTestId("count-progress");
  await expect(progress).toHaveText(/^0 \/ \d+$/);
  const total = Number((await progress.innerText()).split("/")[1]);
  await expect(phone.getByRole("button", { name: /items? left to count/ })).toBeDisabled();

  // One shirt is missing from the shelf.
  await phone.getByRole("button", { name: "Different number for Adire shirt Blue / L" }).click();
  await phone.getByRole("button", { name: "Decrease counted Adire shirt Blue / L" }).click();
  await phone.getByRole("button", { name: "Done" }).click();
  // Everything else matches: tick each item (one by one – there is no "tick all").
  const correct = phone.getByRole("button", { name: /^Correct: / });
  while ((await correct.count()) > 0) await correct.first().click();
  await expect(progress).toHaveText(`${total} / ${total}`);

  await phone.getByRole("button", { name: "Submit count" }).click();
  await expect(phone.getByText("1 do not match the system")).toBeVisible();
  await phone.getByRole("dialog", { name: "Submit count?" }).getByRole("button", { name: "Submit" }).click();
  await expect(phone.getByTestId("count-done")).toContainText("1 item did not match");
  expect(await stockOf()).toBe(systemL); // counting never changes stock by itself

  // Now selling is open.
  await phone.getByRole("link", { name: "Start selling" }).click();
  await phone.waitForURL("**/sell");
  await expect(phone.getByPlaceholder("Search name, colour or code")).toBeVisible();

  // Evening: too late to count -> "count tomorrow" closes the day.
  await phone.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Count" }).click();
  await phone.getByRole("button", { name: "It's late – count tomorrow" }).click();
  await phone.getByRole("button", { name: "Yes, close my day" }).click();
  await expect(phone.getByText("Count tomorrow")).toBeVisible();
  await phone.goto("/sell");
  await expect(phone.getByText("You have closed for today")).toBeVisible();

  // Admin sees it per sales person, and corrects the stock.
  const admin = await newPhone(browser);
  await login(admin, ADMIN);
  await admin.waitForURL("**/admin");
  await expect(admin.getByTestId("counts-banner")).toContainText(/difference/);
  await admin.goto("/admin/counts");
  const row = admin.getByTestId("count-report-row").filter({ hasText: "Tunde Bakare" });
  await expect(row).toContainText("1 missing");
  await expect(row).toContainText("Skipped – count tomorrow");
  await row.click();
  const diff = admin.getByTestId("count-difference").filter({ hasText: "Adire shirt" });
  await expect(diff).toContainText("1 missing");
  await diff.getByRole("button", { name: "Accept & correct stock" }).click();
  await expect(diff).toContainText("Accepted – stock corrected");
  expect(await stockOf()).toBe(systemL - 1);
});
