import { defineConfig } from "vitest/config";
import path from "path";

// Pure-lib tests only (node env, no DOM): the `@/` alias mirrors vite.config.ts.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
