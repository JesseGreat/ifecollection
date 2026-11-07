import { execFileSync } from "node:child_process";

/** Seed demo users/products into the local stack (idempotent). */
export default function globalSetup() {
  execFileSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "inherit", env: process.env });
}
