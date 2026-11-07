import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createProduct, createUser, openShopNow, pool, rpc, sale, stockOf } from "./helpers";

let admin: string, staff: string, staff2: string;

beforeAll(async () => {
  await openShopNow();
  admin = await createUser("admin", "Ife Admin");
  staff = await createUser("staff", "Amaka");
  staff2 = await createUser("staff", "Tunde");
});
afterAll(() => pool.end());

describe("create_sale RPC", () => {
  it("reduces stock, logs a movement, prices from the DB and returns a receipt", async () => {
    const p = await createProduct(admin, {
      price: 10000,
      variants: [
        { size: "M", colour: "Red", quantity: 3 },
        { size: "L", colour: "Red", quantity: 5, price_override: 12000 },
      ],
    });
    const [L, M] = p.variants; // ordered by size: L, M
    const s = await sale(staff, [
      { variant_id: M.id, qty: 2 },
      { variant_id: L.id, qty: 1 },
    ]);
    expect(s.total).toBe(2 * 10000 + 12000);
    expect(s.receipt_no).toMatch(/^IFE-\d{6}-\d{4}$/);
    expect(s.staff_name).toBe("Amaka");
    expect(s.payments).toEqual([{ method: "cash", amount: 32000, reference: null }]);
    expect(s.duplicate).toBe(false);
    expect(await stockOf(M.id)).toBe(1);
    expect(await stockOf(L.id)).toBe(4);
    const mv = await pool.query(
      "select qty_change, quantity_after, reason, actor_id from public.stock_movements where sale_id = $1 and variant_id = $2",
      [s.id, M.id],
    );
    expect(mv.rows).toEqual([{ qty_change: -2, quantity_after: 1, reason: "sale", actor_id: staff }]);
  });

  it("blocks overselling and changes nothing", async () => {
    const { variants: [v] } = await createProduct(admin, { variants: [{ size: "S", colour: "Blue", quantity: 2 }] });
    const before = (await pool.query("select count(*)::int n from public.sales")).rows[0].n;
    await expect(sale(staff, [{ variant_id: v.id, qty: 3 }])).rejects.toThrow(/INSUFFICIENT_STOCK/);
    // Same variant split over two lines is still checked as a total.
    await expect(
      sale(staff, [{ variant_id: v.id, qty: 1 }, { variant_id: v.id, qty: 2 }]),
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);
    expect(await stockOf(v.id)).toBe(2);
    expect((await pool.query("select count(*)::int n from public.sales")).rows[0].n).toBe(before);
  });

  it("two tills selling the last item at the same moment: exactly one wins", async () => {
    const { variants: [v] } = await createProduct(admin, { variants: [{ size: "M", colour: "Green", quantity: 1 }] });
    const results = await Promise.allSettled([
      sale(staff, [{ variant_id: v.id, qty: 1 }]),
      sale(staff2, [{ variant_id: v.id, qty: 1 }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await stockOf(v.id)).toBe(0);
  });

  it("ignores a duplicate submission (same idempotency key) – one sale, stock reduced once", async () => {
    const { variants: [v] } = await createProduct(admin, { variants: [{ size: "XL", colour: "Black", quantity: 10 }] });
    const key = randomUUID();
    const first = await sale(staff, [{ variant_id: v.id, qty: 2 }], undefined, key);
    const again = await sale(staff, [{ variant_id: v.id, qty: 2 }], undefined, key);
    expect(again.id).toBe(first.id);
    expect(again.receipt_no).toBe(first.receipt_no);
    expect(again.duplicate).toBe(true);
    expect(await stockOf(v.id)).toBe(8);
    const n = await pool.query("select count(*)::int n from public.sales where idempotency_key = $1", [key]);
    expect(n.rows[0].n).toBe(1);
  });

  it("ignores duplicates that arrive at the same time (bad network retry)", async () => {
    const { variants: [v] } = await createProduct(admin, { variants: [{ size: "L", colour: "White", quantity: 10 }] });
    const key = randomUUID();
    const all = await Promise.all(
      Array.from({ length: 4 }, () => sale(staff, [{ variant_id: v.id, qty: 1 }], undefined, key)),
    );
    expect(new Set(all.map((s) => s.id)).size).toBe(1);
    expect(await stockOf(v.id)).toBe(9);
  });

  it("ignores any price sent by the phone and refuses if the price changed", async () => {
    const { id, variants: [v] } = await createProduct(admin, { price: 15000, variants: [{ size: "M", colour: "Red", quantity: 5 }] });
    const s = await rpc(staff, "select public.create_sale($1, $2, $3) as s", [
      JSON.stringify([{ variant_id: v.id, qty: 1, unit_price: 1, price: 1 }]),
      JSON.stringify([{ method: "cash", amount: null }]),
      randomUUID(),
    ]).then((r) => r.s);
    expect(s.total).toBe(15000);
    await pool.query("update public.products set price = 16000 where id = $1", [id]);
    await expect(sale(staff, [{ variant_id: v.id, qty: 1 }], undefined, randomUUID(), 15000)).rejects.toThrow(
      /PRICE_CHANGED/,
    );
  });

  it("accepts split payments only when they add up to the total", async () => {
    const { variants: [v] } = await createProduct(admin, { price: 12000, variants: [{ size: "S", colour: "Gold", quantity: 5 }] });
    const ok = await sale(staff, [{ variant_id: v.id, qty: 1 }], [
      { method: "cash", amount: 5000 },
      { method: "transfer", amount: 7000, reference: "GTB-12345" },
    ]);
    expect(ok.payments).toEqual(
      expect.arrayContaining([
        { method: "cash", amount: 5000, reference: null },
        { method: "transfer", amount: 7000, reference: "GTB-12345" },
      ]),
    );
    await expect(
      sale(staff, [{ variant_id: v.id, qty: 1 }], [
        { method: "cash", amount: 5000 },
        { method: "pos", amount: 6000 },
      ]),
    ).rejects.toThrow(/PAYMENT_MISMATCH/);
    await expect(sale(staff, [{ variant_id: v.id, qty: 1 }], [{ method: "bitcoin", amount: 12000 }])).rejects.toThrow(
      /INVALID_PAYMENT/,
    );
    expect(await stockOf(v.id)).toBe(4);
  });

  it("rejects empty carts, bad quantities and archived products", async () => {
    const { id, variants: [v] } = await createProduct(admin, { variants: [{ size: "M", colour: "Pink", quantity: 5 }] });
    await expect(sale(staff, [])).rejects.toThrow(/EMPTY_CART/);
    await expect(sale(staff, [{ variant_id: v.id, qty: 0 }])).rejects.toThrow(/INVALID_ITEM/);
    await expect(sale(staff, [{ variant_id: v.id, qty: -1 }])).rejects.toThrow(/INVALID_ITEM/);
    await expect(sale(staff, [{ variant_id: v.id, qty: 1.5 }])).rejects.toThrow(/INVALID_ITEM/);
    await pool.query("update public.products set archived = true where id = $1", [id]);
    await expect(sale(staff, [{ variant_id: v.id, qty: 1 }])).rejects.toThrow(/PRODUCT_UNAVAILABLE/);
  });

  it("numbers receipts per day without gaps", async () => {
    const { variants: [v] } = await createProduct(admin, { variants: [{ size: "M", colour: "Teal", quantity: 5 }] });
    const a = await sale(staff, [{ variant_id: v.id, qty: 1 }]);
    const b = await sale(staff2, [{ variant_id: v.id, qty: 1 }]);
    const na = Number(a.receipt_no.slice(-4));
    expect(Number(b.receipt_no.slice(-4))).toBe(na + 1);
  });
});

describe("void_sale RPC (admin only)", () => {
  it("returns items to stock, keeps the sale, logs movement and audit", async () => {
    const { variants: [v] } = await createProduct(admin, { variants: [{ size: "M", colour: "Navy", quantity: 5 }] });
    const s = await sale(staff, [{ variant_id: v.id, qty: 3 }]);
    expect(await stockOf(v.id)).toBe(2);

    await expect(rpc(staff, "select public.void_sale($1, 'mistake')", [s.id])).rejects.toThrow(/ADMIN_ONLY/);
    await expect(rpc(admin, "select public.void_sale($1, '')", [s.id])).rejects.toThrow(/REASON_REQUIRED/);

    const voided = (await rpc(admin, "select public.void_sale($1, 'Customer returned it') as s", [s.id])).s;
    expect(voided.status).toBe("voided");
    expect(await stockOf(v.id)).toBe(5);
    const row = (await pool.query("select status, void_reason, voided_by from public.sales where id = $1", [s.id])).rows[0];
    expect(row).toEqual({ status: "voided", void_reason: "Customer returned it", voided_by: admin });
    const mv = await pool.query("select qty_change, reason from public.stock_movements where sale_id = $1 order by id", [s.id]);
    expect(mv.rows).toEqual([{ qty_change: -3, reason: "sale" }, { qty_change: 3, reason: "void" }]);
    const audit = await pool.query("select actor_id, details->>'reason' r from public.audit_log where action = 'sale_void' and entity_id = $1", [s.id]);
    expect(audit.rows).toEqual([{ actor_id: admin, r: "Customer returned it" }]);

    await expect(rpc(admin, "select public.void_sale($1, 'again')", [s.id])).rejects.toThrow(/ALREADY_VOIDED/);
    expect(await stockOf(v.id)).toBe(5);
  });
});

describe("stock & product RPCs", () => {
  it("restock and adjustments are logged with who/why; price changes are audited", async () => {
    const { id, variants: [v] } = await createProduct(admin, { variants: [{ size: "M", colour: "Red", quantity: 2 }] });
    expect((await rpc(admin, "select public.restock_variant($1, 5, 'New delivery') as q", [v.id])).q).toBe(7);
    expect((await rpc(admin, "select public.adjust_stock($1, 6, 'One damaged') as q", [v.id])).q).toBe(6);
    const mv = await pool.query(
      "select qty_change, reason, note, actor_id from public.stock_movements where variant_id = $1 order by id",
      [v.id],
    );
    expect(mv.rows).toEqual([
      { qty_change: 2, reason: "initial", note: "New variant", actor_id: admin },
      { qty_change: 5, reason: "restock", note: "New delivery", actor_id: admin },
      { qty_change: -1, reason: "adjustment", note: "One damaged", actor_id: admin },
    ]);
    await as(admin, (c) => c.query("update public.products set price = 20000 where id = $1", [id]));
    const audit = await pool.query(
      "select actor_id, details from public.audit_log where action = 'price_change' and entity_id = $1",
      [id],
    );
    expect(audit.rows[0].actor_id).toBe(admin);
    expect(audit.rows[0].details).toMatchObject({ old: 10000, new: 20000 });
  });

  it("save_product deactivates removed variants instead of deleting them", async () => {
    const p = await createProduct(admin, {
      variants: [
        { size: "M", colour: "Red", quantity: 1 },
        { size: "L", colour: "Red", quantity: 1 },
      ],
    });
    await rpc(admin, "select public.save_product($1)", [
      { id: p.id, name: "Renamed", price: 9000, variants: [{ size: "M", colour: "Red" }] },
    ]);
    const rows = (await pool.query("select size, active, quantity from public.product_variants where product_id = $1 order by size", [p.id])).rows;
    expect(rows).toEqual([
      { size: "L", active: false, quantity: 1 },
      { size: "M", active: true, quantity: 1 }, // existing stock untouched by edits
    ]);
  });
});
