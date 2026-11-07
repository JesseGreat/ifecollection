// Keys for the LOCAL end-to-end stack only (HS256 JWTs signed with a public, test-only secret).
// Real projects use the keys from the Supabase dashboard; never reuse these.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain CommonJS so Playwright config and the ESM stack can share it
const { createHmac } = require("node:crypto");

const JWT_SECRET = "ifecollection-local-e2e-secret-do-not-use-in-production-0123456789";
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

function signJwt(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token) {
  const [h, p, s] = String(token || "").split(".");
  if (!h || !p || !s) return null;
  const sig = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  if (sig !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}

const EXP = 2051222400; // 2035-01-01
const ANON_KEY = signJwt({ iss: "supabase", role: "anon", iat: 1700000000, exp: EXP });
const SERVICE_KEY = signJwt({ iss: "supabase", role: "service_role", iat: 1700000000, exp: EXP });

module.exports = { JWT_SECRET, ANON_KEY, SERVICE_KEY, signJwt, verifyJwt };
