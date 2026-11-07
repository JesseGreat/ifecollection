import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
export const TEST_DB = "ife_test";

export function testDbUrl() {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

/** Create a fresh database, load the Supabase shim, then apply every migration in order. */
export default async function setup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `Cannot reach Postgres at ${ADMIN_URL}. Start one with "scripts/local-pg.sh start" ` +
        `or set TEST_DATABASE_URL. (${(e as Error).message})`,
    );
  }
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const db = new Client({ connectionString: testDbUrl() });
  await db.connect();
  const root = join(__dirname, "..", "..");
  await db.query(readFileSync(join(root, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  await db.end();
}
