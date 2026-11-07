import { expect, test } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, openShop, STAFF } from "./helpers";

// Every main screen at 360px, 390px (phones) and 1280px (PC): no sideways scrolling, nav present.
const SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const STAFF_PAGES = ["/sell", "/sell/checkout", "/my-sales"];
const ADMIN_PAGES = ["/admin", "/admin/products", "/admin/products/new", "/admin/sales", "/admin/staff", "/admin/settings", "/admin/activity", "/admin/more", "/admin/report"];

test.beforeAll(async () => openShop());

for (const size of SIZES) {
  test(`all screens fit at ${size.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await page.goto("/login");
    await expectNoHorizontalScroll(page);

    await login(page, STAFF);
    await page.waitForURL("**/sell");
    for (const path of STAFF_PAGES) {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `test-results/layout/${size.width}-staff${path.replaceAll("/", "_")}.png` });
    }
    await page.context().clearCookies();

    await login(page, ADMIN);
    await page.waitForURL("**/admin");
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `test-results/layout/${size.width}-admin${path.replaceAll("/", "_")}.png` });
    }
  });
}
