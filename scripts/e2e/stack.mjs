// Local Supabase-compatible stack for Playwright tests, without Docker:
//   Postgres (local) + real GoTrue (Supabase Auth) + real PostgREST + this gateway on :54321
//   which routes /auth/v1 -> GoTrue, /rest/v1 -> PostgREST, /storage/v1 -> a small storage stand-in.
// Usage: node scripts/e2e/stack.mjs            (Ctrl+C to stop)
// Needs: Postgres running (scripts/local-pg.sh start) and binaries in .e2e/bin (scripts/e2e/get-binaries.sh).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createReadStream, unlinkSync } from "node:fs";
import http from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import keys from "./keys.cjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(ROOT, ".e2e", "bin");
const FILES = join(ROOT, ".e2e", "storage");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const DB = "ife_e2e";
const PORT = 54321;
const PGRST_PORT = 54331;
const AUTH_PORT = 54332;
const { JWT_SECRET, ANON_KEY, SERVICE_KEY, verifyJwt } = keys;
export { ANON_KEY, SERVICE_KEY };

function dbUrl(name, user) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  if (user) u.username = user;
  return u.toString();
}

async function waitFor(url, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start (${url})`);
}

const children = [];
function run(cmd, args, env, label) {
  const p = spawn(cmd, args, { cwd: BIN, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const log = (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${label}] ${d}`);
  p.stdout.on("data", log);
  p.stderr.on("data", (d) => {
    log(d);
    if (/fatal|panic|error/i.test(String(d)) && !process.env.E2E_VERBOSE) process.stderr.write(`[${label}] ${d}`);
  });
  p.on("exit", (code) => code && code !== 143 && console.error(`[${label}] exited with ${code}`));
  children.push(p);
  return p;
}

async function setupDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();
  const db = new pg.Client({ connectionString: dbUrl(DB) });
  await db.connect();
  await db.query(readFileSync(join(ROOT, "scripts/e2e/bootstrap.sql"), "utf8"));
  await db.end();
}

async function applyMigrations() {
  const db = new pg.Client({ connectionString: dbUrl(DB) });
  await db.connect();
  const dir = join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(join(dir, f), "utf8"));
  }
  await db.end();
}

// ---------------------------------------------------------------- gateway + storage stand-in
const pool = new pg.Pool({ connectionString: dbUrl(DB), max: 4 });

async function isAdmin(claims) {
  if (!claims) return false;
  if (claims.role === "service_role") return true;
  const { rows } = await pool.query(
    "select exists(select 1 from public.profiles where id = $1 and role = 'admin' and active) as ok",
    [claims.sub],
  );
  return rows[0].ok;
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ??
      "authorization,apikey,content-type,x-client-info,x-upsert,prefer,accept-profile,content-profile,range,cache-control,x-supabase-api-version",
  );
  res.setHeader("Access-Control-Expose-Headers", "content-range,content-length,x-supabase-api-version");
}

function proxy(req, res, port, path) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const up = http.request({ host: "127.0.0.1", port, path, method: req.method, headers }, (r) => {
    const h = { ...r.headers };
    for (const k of Object.keys(h)) if (k.startsWith("access-control-")) delete h[k];
    res.writeHead(r.statusCode ?? 502, h);
    r.pipe(res);
  });
  up.on("error", (e) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: e.message }));
  });
  req.pipe(up);
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const safePath = (p) => {
  const n = normalize(decodeURIComponent(p)).replace(/^(\.\.(\/|\\|$))+/, "");
  return join(FILES, n);
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

async function storage(req, res, path) {
  const url = new URL(path, "http://x");
  const p = url.pathname;
  const pub = p.match(/^\/object\/public\/([^/]+)\/(.+)$/);
  if (pub && (req.method === "GET" || req.method === "HEAD")) {
    const file = safePath(`${pub[1]}/${pub[2]}`);
    if (!existsSync(file)) return json(res, 404, { message: "Object not found" });
    res.writeHead(200, {
      "content-type": file.endsWith(".webp") ? "image/webp" : file.endsWith(".png") ? "image/png" : "image/jpeg",
      "cache-control": "public, max-age=31536000",
    });
    return createReadStream(file).pipe(res);
  }
  const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  const obj = p.match(/^\/object\/([^/]+)\/(.+)$/);
  if (obj && (req.method === "POST" || req.method === "PUT")) {
    if (!(await isAdmin(claims))) return json(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    const file = safePath(`${obj[1]}/${obj[2]}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await readBody(req));
    return json(res, 200, { Key: `${obj[1]}/${obj[2]}` });
  }
  const bucket = p.match(/^\/object\/([^/]+)\/?$/);
  if (bucket && req.method === "DELETE") {
    if (!(await isAdmin(claims))) return json(res, 403, { message: "Unauthorized" });
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
    for (const name of prefixes) {
      const f = safePath(`${bucket[1]}/${name}`);
      if (existsSync(f)) unlinkSync(f);
    }
    return json(res, 200, prefixes.map((name) => ({ name })));
  }
  return json(res, 404, { message: `storage stand-in: ${req.method} ${p} not supported` });
}

function startGateway() {
  const server = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = req.url ?? "/";
    try {
      if (url.startsWith("/rest/v1")) return proxy(req, res, PGRST_PORT, url.slice("/rest/v1".length) || "/");
      if (url.startsWith("/auth/v1")) return proxy(req, res, AUTH_PORT, url.slice("/auth/v1".length) || "/");
      if (url.startsWith("/storage/v1")) return await storage(req, res, url.slice("/storage/v1".length));
      if (url === "/health") return json(res, 200, { ok: true });
      json(res, 404, { message: "not found" });
    } catch (e) {
      json(res, 500, { message: e.message });
    }
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function main() {
  if (!existsSync(join(BIN, "auth")) || !existsSync(join(BIN, "postgrest"))) {
    throw new Error("Missing .e2e/bin/auth or .e2e/bin/postgrest. Run: scripts/e2e/get-binaries.sh");
  }
  rmSync(FILES, { recursive: true, force: true });
  mkdirSync(FILES, { recursive: true });

  await setupDatabase();

  run(join(BIN, "auth"), [], {
    GOTRUE_API_HOST: "127.0.0.1",
    PORT: String(AUTH_PORT),
    GOTRUE_API_PORT: String(AUTH_PORT),
    API_EXTERNAL_URL: `http://127.0.0.1:${PORT}/auth/v1`,
    GOTRUE_DB_DRIVER: "postgres",
    DATABASE_URL: dbUrl(DB, "supabase_auth_admin"),
    GOTRUE_DB_DATABASE_URL: dbUrl(DB, "supabase_auth_admin"),
    GOTRUE_DB_MIGRATIONS_PATH: join(BIN, "migrations"),
    GOTRUE_SITE_URL: "http://127.0.0.1:3100",
    GOTRUE_JWT_SECRET: JWT_SECRET,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_DISABLE_SIGNUP: "true",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "10000",
    GOTRUE_RATE_LIMIT_VERIFY: "10000",
    GOTRUE_LOG_LEVEL: "warn",
  }, "auth");
  await waitFor(`http://127.0.0.1:${AUTH_PORT}/health`, "GoTrue");

  await applyMigrations();

  run(join(BIN, "postgrest"), [], {
    PGRST_DB_URI: dbUrl(DB, "authenticator"),
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_SERVER_PORT: String(PGRST_PORT),
    PGRST_DB_POOL: "10",
    PGRST_LOG_LEVEL: "warn",
  }, "postgrest");
  await waitFor(`http://127.0.0.1:${PGRST_PORT}/`, "PostgREST");

  await startGateway();
  console.log(`IfeCollection local stack ready on http://127.0.0.1:${PORT} (db: ${dbUrl(DB)})`);
}

function stop() {
  children.forEach((c) => c.kill("SIGTERM"));
  pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    children.forEach((c) => c.kill("SIGTERM"));
    process.exit(1);
  });
}
