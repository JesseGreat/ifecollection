import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createProduct, createUser, openShopNow, pool, rpc, sale } from "./helpers";

let admin: string, staff: string, other: string;
let productId: string, variantId: string, mySaleId: string, otherSaleId: string;

beforeAll(async () => {
  await openShopNow();
  admin = await createUser("admin");
  staff = await createUser("staff", "Amaka");
  other = await createUser("staff", "Tunde");
  const p = await createProduct(admin, { variants: [{ size: "M", colour: "Red", quantity: 20 }] });
  productId = p.id;
  variantId = p.variants[0].id;
  mySaleId = (await sale(staff, [{ variant_id: variantId, qty: 1 }])).id;
  otherSaleId = (await sale(other, [{ variant_id: variantId, qty: 1 }])).id;
});
afterAll(() => pool.end());

const q = (uid: string | null, sql: string, params: unknown[] = []) => as(uid, (c) => c.query(sql, params));

describe("staff cannot edit or delete sales", () => {
  it("cannot UPDATE a sale (not even their own)", async () => {
    await expect(q(staff, "update public.sales set total = 1 where id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
    await expect(q(staff, "update public.sale_items set qty = 99 where sale_id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
    await expect(q(staff, "update public.sale_payments set amount = 1 where sale_id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
  });

  it("cannot DELETE a sale, its items or payments", async () => {
    await expect(q(staff, "delete from public.sales where id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
    await expect(q(staff, "delete from public.sale_items where sale_id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
    await expect(q(staff, "delete from public.sale_payments where sale_id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
  });

  it("cannot INSERT a sale directly (must use create_sale), so cannot sell as someone else", async () => {
    await expect(
      q(staff, "insert into public.sales (receipt_no, staff_id, total, idempotency_key) values ('X', $1, 1, $2)", [other, randomUUID()]),
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot void a sale", async () => {
    await expect(rpc(staff, "select public.void_sale($1, 'no reason')", [mySaleId])).rejects.toThrow(/ADMIN_ONLY/);
  });

  it("even the admin cannot hard-delete or edit sales (only void)", async () => {
    await expect(q(admin, "delete from public.sales where id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
    await expect(q(admin, "update public.sales set total = 0 where id = $1", [mySaleId])).rejects.toThrow(/permission denied/);
  });
});

describe("staff see only their own sales from today", () => {
  it("sees own sale, not another staff member's", async () => {
    const ids = (await q(staff, "select id from public.sales")).rows.map((r) => r.id);
    expect(ids).toContain(mySaleId);
    expect(ids).not.toContain(otherSaleId);
    expect((await q(staff, "select 1 from public.sale_items where sale_id = $1", [otherSaleId])).rowCount).toBe(0);
    expect((await q(staff, "select 1 from public.sale_payments where sale_id = $1", [otherSaleId])).rowCount).toBe(0);
  });

  it("does not see own sales from previous days", async () => {
    await pool.query("update public.sales set created_at = now() - interval '2 days' where id = $1", [mySaleId]);
    expect((await q(staff, "select 1 from public.sales where id = $1", [mySaleId])).rowCount).toBe(0);
    await pool.query("update public.sales set created_at = now() where id = $1", [mySaleId]);
  });

  it("admin sees everyone's sales", async () => {
    const ids = (await q(admin, "select id from public.sales")).rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([mySaleId, otherSaleId]));
  });
});

describe("staff cannot change products, prices or stock", () => {
  it("cannot change a product price or archive it", async () => {
    const r = await q(staff, "update public.products set price = 1 where id = $1", [productId]);
    expect(r.rowCount).toBe(0); // RLS hides the row from the update
    expect((await pool.query("select price from public.products where id = $1", [productId])).rows[0].price).not.toBe(1);
  });

  it("cannot write variants or stock movements directly", async () => {
    await expect(q(staff, "update public.product_variants set quantity = 999 where id = $1", [variantId])).rejects.toThrow(/permission denied/);
    await expect(q(staff, "update public.product_variants set price_override = 1 where id = $1", [variantId])).rejects.toThrow(/permission denied/);
    await expect(q(staff, "insert into public.product_variants (product_id, size, colour) values ($1, 'Z', 'Z')", [productId])).rejects.toThrow(/permission denied/);
    await expect(q(staff, "insert into public.stock_movements (variant_id, qty_change, quantity_after, reason) values ($1, 5, 5, 'restock')", [variantId])).rejects.toThrow(/permission denied/);
  });

  it("cannot call admin RPCs", async () => {
    await expect(rpc(staff, "select public.restock_variant($1, 5)", [variantId])).rejects.toThrow(/ADMIN_ONLY/);
    await expect(rpc(staff, "select public.adjust_stock($1, 50, 'because')", [variantId])).rejects.toThrow(/ADMIN_ONLY/);
    await expect(rpc(staff, "select public.save_product($1)", [{ name: "x", price: 1, variants: [{ size: "M", colour: "" }] }])).rejects.toThrow(/ADMIN_ONLY/);
    await expect(rpc(staff, "select public.dashboard_summary(current_date, current_date)")).rejects.toThrow(/ADMIN_ONLY/);
    await expect(rpc(staff, "select public.update_settings('{\"staff_close_time\":\"23:59\"}')")).rejects.toThrow(/ADMIN_ONLY/);
  });

  it("cannot call internal helper functions", async () => {
    await expect(rpc(staff, "select public.write_audit('x', 'y', 'z')")).rejects.toThrow(/permission denied/);
    await expect(rpc(staff, "select public.sale_json($1)", [otherSaleId])).rejects.toThrow(/permission denied/);
  });

  it("cannot read stock movements, audit log, or other staff profiles; cannot change own role", async () => {
    expect((await q(staff, "select 1 from public.stock_movements")).rowCount).toBe(0);
    expect((await q(staff, "select 1 from public.audit_log")).rowCount).toBe(0);
    expect((await q(staff, "select id from public.profiles")).rows).toEqual([{ id: staff }]);
    await expect(q(staff, "update public.profiles set role = 'admin' where id = $1", [staff])).rejects.toThrow(/permission denied/);
  });

  it("cannot change the working hours", async () => {
    const r = await q(staff, "update public.settings set staff_close_time = '23:59'");
    expect(r.rowCount).toBe(0); // RLS: only the admin's update matches a row
    expect((await pool.query("select staff_close_time from public.settings")).rows[0].staff_close_time).not.toBe("23:59:00");
  });
});

describe("accounts", () => {
  it("profile role/name follow app_metadata even when Supabase Auth writes it after the insert", async () => {
    const { rows } = await pool.query(
      `insert into auth.users (email, raw_app_meta_data) values ('late@staff.ifecollection.app', '{"provider":"email"}') returning id`,
    );
    const id = rows[0].id;
    expect((await pool.query("select role, username from public.profiles where id = $1", [id])).rows[0]).toEqual({
      role: "staff",
      username: "late",
    });
    await pool.query(
      `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin","username":"boss","full_name":"Boss"}' where id = $1`,
      [id],
    );
    expect((await pool.query("select role, username, full_name from public.profiles where id = $1", [id])).rows[0]).toEqual({
      role: "admin",
      username: "boss",
      full_name: "Boss",
    });
  });
});

describe("product photos", () => {
  const cdn = "https://res.cloudinary.com/ife/image/upload/v1/ifecollection/products/a.webp";
  it("only the admin can add photo rows; Cloudinary rows must point at Cloudinary", async () => {
    const row = [productId, cdn, "ifecollection/products/a"];
    const ins = "insert into public.product_images (product_id, provider, path, external_id) values ($1, 'cloudinary', $2, $3)";
    await expect(q(staff, ins, row)).rejects.toThrow(/row-level security/);
    await expect(q(admin, ins, row)).resolves.toBeTruthy();
    await expect(q(admin, ins, [productId, "https://evil.example/x.jpg", "x"])).rejects.toThrow(/product_images_provider_fields/);
    await expect(
      q(admin, "insert into public.product_images (product_id, provider, path) values ($1, 'supabase', 'p/a.webp')", [productId]),
    ).rejects.toThrow(/product_images_provider_fields/);
  });
});

describe("anonymous (not logged in)", () => {
  it("cannot read anything or record a sale", async () => {
    await expect(q(null, "select 1 from public.products")).rejects.toThrow(/permission denied/);
    await expect(q(null, "select 1 from public.sales")).rejects.toThrow(/permission denied/);
    await expect(
      q(null, "select public.create_sale('[]', '[]', $1)", [randomUUID()]),
    ).rejects.toThrow(/permission denied/);
  });
});
