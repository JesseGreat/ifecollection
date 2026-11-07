import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { cloudinarySignature } from "../../src/lib/cloudinary";
import { E2E_CLOUDINARY } from "./cloudinary-env";
import { ADMIN, expectNoHorizontalScroll, login, openShop, sql, STAFF } from "./helpers";

/** A big, noisy "camera" photo (noise does not compress, like a real photo). */
async function cameraPhoto(w: number, h: number) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + ((i / 3) | 0) * 104729) % 251;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

/** Minimal multipart/form-data reader for the intercepted Cloudinary upload. */
function readForm(body: Buffer, contentType: string) {
  const boundary = contentType.match(/boundary=(.+)$/)![1];
  const fields: Record<string, string> = {};
  let file: Buffer | null = null;
  for (const part of body.toString("latin1").split(`--${boundary}`)) {
    const m = part.match(/^\r\nContent-Disposition: form-data; name="([^"]+)"(; filename="[^"]*")?\r\n(?:Content-Type: [^\r]+\r\n)?\r\n([\s\S]*)\r\n$/i);
    if (!m) continue;
    if (m[1] === "file") file = Buffer.from(m[3], "latin1");
    else fields[m[1]] = m[3];
  }
  return { fields, file };
}

test("admin adds a product with photos from the phone (Cloudinary)", async ({ page }) => {
  const cloud = E2E_CLOUDINARY.CLOUDINARY_CLOUD_NAME;
  // Stand-in for Cloudinary: checks the signature exactly as Cloudinary would.
  const uploaded: Buffer[] = [];
  let attempts = 0;
  await page.route(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, async (route) => {
    if (attempts++ === 0) return route.abort("internetdisconnected"); // bad network on the first try
    const req = route.request();
    const { fields, file } = readForm(req.postDataBuffer()!, req.headers()["content-type"]);
    const { signature, api_key, ...signed } = fields;
    const valid =
      api_key === E2E_CLOUDINARY.CLOUDINARY_API_KEY &&
      signature === cloudinarySignature(signed, E2E_CLOUDINARY.CLOUDINARY_API_SECRET) &&
      signed.folder === "ifecollection/products" &&
      Math.abs(Date.now() / 1000 - Number(signed.timestamp)) < 3600;
    if (!valid || !file) return route.fulfill({ status: 401, json: { error: { message: "Invalid Signature" } } });
    uploaded.push(file);
    const publicId = `${signed.folder}/${signed.public_id}`;
    return route.fulfill({
      json: { public_id: publicId, secure_url: `https://res.cloudinary.com/${cloud}/image/upload/v1/${publicId}.webp` },
    });
  });
  await page.route("https://res.cloudinary.com/**", (route) => route.fulfill({ body: uploaded[0], contentType: "image/webp" }));

  await login(page, ADMIN);
  await page.waitForURL("**/admin");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Products" }).click();
  await page.getByRole("link", { name: "New product" }).click();
  await page.waitForURL("**/admin/products/new");
  await expectNoHorizontalScroll(page);

  const [p1, p2] = await Promise.all([cameraPhoto(4000, 3000), cameraPhoto(3000, 4000)]);
  expect(p1.length).toBeGreaterThan(1_000_000); // a real-size phone photo
  await page.getByTestId("photo-gallery").setInputFiles([
    { name: "gown-front.jpg", mimeType: "image/jpeg", buffer: p1 },
    { name: "gown-back.jpg", mimeType: "image/jpeg", buffer: p2 },
  ]);
  await expect(page.getByTestId("photo-item")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator('[data-testid="photo-item"][data-status="done"]')).toHaveCount(2, { timeout: 30_000 });

  // Photos were shrunk ON THE PHONE before upload: max 1200px, ~200KB.
  expect(uploaded).toHaveLength(2);
  for (const file of uploaded) {
    const m = await sharp(file).metadata();
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(1200);
    expect(file.length).toBeLessThanOrEqual(240 * 1024);
  }

  const name = `E2E Ankara gown ${Date.now()}`;
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Price (₦)").fill("15000");
  await expect(page.getByText("₦15,000")).toBeVisible();
  await page.getByRole("combobox", { name: /^Category/ }).selectOption({ label: "Gowns" });
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: "L", exact: true }).click();
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await page.getByLabel("Quantity Red / M").fill("3");
  await page.getByLabel("Quantity Red / L").fill("2");
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\?saved=1/);
  await expect(page.getByText("Product saved.")).toBeVisible();
  await expect(page.getByTestId("stock-Red-M")).toHaveText("3");
  await expect(page.getByTestId("stock-Red-L")).toHaveText("2");

  const imgs = await sql<{ provider: string; path: string; external_id: string; thumb_path: string | null }>(
    `select i.provider, i.path, i.external_id, i.thumb_path from public.product_images i
       join public.products p on p.id = i.product_id where p.name = $1 order by i.sort_order`,
    [name],
  );
  expect(imgs).toHaveLength(2);
  for (const img of imgs) {
    expect(img.provider).toBe("cloudinary");
    expect(img.path).toMatch(new RegExp(`^https://res\\.cloudinary\\.com/${cloud}/image/upload/`));
    expect(img.external_id).toMatch(/^ifecollection\/products\//);
    expect(img.thumb_path).toBeNull();
  }
  // Screens ask Cloudinary for small, auto-format thumbnails (only one upload per photo).
  // (Checked on the <img> URLs: the app's service worker fetches/caches them, out of Playwright's page routing.)
  await expect(page.locator('img[src*="res.cloudinary.com"][src*="/c_fill,g_auto,w_320,h_320,f_auto,q_auto/"]')).toHaveCount(2);

  // Every stock change is logged: the opening stock is in stock_movements.
  const mv = await sql<{ n: number }>(
    `select count(*)::int n from public.stock_movements m join public.product_variants v on v.id = m.variant_id
       join public.products p on p.id = v.product_id where p.name = $1 and m.reason = 'initial'`,
    [name],
  );
  expect(mv[0].n).toBe(2);
});

test("staff cannot get a photo upload signature", async ({ page }) => {
  await openShop();
  await login(page, STAFF);
  await page.waitForURL("**/sell");
  const res = await page.request.post("/api/images/sign");
  expect(res.status()).toBe(403);
});
