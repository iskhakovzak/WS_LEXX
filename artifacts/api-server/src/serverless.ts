/**
 * Vercel entry (build-vercel.mjs → .vercel/output/functions/index.func): the same Express app as src/index.ts, without
 * a port, the job scheduler or the Telegram webhook registration — a function instance only answers requests. The boot
 * steps (config check, versioned migrations under their advisory lock, legacy DDL, Latin names, desk settings) run once
 * per instance, on its first request; a failed boot answers 503 and is retried on the next request.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadBootConfig } from "./config";
import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { reloadLatinNames } from "./lib/people/latinNames";
import { warmSettings } from "./lib/settings/store";
import { ensureTradeStructureSchema } from "./lib/tradeStructureStore";
import { pool, setPoolErrorHandler } from "@workspace/db";
import { runMigrationFiles } from "./db/runner";

setPoolErrorHandler((err) => logger.error({ err }, "db: idle client error"));

async function bootOnce(): Promise<void> {
  const { config, warnings } = loadBootConfig();
  for (const w of warnings) logger.warn(`config: ${w}`);
  const r = await runMigrationFiles({ pool, logger, production: config.isProduction });
  logger.info({ applied: r.applied.map((m) => `${m.version}_${m.name}`), total: r.total }, "migrations: up to date");
  await runMigrations().catch((err) => logger.error({ err }, "legacy runMigrations failed, continuing"));
  await ensureTradeStructureSchema().catch((err) => logger.error({ err }, "trade-structure columns failed, continuing"));
  await reloadLatinNames();
  await warmSettings();
}

let ready: Promise<void> | null = null;
function boot(): Promise<void> {
  ready ??= bootOnce().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await boot();
  } catch (err) {
    logger.error({ err }, "serverless boot failed");
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Server is starting, try again", code: "SERVICE_UNAVAILABLE" }));
    return;
  }
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
