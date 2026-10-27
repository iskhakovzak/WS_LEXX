/**
 * Imported FIRST by scripts/whatif-calibrate.ts (esbuild keeps the import order of side effects):
 *   - the engine modules reach @workspace/db, which builds its (never used here) default pool from DATABASE_URL at
 *     import time — local default only; the harness refuses a non-local host;
 *   - they also reach lib/logger (pino with the pino-pretty transport outside production), whose worker files are
 *     found through __dirname — undefined in the run-ts ESM bundle. pino and thread-stream look up
 *     globalThis.__bundlerPathsOverrides first (the esbuild-plugin-pino mechanism), so point them at the installed files.
 */
import { createRequire } from "node:module";
import path from "node:path";

export const CALIBRATE_DB_URL = process.env.CALIBRATE_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/edge_tracker";
process.env.DATABASE_URL ??= CALIBRATE_DB_URL;

const req = createRequire(import.meta.url);
const pinoDir = path.dirname(req.resolve("pino/package.json"));
const threadStreamDir = path.dirname(req.resolve("thread-stream/package.json"));
(globalThis as { __bundlerPathsOverrides?: Record<string, string> }).__bundlerPathsOverrides = {
  "pino-worker": path.join(pinoDir, "lib", "worker.js"),
  "thread-stream-worker": path.join(threadStreamDir, "lib", "worker.js"),
  "pino-pretty": req.resolve("pino-pretty"),
};
