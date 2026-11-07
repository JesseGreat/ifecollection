import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, login, openShop, sql, STAFF } from "./helpers";

const stockOf = async (product: string, colour: string, size: string) =>
  (
    await sql<{ quantity: number }>(
      `select v.quantity from public.product_variants v join public.products p on p.id = v.product_id
        where p.name = $1 and v.colour = $2 and v.size = $3`,
      [product, colour, size],
    )
  )[0].quantity;

async function addToCart(page: Page, product: string, choose: string[] = [], extra = 0) {
  await page.getByPlaceholder("Search name, colour or code").fill(product.split(" ")[0]);
  await page.getByRole("button", { name: new RegExp(`^${product},`) }).click();
  const sheet = page.getByRole("dialog", { name: product });
  for (const c of choose) await sheet.getByRole("button", { name: c, exact: true }).click();
  for (let i = 0; i < extra; i++) await sheet.getByRole("button", { name: "Increase quantity" }).click();
  await sheet.getByRole("button", { name: /Add to cart/ }).click();
}

test.beforeEach(async () => openShop());

test("staff makes a sale and gets an IfeCollection receipt", async ({ page }) => {
  await login(page, STAFF);
  await page.waitForURL("**/sell");
  await expectNoHorizontalScroll(page);
  const before = await stockOf("Adire shirt", "Blue", "L");

  await addToCart(page, "Adire shirt", ["L"], 1);
  const bar = page.getByTestId("cart-bar");
  await expect(bar).toContainText("2 items");
  await expect(bar).toContainText("₦19,000");

  await bar.click();
  await page.waitForURL("**/sell/checkout");
  await expect(page.getByTestId("cart-total")).toHaveText("₦19,000");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: /Complete sale · Cash · ₦19,000/ }).click();

  await page.waitForURL(/\/receipt\/[0-9a-f-]{36}\?new=1/);
  await expect(page.getByText("✓ Sale saved")).toBeVisible();
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText("IfeCollection");
  await expect(receipt).toContainText(`Served by: ${STAFF.name}`);
  await expect(page.getByTestId("receipt-total")).toHaveText("₦19,000");
  await expect(page.getByTestId("receipt-no")).toHaveText(/^IFE-\d{6}-\d{4}$/);
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /wa\.me/);
  await expectNoHorizontalScroll(page);

  expect(await stockOf("Adire shirt", "Blue", "L")).toBe(before - 2);

  const receiptNo = await page.getByTestId("receipt-no").innerText();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My sales" }).click();
  await expect(page.getByText(receiptNo)).toBeVisible();
});

test("no internet: sale not saved, cart kept; a lost response is never saved twice", async ({ page, context }) => {
  await login(page, STAFF);
  await page.waitForURL("**/sell");
  const before = await stockOf("Palazzo trousers", "Black", "M");
  await addToCart(page, "Palazzo trousers", ["Black", "M"]);
  await page.getByTestId("cart-bar").click();
  await page.getByRole("button", { name: "POS", exact: true }).click();

  // 1. Phone is offline.
  await context.setOffline(true);
  await page.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page.getByTestId("sale-error")).toContainText("No internet – sale not saved");
  await expect(page.getByTestId("cart-total")).toHaveText("₦8,000"); // cart kept
  await context.setOffline(false);

  // 2. Back online, but the server's answer gets lost on the way back (sale IS saved on the server).
  let first = true;
  await page.route("**/rest/v1/rpc/create_sale", async (route) => {
    if (first) {
      first = false;
      await route.fetch(); // reaches the server
      return route.abort("connectionreset"); // phone never sees the answer
    }
    return route.continue();
  });
  await page.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page.getByTestId("sale-error")).toContainText("No internet");

  // 3. Staff taps again: the same idempotency key returns the SAME sale, nothing is sold twice.
  await page.getByRole("button", { name: /Complete sale/ }).click();
  await page.waitForURL(/\/receipt\//);
  await expect(page.getByTestId("receipt-total")).toHaveText("₦8,000");
  expect(await stockOf("Palazzo trousers", "Black", "M")).toBe(before - 1);
  const id = page.url().match(/receipt\/([0-9a-f-]{36})/)![1];
  const dupes = await sql<{ n: number }>(
    `select count(*)::int n from public.sales where idempotency_key = (select idempotency_key from public.sales where id = $1)`,
    [id],
  );
  expect(dupes[0].n).toBe(1);
});

test("staff cannot oversell or open admin pages", async ({ page }) => {
  await login(page, STAFF);
  await page.waitForURL("**/sell");
  const left = await stockOf("Ankara head wrap", "Multi", "");
  await page.getByPlaceholder("Search name, colour or code").fill("head wrap");
  await page.getByRole("button", { name: /^Ankara head wrap,/ }).click();
  const sheet = page.getByRole("dialog", { name: "Ankara head wrap" });
  const plus = sheet.getByRole("button", { name: "Increase quantity" });
  for (let i = 1; i < left; i++) await plus.click();
  await expect(plus).toBeDisabled(); // cannot pick more than in stock
  await sheet.getByRole("button", { name: /Add to cart/ }).click();
  await page.getByTestId("cart-bar").click();
  await expect(page.getByRole("button", { name: /Increase quantity of Ankara head wrap/ })).toBeDisabled();

  await page.goto("/admin");
  await page.waitForURL("**/sell");
  await page.goto("/admin/products/new");
  await page.waitForURL("**/sell");
});
