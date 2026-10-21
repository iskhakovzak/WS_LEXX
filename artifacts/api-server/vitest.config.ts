import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 20_000,
    // Scratch databases (db/__tests__/scratchDb.ts) are created and dropped in hooks; under a full parallel run a
    // DROP DATABASE … WITH (FORCE) can take longer than the 10 s default and failed random files in cleanup.
    hookTimeout: 60_000,
  },
});
