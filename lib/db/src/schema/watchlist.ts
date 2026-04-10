import { pgTable, text, serial, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const watchlistTable = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  catalyst: text("catalyst"),
  targetPrice: numeric("target_price", { precision: 12, scale: 4 }),
  stopPrice: numeric("stop_price", { precision: 12, scale: 4 }),
  status: text("status").notNull().default("watching"),
  notes: text("notes"),
  sector: text("sector"),
  screenshotUrl: text("screenshot_url"),
  tags: text("tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("watchlist_ticker_idx").on(table.ticker),
  index("watchlist_created_at_idx").on(table.createdAt),
]);

export const insertWatchlistSchema = createInsertSchema(watchlistTable).omit({ id: true, createdAt: true, deletedAt: true });
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type WatchlistItem = typeof watchlistTable.$inferSelect;
