import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

export const ADMIN = { username: "ife", password: process.env.SEED_ADMIN_PASSWORD ?? "IfeAdmin2026!" };
export const STAFF = { username: "amaka", password: process.env.SEED_STAFF_PASSWORD ?? "IfeStaff2026!", name: "Amaka Obi" };

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Shop open right now (on the database clock), closing in `closeInSeconds`. */
export async function openShop(closeInSeconds = 3 * 3600, openTime?: string) {
  await sql(
    `update public.settings set
       staff_open_time = coalesce($2::time, ((now() at time zone 'Africa/Lagos') - interval '1 hour')::time),
       staff_close_time = ((now() at time zone 'Africa/Lagos') + make_interval(secs => $1))::time`,
    [closeInSeconds, openTime ?? null],
  );
}

export async function login(page: Page, who: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/**
 * No sideways scrolling on a phone. Compare with the real screen width: on mobile Chrome the layout
 * viewport (innerWidth) silently grows to fit content that is too wide, which would hide the bug.
 */
export async function expectNoHorizontalScroll(page: Page) {
  const screen = page.viewportSize()!.width;
  const { widest, culprit } = await page.evaluate(() => {
    let max = document.documentElement.scrollWidth;
    let culprit = "document";
    // Also catch single elements poking out (ignoring ones inside deliberate horizontal scrollers).
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest(".overflow-x-auto")) continue;
      if (r.right + window.scrollX >= max && r.right + window.scrollX > window.innerWidth - 1 && r.right > 0 && r.width < max) {
        max = r.right + window.scrollX;
        culprit = `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">${(el.textContent ?? "").slice(0, 40)}`;
      }
    }
    return { widest: Math.ceil(max), culprit };
  });
  expect(widest, `${page.url()} must fit ${screen}px; widest: ${culprit}`).toBeLessThanOrEqual(screen);
}
