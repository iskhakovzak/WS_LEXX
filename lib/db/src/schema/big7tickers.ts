import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const big7TickersTable = pgTable("big7_tickers", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull().default("NASDAQ"),
  name: text("name").notNull(),
  groupName: text("group_name").notNull().default("core"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("big7_tickers_group_idx").on(table.groupName),
  uniqueIndex("big7_tickers_group_symbol_unique").on(table.groupName, table.symbol),
]);

export const insertBig7TickerSchema = createInsertSchema(big7TickersTable).omit({ id: true, createdAt: true });
export type InsertBig7Ticker = z.infer<typeof insertBig7TickerSchema>;
export type Big7Ticker = typeof big7TickersTable.$inferSelect;
