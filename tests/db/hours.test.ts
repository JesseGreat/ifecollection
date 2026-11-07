import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  as, closeShopNow, createProduct, createUser, defaultHours, openShopNow, pool, rpc, sale,
} from "./helpers";

let admin: string, staff: string, variantId: string;

beforeAll(async () => {
  await openShopNow();
  admin = await createUser("admin", "Ife Admin");
  staff = await createUser("staff", "Amaka");
  variantId = (await createProduct(admin, { variants: [{ size: "M", colour: "Red", quantity: 20 }] })).variants[0].id;
});
afterEach(openShopNow);
afterAll(async () => {
  await defaultHours();
  await pool.end();
});

const openAt = async (ts: string) =>
  (await pool.query("select public.staff_hours_open_at($1::timestamptz) as ok", [ts])).rows[0].ok as boolean;

describe("working-hours rule (08:00–20:00 Africa/Lagos)", () => {
  beforeEach(defaultHours);

  it("is closed before 8am Lagos time", async () => {
    expect(await openAt("2026-11-07T07:59:59+01:00")).toBe(false);
    expect(await openAt("2026-11-07T06:59:59Z")).toBe(false); // = 07:59:59 in Lagos
    expect(await openAt("2026-11-07T03:00:00+01:00")).toBe(false);
  });

  it("is open during hours, including exactly 8:00", async () => {
    expect(await openAt("2026-11-07T08:00:00+01:00")).toBe(true);
    expect(await openAt("2026-11-07T07:00:00Z")).toBe(true); // = 08:00 in Lagos
    expect(await openAt("2026-11-07T13:30:00+01:00")).toBe(true);
    expect(await openAt("2026-11-07T19:59:59+01:00")).toBe(true);
  });

  it("is closed from 8pm, including exactly 20:00", async () => {
    expect(await openAt("2026-11-07T20:00:00+01:00")).toBe(false);
    expect(await openAt("2026-11-07T19:00:00Z")).toBe(false); // = 20:00 in Lagos
    expect(await openAt("2026-11-07T23:59:00+01:00")).toBe(false);
  });

  it("uses Lagos time even if the database session time zone is changed by a client", async () => {
    const c = await pool.connect();
    try {
      await c.query("set timezone = 'America/New_York'");
      const { rows } = await c.query("select public.staff_hours_open_at('2026-11-07T19:30:00Z') as ok");
      expect(rows[0].ok).toBe(false); // 20:30 in Lagos, 14:30 in New York
    } finally {
      await c.query("reset timezone");
      c.release();
    }
  });

  it("hours come from the settings table, so the admin can change them", async () => {
    await pool.query("update public.settings set staff_open_time = '09:00', staff_close_time = '18:00'");
    expect(await openAt("2026-11-07T08:30:00+01:00")).toBe(false);
    expect(await openAt("2026-11-07T17:59:00+01:00")).toBe(true);
    expect(await openAt("2026-11-07T18:00:00+01:00")).toBe(false);
    await pool.query("update public.settings set staff_open_time = '22:00', staff_close_time = '06:00'");
    expect(await openAt("2026-11-07T23:00:00+01:00")).toBe(true); // overnight shift works
    expect(await openAt("2026-11-07T12:00:00+01:00")).toBe(false);
    await defaultHours();
  });
});

describe("enforced on the real database clock (RLS + RPC)", () => {
  it("during hours: staff can read products and record a sale", async () => {
    await openShopNow();
    const status = await rpc(staff, "select public.session_status() as s").then((r) => r.s);
    expect(status).toMatchObject({ role: "staff", allowed: true, within_hours: true });
    expect(status.seconds_until_close).toBeGreaterThan(3500);
    expect(status.seconds_until_close).toBeLessThanOrEqual(3600);
    const products = await as(staff, (c) => c.query("select id from public.products"));
    expect(products.rowCount).toBeGreaterThan(0);
    await expect(sale(staff, [{ variant_id: variantId, qty: 1 }])).resolves.toMatchObject({ total: 10000 });
  });

  it("outside hours: staff get nothing from tables and every RPC refuses (direct API calls fail)", async () => {
    await closeShopNow();
    const status = await rpc(staff, "select public.session_status() as s").then((r) => r.s);
    expect(status).toMatchObject({ allowed: false, within_hours: false, seconds_until_close: null });
    for (const t of ["products", "product_variants", "categories", "sales", "settings", "profiles"]) {
      const r = await as(staff, (c) => c.query(`select 1 from public.${t}`));
      expect(r.rowCount, t).toBe(0);
    }
    await expect(sale(staff, [{ variant_id: variantId, qty: 1 }])).rejects.toThrow(/STORE_CLOSED/);
  });

  it("a session that crosses closing time is cut off on the very next request", async () => {
    await openShopNow();
    // Same logged-in staff session (same JWT) works before closing …
    await expect(sale(staff, [{ variant_id: variantId, qty: 1 }])).resolves.toBeTruthy();
    const mine = await as(staff, (c) => c.query("select id from public.sales"));
    expect(mine.rowCount).toBeGreaterThan(0);
    // … the clock passes closing time …
    await closeShopNow();
    // … and the same session is now refused everywhere, without logging in again.
    await expect(sale(staff, [{ variant_id: variantId, qty: 1 }])).rejects.toThrow(/STORE_CLOSED/);
    expect((await as(staff, (c) => c.query("select id from public.sales"))).rowCount).toBe(0);
    expect((await rpc(staff, "select public.session_status() as s")).s.allowed).toBe(false);
  });

  it("session_status counts down to closing so the phone can warn at 19:50", async () => {
    await pool.query(`update public.settings set
      staff_open_time = ((now() at time zone 'Africa/Lagos') - interval '1 hour')::time,
      staff_close_time = ((now() at time zone 'Africa/Lagos') + interval '5 minutes')::time`);
    const s = (await rpc(staff, "select public.session_status() as s")).s;
    expect(s.seconds_until_close).toBeGreaterThan(290);
    expect(s.seconds_until_close).toBeLessThanOrEqual(300);
    expect(s.warn_minutes).toBe(10);
  });

  it("the admin is never time-restricted", async () => {
    await closeShopNow();
    expect((await rpc(admin, "select public.session_status() as s")).s).toMatchObject({ allowed: true, role: "admin" });
    expect((await as(admin, (c) => c.query("select 1 from public.products"))).rowCount).toBeGreaterThan(0);
    await expect(sale(admin, [{ variant_id: variantId, qty: 1 }])).resolves.toBeTruthy();
  });

  it("deactivated staff are refused even during hours", async () => {
    await openShopNow();
    const s2 = await createUser("staff");
    await pool.query("update public.profiles set active = false where id = $1", [s2]);
    expect((await rpc(s2, "select public.session_status() as s")).s.allowed).toBe(false);
    await expect(sale(s2, [{ variant_id: variantId, qty: 1 }])).rejects.toThrow(/ACCOUNT_INACTIVE/);
  });
});
