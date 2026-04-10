import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const playbookTable = pgTable("playbook", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  folder: text("folder"),
  setupType: text("setup_type"),
  conditions: text("conditions"),
  checklist: text("checklist"),
  notes: text("notes"),
  confidenceLevel: integer("confidence_level"),
  screenshotUrl: text("screenshot_url"),
  screenshotNotes: text("screenshot_notes"),
  tags: text("tags"),
  sourceType: text("source_type"),
  sourceId: integer("source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("playbook_created_at_idx").on(table.createdAt),
  index("playbook_folder_idx").on(table.folder),
]);

export const insertPlaybookSchema = createInsertSchema(playbookTable).omit({ id: true, createdAt: true, deletedAt: true });
export type InsertPlaybook = z.infer<typeof insertPlaybookSchema>;
export type PlaybookEntry = typeof playbookTable.$inferSelect;
