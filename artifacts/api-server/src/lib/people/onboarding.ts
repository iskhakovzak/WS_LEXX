/**
 * First-visit onboarding (edge-tracker lib/onboarding): the stored «seen / dismissed» block and the «new user» rule.
 *
 * Stored per user in `users.settings.onboarding` (PUT /users/me/settings { onboarding }) — the web mirrors this schema in
 * lib/onboarding/model.ts. Hint and «seen» ids are short slugs, not an enum, so a newer client never gets a 400 from an
 * older server; at most 32 of each.
 *
 * The rule (GET /users/me/onboarding → stage), decided here so every device agrees:
 *   new       no closed day yet (journal «Закрыть день» or the evening card reviewed), fewer than NEW_MAX_ACTIVE_DAYS days
 *             with any activity (a traded day or a day the app was used), and the account is younger than
 *             NEW_MAX_ACCOUNT_DAYS → guided tour, «Первые шаги» checklist, page hints on first open.
 *   settling  fewer than SETTLING_MAX_CLOSED closed days and fewer than SETTLING_MAX_ACTIVE_DAYS active days → page
 *             hints on the first open of a complex page only (no tour, no checklist).
 *   settled   everyone else → nothing automatic; the «?» buttons and «Помощь» still open everything.
 * The account-age cap keeps an old account that predates usage tracking (staff who never trade, a dormant login) out
 * of the tour; an admin brings the tour back for one person with «Сбросить знакомство» (sets `again`).
 */
import { z } from "zod";

export const NEW_MAX_ACTIVE_DAYS = 5;
export const NEW_MAX_ACCOUNT_DAYS = 45;
export const SETTLING_MAX_ACTIVE_DAYS = 20;
export const SETTLING_MAX_CLOSED = 10;

const slug = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/);

export const OnboardingStateSchema = z.object({
  v: z.literal(1),
  /** The guided tour: finished («done») or left early («skipped»). Absent = not taken yet. */
  tour: z.enum(["done", "skipped"]).optional(),
  tourAt: z.string().max(40).optional(),
  /** «Первые шаги»: every step done, or hidden by the person. */
  checklist: z.enum(["done", "dismissed"]).optional(),
  /** Page hints already shown and closed (once per page per user). */
  hints: z.array(slug).max(32).optional(),
  /** Things noticed on the way (the first trade card opened, the playbook read) — checklist signals with no table. */
  seen: z.array(slug).max(32).optional(),
  /** Set by an admin («Сбросить знакомство»): show the tour and the checklist again whatever the stage. */
  again: z.boolean().optional(),
});

export type OnboardingState = z.infer<typeof OnboardingStateSchema>;
export type OnboardingStage = "new" | "settling" | "settled";

export type StageInput = {
  guest: boolean;
  /** Distinct trading days closed (journal or evening card). */
  closedDays: number;
  /** Distinct NY days with a trade or any use of the app. */
  activeDays: number;
  /** Whole days since the account was created. */
  accountDays: number;
};

export function onboardingStage(i: StageInput): OnboardingStage {
  if (i.guest) return "settled";
  if (i.closedDays === 0 && i.activeDays < NEW_MAX_ACTIVE_DAYS && i.accountDays < NEW_MAX_ACCOUNT_DAYS) return "new";
  if (i.closedDays < SETTLING_MAX_CLOSED && i.activeDays < SETTLING_MAX_ACTIVE_DAYS) return "settling";
  return "settled";
}

/** What an admin reset leaves: the tour and checklist come back, hints show again; what the person already did stays. */
export function resetState(prev: unknown): OnboardingState {
  const parsed = OnboardingStateSchema.safeParse(prev);
  const seen = parsed.success ? parsed.data.seen : undefined;
  return { v: 1, again: true, ...(seen?.length ? { seen } : {}) };
}
