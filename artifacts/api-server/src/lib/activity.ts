import { db, activityLogTable } from "@workspace/db";
import { logger } from "./logger";

export async function logActivity(params: {
  action: string;
  section: string;
  entityId?: string;
  entityTitle?: string;
  trader?: string;
  details?: string;
}) {
  try {
    await db.insert(activityLogTable).values({
      action: params.action,
      section: params.section,
      entityId: params.entityId ?? null,
      entityTitle: params.entityTitle ?? null,
      trader: params.trader ?? null,
      details: params.details ?? null,
    });
  } catch (e: any) {
    logger.warn({ error: e.message }, "Failed to log activity");
  }
}
