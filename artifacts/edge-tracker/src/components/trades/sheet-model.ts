/**
 * Small pure helpers of the trade sheet and the review list (split out of trade-utils.ts): an estimated broker stop,
 * the fees share of gross, the linked playbook setup and the open / closed state of the sheet's sections.
 */
import type { Trade } from "@workspace/api-client-react";
import { fmtRate } from "@/lib/format";
import { isBrokerTrade } from "./trade-utils";

/**
 * The stored stop is a guess, not the trader's: a broker trade whose stop equals its exit price (the import fills the
 * stop from the exit when none was sent), so its R is −1R / +1R by construction (MAKSIM-25). Shown as «оценка».
 */
export function stopIsEstimate(t: Pick<Trade, "source" | "stop" | "exit">): boolean {
  if (!isBrokerTrade(t) || t.stop == null || t.exit == null) return false;
  const stop = Number(t.stop), exit = Number(t.exit);
  return Number.isFinite(stop) && Number.isFinite(exit) && stop > 0 && Math.abs(stop - exit) < 1e-6;
}

/** Fees as a share of gross: null without a positive gross; above 100 % it reads «>100%» (gross near 0 gave «1,609%»). */
export function feeShareText(fees: number | null | undefined, gross: number | null | undefined): { text: string; share: number } | null {
  if (fees == null || gross == null || !(gross > 0) || !(fees > 0)) return null;
  const share = fees / gross;
  return { share, text: share > 1 ? `>${fmtRate(1)}` : fmtRate(share) };
}

/** Playbook setup id the trade is linked to (`playbook_id`), when the API sends it. */
export function linkedPlaybookId(trade: Trade): number | null {
  const v = (trade as Trade & { playbookId?: number | string | null }).playbookId;
  const n = v == null ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Collapsible blocks of the trade sheet below the hero («ai» sits inside «review»). */
export const SHEET_SECTIONS = ["executions", "review", "ai", "notes", "context", "related"] as const;
export type SheetSection = (typeof SHEET_SECTIONS)[number];
/** Open / closed per section as the viewer last left it (localStorage, per user). */
export type SectionPrefs = Partial<Record<SheetSection, boolean>>;

/** What the open trade has, for the default state of its sections. */
export type SectionContext = {
  /** The viewer reviews this trade and it is still «Без разбора» (review-presets isUnreviewed). */
  awaitingReview: boolean;
  /** Review text, a grade, mistakes or curator reviews. */
  reviewHasContent: boolean;
  /** Notes or screenshots. */
  notesHasContent: boolean;
};

/**
 * Whether a section is open: the viewer's click on this trade wins; a trade awaiting review always opens «Разбор»;
 * otherwise the remembered state; otherwise the default (review / notes open when they have content).
 */
export function sectionOpen(s: SheetSection, prefs: SectionPrefs, override: boolean | undefined, ctx: SectionContext): boolean {
  if (override !== undefined) return override;
  if (s === "review" && ctx.awaitingReview) return true;
  const pref = prefs[s];
  if (pref !== undefined) return pref;
  if (s === "review") return ctx.reviewHasContent;
  if (s === "notes") return ctx.notesHasContent;
  return false;
}

/** Stored prefs are user data: keep only known sections with boolean values. */
export function parseSectionPrefs(raw: string | null): SectionPrefs {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: SectionPrefs = {};
    for (const s of SHEET_SECTIONS) {
      const b = (v as Record<string, unknown>)[s];
      if (typeof b === "boolean") out[s] = b;
    }
    return out;
  } catch {
    return {};
  }
}

const blank = (v: string | null | undefined) => !v || !v.trim();

/** «Разбор» has something to read: review text, a grade, mistakes or curator reviews. */
export function reviewHasContent(
  t: Pick<Trade, "whatWorked" | "whatFailed" | "conclusion" | "confidenceGrade">, mistakes: number, curatorReviews: number,
): boolean {
  return !blank(t.whatWorked) || !blank(t.whatFailed) || !blank(t.conclusion) || !blank(t.confidenceGrade) || mistakes > 0 || curatorReviews > 0;
}

/** «Заметки» has something to read: notes text or screenshots. */
export function notesHasContent(t: Pick<Trade, "notes" | "screenshotUrl">): boolean {
  return !blank(t.notes) || !blank(t.screenshotUrl);
}
