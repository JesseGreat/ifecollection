import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createProduct, createUser, openShopNow, pool, rpc, sale, stockOf } from "./helpers";

let admin: string;
let vA: string, vB: string;

beforeAll(async () => {
  await openShopNow();
  admin = await createUser("admin");
  const p = await createProduct(admin, {
    variants: [
      { size: "M", colour: "Red", quantity: 5 },
      { size: "L", colour: "Red", quantity: 2 },
    ],
  });
  [vB, vA] = p.variants.map((v) => v.id); // ordered L, M
});
afterAll(() => pool.end());

const start = (uid: string, kind: "opening" | "closing") =>
  rpc(uid, "select public.start_stock_count($1) as c", [kind]).then((r) => r.c);
const submit = (uid: string, id: string, lines: { variant_id: string; counted: number }[]) =>
  rpc(uid, "select public.submit_stock_count($1, $2) as c", [id, JSON.stringify(lines)]).then((r) => r.c);
/** Count everything as the system says, except the overrides. */
const countAll = (c: { lines: { variant_id: string; expected: number }[] }, over: Record<string, number> = {}) =>
  c.lines.map((l) => ({ variant_id: l.variant_id, counted: over[l.variant_id] ?? l.expected }));

describe("daily stock counts", () => {
  it("a sales person cannot sell before their opening count", async () => {
    const s = await createUser("staff", "New", { openingCount: false });
    await expect(sale(s, [{ variant_id: vA, qty: 1 }])).rejects.toThrow(/OPENING_COUNT_REQUIRED/);
    expect((await rpc(s, "select public.session_status() as s")).s.opening_done).toBe(false);
    expect(await stockOf(vA)).toBe(5); // nothing changed
  });

  it("every item must be counted; then sales are allowed", async () => {
    const s = await createUser("staff", "Amaka", { openingCount: false });
    const c = await start(s, "opening");
    expect(c.lines.length).toBeGreaterThanOrEqual(2); // every active item, including zero-stock ones
    expect(c.lines.find((l: { variant_id: string }) => l.variant_id === vA).expected).toBe(5);

    // Leaving one item out is refused.
    await expect(submit(s, c.id, [{ variant_id: vA, counted: 5 }])).rejects.toThrow(/COUNT_INCOMPLETE/);
    await expect(submit(s, c.id, countAll(c, { [vA]: -1 }))).rejects.toThrow(/INVALID_QTY/);

    const done = await submit(s, c.id, countAll(c));
    expect(done.status).toBe("submitted");
    expect(done.summary).toMatchObject({ mismatches: 0, missing: 0, extra: 0 });
    expect((await rpc(s, "select public.session_status() as s")).s.opening_done).toBe(true);
    await expect(sale(s, [{ variant_id: vA, qty: 1 }])).resolves.toBeTruthy();
    // Starting again just returns the finished count.
    expect((await start(s, "opening")).status).toBe("submitted");
    await expect(submit(s, c.id, countAll(c))).rejects.toThrow(/COUNT_ALREADY_DONE/);
  });

  it("differences are recorded; the admin can accept (correct stock by the difference) or dismiss", async () => {
    const s = await createUser("staff", "Tunde", { openingCount: false });
    const before = await stockOf(vB);
    const c = await start(s, "opening");
    const expectedB = c.lines.find((l: { variant_id: string }) => l.variant_id === vB).expected;
    const done = await submit(s, c.id, countAll(c, { [vB]: expectedB - 1 }));
    expect(done.summary).toMatchObject({ mismatches: 1, missing: 1, extra: 0 });
    expect(await stockOf(vB)).toBe(before); // staff cannot change stock by counting

    const rep = (await rpc(admin, "select public.daily_count_report(public.lagos_today()) as r")).r;
    const mine = rep.find((r: { staff_id: string }) => r.staff_id === s);
    expect(mine.opening).toMatchObject({ status: "submitted", mismatches: 1, unresolved: 1, missing: 1 });

    const line = (await pool.query("select id from public.stock_count_lines where count_id = $1 and variant_id = $2", [c.id, vB])).rows[0].id;
    await expect(rpc(s, "select public.resolve_count_line($1, true)", [line])).rejects.toThrow(/ADMIN_ONLY/);
    await rpc(admin, "select public.resolve_count_line($1, true)", [line]);
    expect(await stockOf(vB)).toBe(before - 1);
    const mv = (await pool.query("select qty_change, reason, note from public.stock_movements where variant_id = $1 order by id desc limit 1", [vB])).rows[0];
    expect(mv).toMatchObject({ qty_change: -1, reason: "adjustment" });
    expect(mv.note).toMatch(/Opening count .* by Tunde: 1 missing/);
    await expect(rpc(admin, "select public.resolve_count_line($1, true)", [line])).rejects.toThrow(/ALREADY_RESOLVED/);
  });

  it("closing count (or 'count tomorrow') closes that person's day: no more sales", async () => {
    const s = await createUser("staff", "Closer", { openingCount: false });
    await expect(start(s, "closing")).rejects.toThrow(/OPENING_COUNT_REQUIRED/);
    const o = await start(s, "opening");
    await submit(s, o.id, countAll(o));
    await sale(s, [{ variant_id: vA, qty: 1 }]);
    const c = await start(s, "closing");
    await submit(s, c.id, countAll(c));
    expect((await rpc(s, "select public.session_status() as s")).s.closing_done).toBe(true);
    await expect(sale(s, [{ variant_id: vA, qty: 1 }])).rejects.toThrow(/DAY_CLOSED/);

    const s2 = await createUser("staff", "Late");
    await rpc(s2, "select public.skip_closing_count('Too late, count tomorrow')");
    await expect(sale(s2, [{ variant_id: vA, qty: 1 }])).rejects.toThrow(/DAY_CLOSED/);
    const row = (await pool.query("select status, skip_reason from public.stock_counts where staff_id = $1 and kind = 'closing'", [s2])).rows[0];
    expect(row).toEqual({ status: "skipped", skip_reason: "Too late, count tomorrow" });
  });

  it("the admin's report shows started with / sold / closing per sales person", async () => {
    const s = await createUser("staff", "Report", { openingCount: false });
    const o = await start(s, "opening");
    await submit(s, o.id, countAll(o));
    await sale(s, [{ variant_id: vA, qty: 2 }]);
    const c = await start(s, "closing");
    await submit(s, c.id, countAll(c));
    const r = (await rpc(admin, "select public.daily_count_report(public.lagos_today()) as r")).r.find(
      (x: { staff_id: string }) => x.staff_id === s,
    );
    expect(r.opening.units - r.units_sold).toBe(r.closing.units); // nothing went missing
    expect(r).toMatchObject({ sales: 1, units_sold: 2, closing: { status: "submitted", mismatches: 0 } });
  });

  it("staff only see their own counts, cannot write them directly, and admin is never blocked from selling", async () => {
    const a = await createUser("staff", "A");
    const b = await createUser("staff", "B", { openingCount: false });
    const cb = await start(b, "opening");
    expect((await as(a, (c) => c.query("select 1 from public.stock_counts where id = $1", [cb.id]))).rowCount).toBe(0);
    await expect(submit(a, cb.id, countAll(cb))).rejects.toThrow(/COUNT_NOT_FOUND/);
    await expect(
      as(a, (c) => c.query("insert into public.stock_counts (staff_id, kind, business_day, status) values ($1, 'opening', current_date, 'submitted')", [a])),
    ).rejects.toThrow(/permission denied/);
    await expect(as(b, (c) => c.query("update public.stock_count_lines set counted = 99 where count_id = $1", [cb.id]))).rejects.toThrow(/permission denied/);
    await expect(rpc(a, "select public.daily_count_report(public.lagos_today())")).rejects.toThrow(/ADMIN_ONLY/);
    await expect(sale(admin, [{ variant_id: vA, qty: 1 }], undefined, randomUUID())).resolves.toBeTruthy();
  });
});
