/**
 * The ONLY registry of tick steps, run in this order by tick/runner.ts. RISK-LIVE / ACCURACY add their step with a
 * one-line import + one array entry (re-read this file right before editing). Keep "fills.recent" first (fresh trades
 * feed everything else) and "backfill.history" last (it spends whatever time is left).
 */
import type { TickStep } from "./types";
import { fillsRecentStep } from "./fillsStep";
import { positionsStep } from "../steps/positions";
import { backfillStep } from "./backfill";
import { accountsStep, adjustmentsStep, reconcileStep } from "../steps/accuracy";

export const TICK_STEPS: TickStep[] = [
  fillsRecentStep,
  positionsStep,
  accountsStep, adjustmentsStep, reconcileStep,
  backfillStep,
];
