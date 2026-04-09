import { Router, type IRouter } from "express";
import { seedDatabase } from "../lib/seed";
import { logger } from "../lib/logger";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.post("/admin/seed", asyncHandler(async (req, res): Promise<void> => {
  logger.info("Seeding database via admin endpoint...");
  await seedDatabase();
  res.json({ message: "Database seeding completed" });
}));

export default router;
