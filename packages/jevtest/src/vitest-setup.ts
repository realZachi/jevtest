/**
 * Side-effect entry point for vitest. Add it to your config:
 *
 * ```ts
 * export default defineConfig({ test: { setupFiles: ["jevtest/vitest/setup"] } });
 * ```
 */
import { setupJevtest } from "./vitest.js";

setupJevtest();
