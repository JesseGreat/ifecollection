import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createProduct, createUser, openShopNow, pool, rpc } from "./helpers";

let admin: string, staff: string, variantId: string;

beforeAll(async () => {
  await openShopNow();
  admin = await createUser("admin", "Ife Admin");
  staff = await createUser("staff", "Amaka");
  variantId = (await createProduct(admin, { variants: [{ size: "M", colour: "Red", quantity: 20 }] })).variants[0].id;
});
afterAll(() => pool.end());

const saleAs = (uid: string, session: string) =>
  rpc(uid, "select public.create_sale($1, $2, $3) as s", [
    JSON.stringify([{ variant_id: variantId, qty: 1 }]),
    JSON.stringify([{ method: "cash", amount: null }]),
    randomUUID(),
  ], session).then((r) => r.s);

const status = (uid: string, session: string) => rpc(uid, "select public.session_status() as s", [], session).then((r) => r.s);
const claim = (uid: string, session: string) => rpc(uid, "select public.claim_session()", [], session);

describe("one device per account: the newest login wins", () => {
  it("staff: logging in on phone B cuts off phone A everywhere (tables, RPCs, status)", async () => {
    const phoneA = randomUUID();
    const phoneB = randomUUID();

    await claim(staff, phoneA);
    expect(await status(staff, phoneA)).toMatchObject({ allowed: true, replaced: false });
    await expect(saleAs(staff, phoneA)).resolves.toBeTruthy();

    await claim(staff, phoneB); // same account logs in on another phone

    expect(await status(staff, phoneA)).toMatchObject({ allowed: false, replaced: true });
    expect((await as(staff, (c) => c.query("select 1 from public.products"), phoneA)).rowCount).toBe(0);
    expect((await as(staff, (c) => c.query("select 1 from public.sales"), phoneA)).rowCount).toBe(0);
    await expect(saleAs(staff, phoneA)).rejects.toThrow(/SESSION_REPLACED/);

    expect(await status(staff, phoneB)).toMatchObject({ allowed: true, replaced: false });
    await expect(saleAs(staff, phoneB)).resolves.toBeTruthy();
  });

  it("admin too: logging in on the PC cuts off the phone (including admin-only actions)", async () => {
    const phone = randomUUID();
    const pc = randomUUID();
    await claim(admin, phone);
    await expect(rpc(admin, "select public.restock_variant($1, 1)", [variantId], phone)).resolves.toBeTruthy();

    await claim(admin, pc);
    await expect(rpc(admin, "select public.restock_variant($1, 1)", [variantId], phone)).rejects.toThrow(/SESSION_REPLACED/);
    expect((await rpc(admin, "select public.is_admin() as ok", [], phone)).ok).toBe(false);
    expect((await as(admin, (c) => c.query("select 1 from public.audit_log"), phone)).rowCount).toBe(0);
    expect(await status(admin, phone)).toMatchObject({ allowed: false, replaced: true });

    await expect(rpc(admin, "select public.restock_variant($1, 1)", [variantId], pc)).resolves.toBeTruthy();
  });

  it("a request without a session id cannot pass once a session is recorded", async () => {
    const s = await createUser("staff");
    await claim(s, randomUUID());
    await expect(saleAs(s, undefined as unknown as string)).rejects.toThrow(/SESSION_REPLACED/);
  });

  it("logging in again on the SAME device keeps working; a replaced login is in the audit log", async () => {
    const s = await createUser("staff", "Tunde");
    const phone = randomUUID();
    await claim(s, phone);
    await claim(s, phone);
    expect(await status(s, phone)).toMatchObject({ allowed: true });
    expect((await pool.query("select count(*)::int n from public.audit_log where actor_id = $1 and action = 'session_replaced'", [s])).rows[0].n).toBe(0);
    await claim(s, randomUUID());
    expect((await pool.query("select count(*)::int n from public.audit_log where actor_id = $1 and action = 'session_replaced'", [s])).rows[0].n).toBe(1);
  });

  it("claiming needs a real login", async () => {
    await expect(rpc(null, "select public.claim_session()")).rejects.toThrow(/permission denied/);
    await expect(rpc(staff, "select public.claim_session()")).rejects.toThrow(/NOT_AUTHENTICATED/); // no session id
  });
});
