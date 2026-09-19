import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // test/env.ts loads the repo root .env, then jevtest registers the matchers.
    setupFiles: ["./test/env.ts", "jevtest/vitest/setup"],
    testTimeout: 30_000,
  },
});
