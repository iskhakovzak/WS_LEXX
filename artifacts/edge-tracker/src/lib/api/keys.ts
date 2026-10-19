/**
 * Query-key registry and freshness constants (ARCHITECTURE.md §1 rules 3 and 5).
 *
 *   useQuery({ queryKey: KEYS.tradeIdeas(), queryFn, staleTime: STALE.short, refetchInterval: POLL.minute })
 *
 * Phase E turns these into `queryOptions` factories with `meta.deps`; until then: no new magic numbers, and an
 * endpoint used by two features gets ONE key here (see lib/api/queries.ts).
 */

/** How long fetched data counts as fresh. */
export const STALE = {
  /** Prices, positions, live desk numbers. */
  live: 15_000,
  /** QueryClient default (App.tsx). */
  default: 30_000,
  /** Lists people edit during the day (trades, ideas, notes). */
  short: 60_000,
  /** Slow-moving data (stats, plans, reference lists). */
  long: 5 * 60_000,
  /** Static-ish data (settings, catalogs, content). */
  static: 30 * 60_000,
  /** Data that changes once a day or less (fundamentals, history). */
  day: 6 * 60 * 60_000,
} as const;

/** Polling intervals for `refetchInterval`. */
export const POLL = {
  /** Live quotes / sync progress. */
  live: 15_000,
  minute: 60_000,
  twoMinutes: 120_000,
  fiveMinutes: 5 * 60_000,
} as const;

/** Keys of queries shared by several features (one endpoint ⇒ one key). */
export const KEYS = {
  /** GET /api/trades?result=open — analyst open positions, offerings exposure. Trade-derived. */
  openTrades: () => ["/api/trades", "open"] as const,
  /** GET /api/trade-ideas — idea pages, ratings, global search. */
  tradeIdeas: () => ["trade-ideas"] as const,
  /** GET /api/watchlist — watchlist page, analyst, offerings, catalysts, quick add. */
  watchlist: () => ["watchlist"] as const,
  /** GET /api/risk/me?date= — dashboard, risk page, shell badge. Starts with ["risk", "me"] (riskKeys.me) so old invalidations match. */
  riskMe: (date: string) => ["risk", "me", date] as const,
  /** GET /api/daily/me — dashboard day line, personal plan (rule-of-the-day prefill). Trade-derived ("daily"). */
  dailyMe: (date: string) => ["daily", "me", date] as const,
  /** GET /api/game-plan/my?date= — personal plan editor (gpKeys.my) and the dashboard contract line. */
  myPlan: (date: string) => ["game-plan", "my", date] as const,
  /** GET /api/quests/me — dashboard quest strip, «Квесты и достижения» tab. Actions that move a quest (review, plan,
   * game-plan read, own-day replay) mark it stale from their own feature (quests/api questKeys.me is this key). */
  questsMe: () => ["quests", "me"] as const,
  /** GET /api/playbook/today — playbook «Сегодня», the quick sheet, the dashboard day row, the personal plan, the evening
   * card («Разметь N сделок»). PUT /api/playbook/today/picks writes the picks back into this entry. */
  playbookToday: (trader?: string | null) => ["playbook-today", trader ?? null] as const,
  /** GET /api/gamification/me[?trader=] — rewards chip (season bar, freeze), «Квесты и достижения» (titles, mastery,
   * rewards), «Сезон» tab. Starts with ["gamification"] so gamification mutations invalidate it. */
  gamificationMe: (trader?: string | null) => ["gamification", "me", trader ?? null] as const,
} as const;
