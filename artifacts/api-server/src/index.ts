import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { startSectorPoller, startAnalystActionsPoller } from "./lib/marketDataService";
import { startDigestCron } from "./lib/digest";
import { startWeeklyReportCron } from "./lib/weeklyPsychologyReport";
import { startDailyQuoteCron } from "./lib/dailyQuoteCron";
import { startDbBackupCron } from "./lib/dbBackupCron";
import { registerWebhook } from "./lib/telegramBot";
import { TELEGRAM_WEBHOOK_SECRET } from "./routes/telegram";

// ─── GLOBAL CRASH GUARDS ─────────────────────────────────────────────────────
// Log and continue instead of dying on unhandled async rejections / exceptions.
// Route-level errors are already caught by asyncHandler; these guards protect
// background jobs, crons, and any other async paths that escape normal handling.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "Unhandled promise rejection — keeping server alive");
});

process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "Uncaught exception — keeping server alive");
});

// ─── PORT VALIDATION ─────────────────────────────────────────────────────────
const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ─── STARTUP ─────────────────────────────────────────────────────────────────
function startBackgroundServices(): void {
  try {
    startSectorPoller();
    startAnalystActionsPoller();
    logger.info("Sector strength poller started");
  } catch (e: any) {
    logger.warn({ error: e.message }, "Failed to start sector poller");
  }

  startDigestCron().catch((e: any) => {
    logger.warn({ error: e.message }, "Failed to start digest cron");
  });

  try { startWeeklyReportCron(); } catch (e: any) {
    logger.warn({ error: e.message }, "Failed to start weekly report cron");
  }

  try { startDailyQuoteCron(); } catch (e: any) {
    logger.warn({ error: e.message }, "Failed to start daily quote cron");
  }

  try { startDbBackupCron(); } catch (e: any) {
    logger.warn({ error: e.message }, "Failed to start db backup cron");
  }

  // Register Telegram webhook only in production to avoid dev server stealing the webhook.
  // TELEGRAM_WEBHOOK_URL must be set as an env secret to the stable custom domain
  // (e.g. https://zakit.website/api/telegram/webhook).
  // REPLIT_DOMAINS is NOT used — it contains ephemeral riker.prod.repl.run URLs that
  // change on every deployment and break webhook delivery.
  if (process.env["NODE_ENV"] === "production") {
    const webhookUrl = process.env["TELEGRAM_WEBHOOK_URL"];
    if (webhookUrl) {
      registerWebhook(webhookUrl, TELEGRAM_WEBHOOK_SECRET).catch((e: Error) => {
        logger.warn({ error: e.message }, "Failed to register Telegram webhook");
      });
    } else {
      logger.warn("TELEGRAM_WEBHOOK_URL is not set — Telegram webhook NOT registered. Set it to https://zakit.website/api/telegram/webhook");
    }
  } else {
    logger.info("Telegram webhook skipped — development mode (production keeps its webhook)");
  }
}

async function startServer(attempt = 1): Promise<void> {
  try {
    await runMigrations();
  } catch (error) {
    logger.error({ error }, "Failed to run migrations, continuing anyway");
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      startBackgroundServices();
      resolve();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && attempt <= 5) {
        const delay = attempt * 2000;
        logger.warn({ port, attempt, delay }, `Port in use — retrying in ${delay}ms`);
        setTimeout(() => {
          startServer(attempt + 1).then(resolve).catch(reject);
        }, delay);
      } else {
        logger.error({ err, attempt }, "Fatal: could not bind to port");
        // Don't process.exit — let the process manager (Replit) handle the restart.
        reject(err);
      }
    });
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Server failed to start");
});
