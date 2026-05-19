import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  timeout: 10_000,
  expect: {
    timeout: 2_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:7274",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 7274",
    url: "http://127.0.0.1:7274",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
