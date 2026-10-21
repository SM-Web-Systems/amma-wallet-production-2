import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/test-integration/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Load test-only env vars for the config module's startup checks
    env: Object.fromEntries(
      require("fs")
        .readFileSync("src/test-integration/.env.integration", "utf8")
        .split("\n")
        .filter((l: string) => l && !l.startsWith("#"))
        .map((l: string) => l.split("=").map((s: string) => s.trim()))
        .map(([k, ...v]: string[]) => [k, v.join("=")])
    ),
    // Integration tests must NOT use module mocks — they use real DB
    // Run sequentially to avoid test data races
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
