/**
 * The one file the owner edits before launch (README.md "Before launch").
 *
 *   - Values in double curly braces are placeholders. A section whose numbers are still placeholders is left out of the
 *     build (set PUBLIC_SHOW_PLACEHOLDERS=1 to preview it with the raw placeholders). `pnpm run build` lists what is
 *     still unfilled.
 *   - Aggregates only: desk-wide totals. Never a trader's name, account or individual result.
 */

/** Search engines: noindex on every page and robots.txt "Disallow: /" until LANDING_INDEXABLE=1 at build time. */
export const NOINDEX = process.env.LANDING_INDEXABLE !== "1";

/** Show unfilled placeholders instead of hiding their section (local preview only). */
export const SHOW_PLACEHOLDERS = import.meta.env.PUBLIC_SHOW_PLACEHOLDERS === "1";

/** Where the lead form posts: "" = same origin (Caddy proxies /api/leads to the API, docs/DEPLOY.md). */
export const LEADS_API_BASE = String(import.meta.env.PUBLIC_LEADS_API_BASE ?? "").replace(/\/+$/, "");

/** Umami analytics: the script tag is added only when both are set at build time. */
export const UMAMI = {
  url: String(import.meta.env.PUBLIC_UMAMI_URL ?? "").replace(/\/+$/, ""),
  id: String(import.meta.env.PUBLIC_UMAMI_ID ?? ""),
};

export const BRAND = "WS_DeskOS";

/** Legal identity used by Terms / Privacy / Refund (drafts). */
export const LEGAL = {
  entity: "{{LEGAL_ENTITY}}",
  address: "{{LEGAL_ADDRESS}}",
  jurisdiction: "{{JURISDICTION}}",
  contactEmail: "{{CONTACT_EMAIL}}",
  effectiveDate: "{{EFFECTIVE_DATE}}",
};

/**
 * Real desk aggregates for the numbers band. Fill all four (formatted as they should read, e.g. "$48,200") or the
 * band stays hidden. Period: say which one in `period` (e.g. "since June 2026").
 */
export const NUMBERS = {
  savedUsd: "{{SAVED_USD}}",
  alertsFired: "{{ALERTS_FIRED}}",
  tradersOnDesk: "{{TRADERS_ON_DESK}}",
  sessionsTracked: "{{SESSIONS_TRACKED}}",
  period: "{{NUMBERS_PERIOD}}",
};

/**
 * Product screenshots (README.md "Screenshots"): public/screens/<name>.webp (1600x1000) plus <name>-800.webp
 * (800x500), captured from the synthetic demo desk only. `hero: true` slots fill the hero's card column; every slot can
 * be the picture of an explorer group (content/features.ts `screen`). A slot whose file is missing is not shown
 * (placeholder frames appear only with PUBLIC_SHOW_PLACEHOLDERS=1).
 */
export const SCREENS = [
  { id: "risk", name: "live-risk", hero: true },
  { id: "day", name: "trader-day", hero: true },
  { id: "academy", name: "academy", hero: true },
  { id: "analytics", name: "analytics", hero: true },
  { id: "plan", name: "plan", hero: false },
  { id: "journal", name: "journal", hero: false },
  { id: "whatif", name: "what-if", hero: false },
  { id: "themes", name: "themes", hero: false },
  { id: "ideas", name: "ideas", hero: false },
  { id: "curator", name: "curator", hero: false },
  { id: "everywhere", name: "everywhere", hero: false },
] as const;
export type ScreenId = (typeof SCREENS)[number]["id"];

export const isPlaceholder = (v: string): boolean => /^\{\{[A-Z_]+\}\}$/.test(v.trim());
