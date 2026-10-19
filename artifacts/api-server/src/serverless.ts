/**
 * Vercel entry (build-vercel.mjs → .vercel/output/functions/index.func): the same Express app as src/index.ts, without
 * a port, the job scheduler or the Telegram webhook registration — a function instance only answers requests. The boot
 * steps (config check, versioned migrations under their advisory lock, legacy DDL, Latin names, desk settings) run once
 * per instance, on its first request; a failed boot answers 503 and is retried on the next request.
 *
 * The app is imported only after the versioned migrations: several route modules create their own tables when they
 * load (CREATE TABLE IF NOT EXISTS …), and on an empty database that would beat 0001_baseline to those tables and make
 * it fail. Static imports here are limited to modules that create nothing.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { loadBootConfig } from "./config";
import { logger } from "./lib/logger";
import { pool, setPoolErrorHandler } from "@workspace/db";
import { runMigrationFiles } from "./db/runner";

setPoolErrorHandler((err) => logger.error({ err }, "db: idle client error"));

async function bootOnce(): Promise<Express> {
  const { config, warnings } = loadBootConfig();
  for (const w of warnings) logger.warn(`config: ${w}`);
  const r = await runMigrationFiles({ pool, logger, production: config.isProduction });
  logger.info({ applied: r.applied.map((m) => `${m.version}_${m.name}`), total: r.total }, "migrations: up to date");
  const [{ default: app }, { runMigrations }, { ensureTradeStructureSchema }, { reloadLatinNames }, { warmSettings }] = await Promise.all([
    import("./app"),
    import("./lib/migrate"),
    import("./lib/tradeStructureStore"),
    import("./lib/people/latinNames"),
    import("./lib/settings/store"),
  ]);
  await runMigrations().catch((err) => logger.error({ err }, "legacy runMigrations failed, continuing"));
  await ensureTradeStructureSchema().catch((err) => logger.error({ err }, "trade-structure columns failed, continuing"));
  await reloadLatinNames();
  await warmSettings();
  return app;
}

let ready: Promise<Express> | null = null;
function boot(): Promise<Express> {
  ready ??= bootOnce().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app: Express;
  try {
    app = await boot();
  } catch (err) {
    logger.error({ err }, "serverless boot failed");
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Server is starting, try again", code: "SERVICE_UNAVAILABLE" }));
    return;
  }
  app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
}
