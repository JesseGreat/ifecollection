import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { testDbUrl } from "./global-setup";

/** Superuser pool (bypasses RLS) – only for fixtures and assertions, never for the code under test. */
export const pool = new Pool({ connectionString: testDbUrl(), max: 8 });

let n = 0;
export async function createUser(role: "admin" | "staff", fullName?: string): Promise<string> {
  const username = `${role}${Date.now().toString(36)}${n++}`;
  const { rows } = await pool.query(
    `insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id`,
    [`${username}@staff.ifecollection.app`, { username, full_name: fullName ?? username, role }],
  );
  return rows[0].id;
}

/**
 * Run fn exactly like a request through Supabase's API would: role `authenticated` (or `anon`)
 * with the user's id in request.jwt.claims. RLS and grants apply.
 */
export async function as<T>(uid: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(uid ? "set local role authenticated" : "set local role anon");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" }),
    ]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Tests read arbitrary JSON shapes from SQL; `any` keeps them short.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = any>(uid: string | null, sql: string, params: unknown[] = []): Promise<T> {
  return as(uid, async (c) => (await c.query(sql, params)).rows[0] as T);
}

/** Working hours that include the real current moment (Lagos). */
export async function openShopNow() {
  await pool.query(`update public.settings set
      staff_open_time = ((now() at time zone 'Africa/Lagos') - interval '1 hour')::time,
      staff_close_time = ((now() at time zone 'Africa/Lagos') + interval '1 hour')::time`);
}
/** Working hours that exclude the real current moment, i.e. "it is now after closing". */
export async function closeShopNow() {
  await pool.query(`update public.settings set
      staff_open_time = ((now() at time zone 'Africa/Lagos') + interval '1 hour')::time,
      staff_close_time = ((now() at time zone 'Africa/Lagos') + interval '2 hours')::time`);
}
export async function defaultHours() {
  await pool.query(`update public.settings set staff_open_time = '08:00', staff_close_time = '20:00'`);
}

export async function createProduct(
  adminId: string,
  opts: { price?: number; variants?: { size: string; colour: string; quantity: number; price_override?: number }[] } = {},
) {
  const id: string = (
    await rpc(adminId, "select public.save_product($1) as id", [
      {
        name: `Test gown ${randomUUID().slice(0, 6)}`,
        price: opts.price ?? 10000,
        variants: opts.variants ?? [{ size: "M", colour: "Red", quantity: 3 }],
      },
    ])
  ).id;
  const { rows } = await pool.query(
    `select id, size, colour, quantity from public.product_variants where product_id = $1 order by size, colour`,
    [id],
  );
  return { id, variants: rows as { id: string; size: string; colour: string; quantity: number }[] };
}

export async function stockOf(variantId: string): Promise<number> {
  return (await pool.query(`select quantity from public.product_variants where id = $1`, [variantId])).rows[0]
    .quantity;
}

export function sale(
  uid: string,
  items: { variant_id: string; qty: number }[],
  payments: { method: string; amount?: number | null; reference?: string }[] = [{ method: "cash", amount: null }],
  key: string = randomUUID(),
  expectedTotal: number | null = null,
) {
  return rpc(uid, "select public.create_sale($1, $2, $3, null, null, $4) as s", [
    JSON.stringify(items),
    JSON.stringify(payments),
    key,
    expectedTotal,
  ]).then((r) => r.s);
}
