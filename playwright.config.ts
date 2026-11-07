import { defineConfig, devices } from "@playwright/test";
// Keys of the LOCAL test stack (scripts/e2e/stack.mjs). Never real keys.
import { ANON_KEY, SERVICE_KEY } from "./scripts/e2e/keys.cjs";
import { E2E_CLOUDINARY } from "./tests/e2e/cloudinary-env";

const APP_PORT = 3100;
export const E2E_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  E2E_DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/ife_e2e",
};
Object.assign(process.env, E2E_ENV);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // tests share one database and change the shop hours
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "America/New_York", // the phone's clock/zone must not matter
  },
  projects: [
    {
      name: "phone-360x740",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 360, height: 740 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        browserName: "chromium",
      },
    },
  ],
  webServer: [
    {
      command: "node scripts/e2e/stack.mjs",
      url: "http://127.0.0.1:54321/health",
      timeout: 90_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
    },
    {
      command: `npx next build && npx next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/offline`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: { ...E2E_ENV, ...E2E_CLOUDINARY, NEXT_DIST_DIR: ".e2e/next" },
    },
  ],
});
