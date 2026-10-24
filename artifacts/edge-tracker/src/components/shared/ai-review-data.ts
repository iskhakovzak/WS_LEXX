/**
 * AI reviews (api-server routes/aireview.ts): the stored review of a trade / a day (GET, no model call) and «Review»
 * (POST: the same inputs come back from the server's cache for free; force = a fresh one). The DTO never names a
 * model: `tier` is "deep" when the advisor took part.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { encodeRules, type Rule } from "./what-if-rules";

export type Evidence = { kind: "fill" | "minute" | "stat" | "rule" | "edge" | "chart"; label: string; at: string | null; ref: number | null };
export type ReviewPoint = { text: string; basis: "fact" | "hypothesis"; evidence: Evidence[] };
export type Review = {
  verdict: { grade: "A" | "B" | "C" | "D" | "F"; headline: string; followedPlan: "yes" | "partly" | "no" | "unknown" };
  wentWell: ReviewPoint[];
  wentWrong: ReviewPoint[];
  edge: { text: string; interval: string | null } | null;
  tomorrow: { if: string; then: string };
  whatIf: { why: string } | null;
  confidence: "low" | "medium" | "high";
  dataGaps: string[];
};
export type DayFacts = {
  trades: number; net: number | null;
  afterLoss: { n: number; net: number }; afterWin: { n: number; net: number };
  afterPeak: { n: number; net: number; giveback: number; peak: number | null; peakTime: string | null };
  firstThree: { n: number; net: number }; rest: { n: number; net: number };
  overlaps: number; quickReentries: number;
};
export type ReviewDto = {
  id: number; kind: "trade" | "day" | "week" | "month"; trader: string; tradeId: number | null; day: string | null;
  review: Review; facts: DayFacts | null; tier: "standard" | "deep"; units: number;
  whatIfRule: Record<string, unknown> | null; createdAt: string; cached: boolean;
};

/**
 * Week / month reviews are written by the nightly batch only (GET /api/ai/period-review: the one covering `date`);
 * there is no «Review» button for them.
 */
export type ReviewSubject =
  | { kind: "trade"; tradeId: number }
  | { kind: "day"; date: string; trader?: string | null }
  | { kind: "week" | "month"; date: string; trader?: string | null };

export const isPeriodSubject = (s: ReviewSubject): s is Extract<ReviewSubject, { kind: "week" | "month" }> => s.kind === "week" || s.kind === "month";

const key = (s: ReviewSubject) => (s.kind === "trade" ? ["ai-review", "trade", s.tradeId] as const : ["ai-review", s.kind, s.date, s.trader ?? ""] as const);

export const reviewQuery = (s: ReviewSubject) => queryOptions({
  queryKey: key(s),
  queryFn: () => (s.kind === "trade"
    ? http.get<ReviewDto | null>(`/api/trades/${s.tradeId}/ai-review`)
    : s.kind === "day"
      ? http.get<ReviewDto | null>("/api/ai/day-review", { query: { date: s.date, trader: s.trader ?? null } })
      : http.get<ReviewDto | null>("/api/ai/period-review", { query: { kind: s.kind, date: s.date, trader: s.trader ?? null } })),
  staleTime: STALE.static,
  meta: { i18n: false },
});

/** Title / focus keys (assistant namespace) of a review kind. */
export const TITLE_KEY = { trade: "review.title", day: "review.dayTitle", week: "review.weekTitle", month: "review.monthTitle" } as const;
export const FOCUS_KEY = { trade: "review.tomorrow", day: "review.tomorrowDay", week: "review.nextWeek", month: "review.nextMonth" } as const;

export function useAiReview(s: ReviewSubject, enabled = true) {
  const qc = useQueryClient();
  const q = useQuery({ ...reviewQuery(s), enabled });
  const run = useMutation({
    mutationFn: (force: boolean) => {
      if (isPeriodSubject(s)) return Promise.reject(new Error("period reviews are prepared overnight"));
      return s.kind === "trade"
        ? http.post<ReviewDto>(`/api/trades/${s.tradeId}/ai-review`, { force })
        : http.post<ReviewDto>("/api/ai/day-review", { date: s.date, ...(s.trader ? { trader: s.trader } : {}), force });
    },
    onSuccess: (data) => {
      qc.setQueryData(key(s), data);
      void qc.invalidateQueries({ queryKey: ["assistant", "status"] }); // the budget meter moves
    },
  });
  return { review: q.data ?? null, loading: q.isLoading, loadError: q.error, refetch: q.refetch, run };
}

/** The «What if» link of a review's rule (the simulator reads `r` from the URL), or null. */
export function whatIfHref(rule: Record<string, unknown> | null): string | null {
  if (!rule || typeof rule.type !== "string") return null;
  const r = encodeRules([rule as unknown as Rule]);
  return r ? `/what-if?r=${r}` : null;
}

/** Plain-text copy of a review (clipboard). */
export function reviewText(d: ReviewDto, t: (k: string, p?: Record<string, string | number>) => string): string {
  const r = d.review;
  const out = [`${t(TITLE_KEY[d.kind])} · ${t("review.grade", { grade: r.verdict.grade })}`, r.verdict.headline];
  const block = (title: string, pts: ReviewPoint[]) => {
    if (!pts.length) return;
    out.push("", `${title}:`, ...pts.map((p) => `• ${p.text}${p.basis === "hypothesis" ? ` (${t("review.basis.hypothesis")})` : ""}${p.evidence.length ? ` — ${p.evidence.map((e) => e.label).join("; ")}` : ""}`));
  };
  block(t("review.wentWell"), r.wentWell);
  block(t("review.wentWrong"), r.wentWrong);
  if (r.edge) out.push("", `${t("review.edge")}: ${r.edge.text}${r.edge.interval ? ` (${r.edge.interval})` : ""}`);
  out.push("", `${t(FOCUS_KEY[d.kind])}: ${t("review.if")} ${clause(r.tomorrow.if)} — ${t("review.then")} ${clause(r.tomorrow.then)}`);
  return out.join("\n");
}

/** «If Before any entry» → «If before any entry»: the clause follows the word, so a capitalised first word (not an acronym or ticker) is lowered. */
export function clause(s: string): string {
  return /^\p{Lu}\p{Ll}/u.test(s) ? s[0]!.toLocaleLowerCase() + s.slice(1) : s;
}
