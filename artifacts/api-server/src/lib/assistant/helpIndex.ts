/**
 * search_help — «где посмотреть X»: the site map the assistant navigates by (pure, English; the model answers in the
 * user's language). Paths are the web routes (edge-tracker src/App.tsx, components/shell/nav.ts). `staff` = curator /
 * admin screens; `admin` = admin only. Keep in step when a section is added or renamed.
 */

export type HelpEntry = { path: string; title: string; about: string; keywords: string; staff?: true; admin?: true };

export const HELP_INDEX: readonly HelpEntry[] = [
  { path: "/", title: "Dashboard", about: "Today at a glance: P&L, daily loss limit bar, the daily loop (plan, trades, close the day, review), quests, focus of the day.", keywords: "home main today summary pnl limit loop quests focus" },
  { path: "/trades", title: "Trades", about: "The trade book synced from PropReports. Filters (date, ticker, setup, side, outcome, strategy), trade sheet with chart, executions, R, MAE/MFE, markup (setup, tags, grade, notes).", keywords: "trades book list journal executions fills chart setup tag grade notes mae mfe ticker" },
  { path: "/stats", title: "Statistics", about: "KPIs and breakdowns: win rate, expectancy R, profit factor, net $, by setup, strategy, ticker, hour, weekday; calendar and equity.", keywords: "statistics stats kpi winrate expectancy profit factor breakdown calendar equity weekday hour" },
  { path: "/analytics", title: "Analytics", about: "Deep analytics: overview, edge matrix, edge by market, Monte Carlo, psychology, desk tab for staff.", keywords: "analytics edge matrix monte carlo psychology distribution drawdown" },
  { path: "/behavior", title: "Behaviour", about: "Costly behaviour patterns (revenge, overtrading, giving back profit, tilt) with $ cost, best and worst hours and setups, discipline trend.", keywords: "behaviour behavior patterns revenge overtrading tilt habits cost discipline" },
  { path: "/day-report", title: "Day report", about: "Deterministic report of one trading day: trades, timing, limit use, mistakes, what to repeat. ?date=YYYY-MM-DD.", keywords: "day report daily review session mistakes timing limit" },
  { path: "/what-if", title: "What-if", about: "Simulate rules on past trades (daily loss limit, max trades, stop after losses, time window, exclude tickers or setups, cap loss, commission plan); honest walk-forward verdicts; fee optimizer.", keywords: "what if whatif simulate rules scenario commission fees optimizer backtest" },
  { path: "/playbook", title: "Playbook", about: "Setups: office, personal, shared; each with context, trigger, entry, stop, targets, management, invalidation, checklist, example trades; tier locks by stage.", keywords: "playbook setups strategy checklist examples entry stop target invalidation" },
  { path: "/game-plan", title: "Plan of the day", about: "Desk morning plan (staff publish) and the personal plan: market view, focus, in-play tickers with scenarios, max loss, max trades, rule of the day.", keywords: "plan game plan morning premarket focus in play max loss rule of the day" },
  { path: "/journal", title: "Journal", about: "Daily journal: plan, what went well, mistakes, lessons, mood, discipline, tags.", keywords: "journal diary notes lessons mood discipline" },
  { path: "/my-review", title: "My review", about: "The trader's own review page: curator scores and comments on closed days, progress.", keywords: "my review curator comments score feedback" },
  { path: "/weekly-review", title: "Weekly review", about: "Weekly self-assessment and the 1:1 with the curator; weekly goals.", keywords: "weekly review week goals one on one 1:1" },
  { path: "/rules", title: "Rules", about: "Personal and desk rules with automatic violation detection, rule report and discipline.", keywords: "rules violations discipline limits contract" },
  { path: "/risk", title: "Risk", about: "Risk profile: limits, today's P&L against the daily loss limit, drawdown, open risk, positions, alerts.", keywords: "risk limits drawdown daily loss open positions alerts buying power" },
  { path: "/scaling", title: "Scaling", about: "Tier ladder: size tiers, evaluation and promotion of a trader's tier.", keywords: "scaling tiers size ladder promotion" },
  { path: "/academy/path", title: "Academy path", about: "Ladder Junior → Trader → Senior: criteria, readiness report, promotion request.", keywords: "academy path ladder junior trader senior promotion criteria readiness stage" },
  { path: "/academy/learn", title: "Academy lessons", about: "Programs, lessons, quizzes and assignments.", keywords: "academy learn lessons course quiz assignment" },
  { path: "/academy/my", title: "My academy", about: "The trader's own academy progress, goals and action items.", keywords: "academy my progress goals idp" },
  { path: "/academy/challenges", title: "Challenges", about: "Academy challenges and their progress.", keywords: "challenges academy contest" },
  { path: "/trainer", title: "Trainer", about: "Replay drills: find the entry, task of the day, simulator with fills.", keywords: "trainer replay drill simulator practice find entry task of the day" },
  { path: "/ask", title: "Ask the journal", about: "Quick questions over the trade book without AI (client-side engine).", keywords: "ask journal question query book" },
  { path: "/events", title: "Catalysts", about: "Events and catalysts (earnings, news) by ticker and day, and how the desk trades them.", keywords: "events catalysts earnings news day book" },
  { path: "/big7", title: "Big 7", about: "Big 7 tickers: levels, catalysts, context.", keywords: "big 7 big7 mega caps levels catalysts" },
  { path: "/themes", title: "Themes", about: "Market themes and their tickers.", keywords: "themes sectors market rotation" },
  { path: "/watchlist", title: "Watchlist", about: "Personal and desk watchlists.", keywords: "watchlist tickers list" },
  { path: "/offerings", title: "Offerings", about: "Secondary offerings and dilution events.", keywords: "offerings dilution secondary atm" },
  { path: "/calculator", title: "Calculator", about: "Position size and risk calculator.", keywords: "calculator position size risk shares stop" },
  { path: "/top-results", title: "Top of the day", about: "Best results of the day on the desk (anonymised for traders).", keywords: "top results leaderboard best day" },
  { path: "/discussions", title: "Discussions", about: "Desk discussion threads.", keywords: "discussions forum threads comments" },
  { path: "/trade-ideas", title: "Trade ideas", about: "Published trade ideas and their tracking.", keywords: "ideas trade ideas publish" },
  { path: "/dailyfeed", title: "Daily feed", about: "Daily desk feed: summaries of the day.", keywords: "feed daily summary desk" },
  { path: "/notifications", title: "Notifications", about: "All notifications.", keywords: "notifications alerts inbox" },
  { path: "/settings", title: "Settings", about: "Profile, language, security (quick-unlock code, auto-lock), Telegram link, appearance.", keywords: "settings profile language password security telegram appearance theme" },
  { path: "/curator", title: "Curator", about: "Curator console: queue of closed days to review, attention list, notes per trader.", keywords: "curator queue review closed days notes attention", staff: true },
  { path: "/office", title: "Office stats", about: "Desk-wide statistics by strategy and trader.", keywords: "office desk stats strategies", staff: true },
  { path: "/benchmark", title: "Benchmark", about: "Compare traders and groups.", keywords: "benchmark compare traders", staff: true },
  { path: "/academy/mentor", title: "Mentor", about: "Mentor view: students, submissions to grade.", keywords: "mentor students grade submissions", staff: true },
  { path: "/academy/cohorts", title: "Cohorts", about: "Academy cohorts, sessions and 1:1s.", keywords: "cohorts sessions academy", staff: true },
  { path: "/admin", title: "Admin", about: "Admin console: people, roles and rights (capabilities, stage access), desk settings (including WS Assistant: on/off, models, budgets), usage, errors, audit, jobs.", keywords: "admin console people roles rights permissions settings desk settings assistant usage errors audit", admin: true },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);

/** Best matches for `query` (English keywords) among the entries this viewer may open. */
export function searchHelp(query: string, viewer: { staff: boolean; admin: boolean }, limit = 5): HelpEntry[] {
  const words = norm(query);
  const visible = HELP_INDEX.filter((e) => (!e.staff || viewer.staff) && (!e.admin || viewer.admin));
  if (!words.length) return visible.slice(0, limit);
  const scored = visible.map((e) => {
    const hay = norm(`${e.title} ${e.keywords} ${e.about} ${e.path}`);
    let score = 0;
    for (const w of words) for (const h of hay) if (h === w) score += 3; else if (h.startsWith(w) || w.startsWith(h)) score += 1;
    return { e, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.e);
}
