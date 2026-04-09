import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eventsTable } from "./events";
import { researchTable } from "./research";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  date: text("date").notNull(),
  setup: text("setup"),
  side: text("side"),
  eventType: text("event_type"),
  entry: numeric("entry", { precision: 12, scale: 4 }),
  exit: numeric("exit", { precision: 12, scale: 4 }),
  stop: numeric("stop", { precision: 12, scale: 4 }),
  result: text("result").notNull(),
  pnl: numeric("pnl", { precision: 12, scale: 2 }),
  rMultiple: numeric("r_multiple", { precision: 8, scale: 2 }),
  holdTime: text("hold_time"),
  slippage: numeric("slippage", { precision: 8, scale: 2 }),
  marketCap: text("market_cap"),
  float: text("float"),
  relativeVolume: numeric("relative_volume", { precision: 8, scale: 2 }),
  session: text("session"),
  screenshotUrl: text("screenshot_url"),
  screenshotNotes: text("screenshot_notes"),
  notes: text("notes"),
  whatWorked: text("what_worked"),
  whatFailed: text("what_failed"),
  conclusion: text("conclusion"),
  trader: text("trader"),
  tags: text("tags"),
  eventId: integer("event_id").references(() => eventsTable.id),
  patternId: integer("pattern_id").references(() => researchTable.id),
  playbookId: integer("playbook_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("trades_ticker_idx").on(table.ticker),
  index("trades_date_idx").on(table.date),
  index("trades_trader_idx").on(table.trader),
  index("trades_created_at_idx").on(table.createdAt),
  index("trades_event_id_idx").on(table.eventId),
  index("trades_pattern_id_idx").on(table.patternId),
  index("trades_playbook_id_idx").on(table.playbookId),
]);

export const insertTradeSchema = createInsertSchema(tradesTable).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
