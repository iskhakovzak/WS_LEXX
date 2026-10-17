import { eq } from "drizzle-orm";
import { db, dailyQuotesTable } from "@workspace/db";
import { logger } from "./logger";
import { logAudit } from "./audit";
import { generateBundleAndUpsert } from "../routes/dailyQuotes";

function todayKeyMsk(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function mskHour(): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    hour12: false,
  });
  return Number(fmt.formatToParts(new Date()).find((p) => p.type === "hour")?.value || "0");
}

let started = false;
let lastEnsuredDate: string | null = null;

async function ensureToday(reason: string): Promise<void> {
  const date = todayKeyMsk();
  try {
    const rows = await db.select().from(dailyQuotesTable).where(eq(dailyQuotesTable.date, date)).limit(1);
    const row = rows[0];
    const needs = !row || !row.tradingEn || !row.psychologyEn;
    if (!needs) {
      lastEnsuredDate = date;
      return;
    }
    logger.info({ date, reason, hasRow: !!row }, "daily-quote cron: regenerating");
    await generateBundleAndUpsert(date);
    await logAudit({ actor: "system", action: "daily_quote.cron", targetType: "daily_quote", targetId: date, details: { reason } });
    lastEnsuredDate = date;
  } catch (e: any) {
    logger.warn({ error: e.message, date }, "daily-quote cron: ensureToday failed");
  }
}

export function startDailyQuoteCron(): void {
  if (started) return;
  started = true;
  setTimeout(() => { ensureToday("startup"); }, 15 * 1000);
  setInterval(() => {
    const date = todayKeyMsk();
    const hour = mskHour();
    if (hour === 6 && lastEnsuredDate !== date) {
      ensureToday("06:00 MSK");
    }
  }, 5 * 60 * 1000);
  logger.info("Daily quote cron started (ensures today's row at startup + 06:00 MSK)");
}
