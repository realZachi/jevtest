import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vitest: "src/vitest.ts",
    "vitest-setup": "src/vitest-setup.ts",
    jest: "src/jest.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  platform: "node",
  external: ["vitest", "jest", "@jest/globals", "expect"],
});
