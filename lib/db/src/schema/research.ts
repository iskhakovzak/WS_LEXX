import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const researchTable = pgTable("research", {
  id: serial("id").primaryKey(),
  patternName: text("pattern_name").notNull(),
  ticker: text("ticker"),
  context: text("context"),
  marketCondition: text("market_condition"),
  whatWorked: text("what_worked"),
  whatFailed: text("what_failed"),
  repeatCount: integer("repeat_count").default(1),
  confidenceLevel: integer("confidence_level").default(50),
  screenshotUrl: text("screenshot_url"),
  screenshotNotes: text("screenshot_notes"),
  tags: text("tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("research_ticker_idx").on(table.ticker),
  index("research_created_at_idx").on(table.createdAt),
]);

export const insertResearchSchema = createInsertSchema(researchTable).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});
export type InsertResearch = z.infer<typeof insertResearchSchema>;
export type Research = typeof researchTable.$inferSelect;
