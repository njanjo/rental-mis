import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // `server-only` throws outside the React server runtime; tests exercise
      // the same modules directly, so point at the package's no-op build.
      "server-only": path.resolve(
        import.meta.dirname,
        "node_modules/server-only/empty.js",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
