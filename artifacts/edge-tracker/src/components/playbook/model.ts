/**
 * Playbook page model: types, constants and pure helpers shared by components/playbook/*.
 * No React here.
 */
import type { Tone } from "@/components/ds";
import type { ChecklistItem } from "@/components/playbook-checklist-marks";
import {
  stringToScreenshotUrls,
  stringToScreenshotNotes,
  screenshotUrlsToString,
  screenshotNotesToString,
} from "@/components/screenshot-fields";

export type PlaybookEntry = {
  id: number; name: string; folder: string | null; setupType: string | null; conditions: string | null;
  checklist: string | null; checklistItems: ChecklistItem[] | null; notes: string | null; confidenceLevel: number | null;
  screenshotUrl: string | null; screenshotNotes: string | null; tags: string | null;
  sourceType: string | null; sourceId: number | null; createdAt: string;
  parentId: number | null;
  ticker: string | null;
  marketCap: string | null; float: string | null; adv: string | null;
  atr: number | null; relativeVolume: number | null; beta: number | null;
  shortInterest: number | null; sector: string | null; longName: string | null;
  reviewed: boolean; reviewedBy: string | null; reviewedAt: string | null;
  trader?: string | null;
  /* ---- spaces (optional: older API builds don't send them; see accessOf) ---- */
  space?: Space | null;
  visibility?: Visibility | null;
  sharedWith?: { users?: string[]; cohorts?: number[] } | null;
  sharedAt?: string | null; sharedBy?: string | null; createdBy?: string | null;
  copiedFromId?: number | null; copiedFromAuthor?: string | null; promotedFromId?: number | null;
  officeProposedAt?: string | null; officeProposedBy?: string | null; officeProposedNote?: string | null;
  /* ---- structured card ---- */
  contextText?: string | null; triggerText?: string | null; entryText?: string | null; stopText?: string | null;
  targetsText?: string | null; managementText?: string | null; invalidationText?: string | null;
  idealConditions?: string | null; timeOfDay?: string | null; horizon?: string | null;
  media?: SetupMedia[] | null;
  updatedAt?: string | null;
  /** Server-computed permissions for the viewer (new API); read through `accessOf()`. */
  access?: SetupAccess;
};

export type Space = "office" | "personal";
export type Visibility = "private" | "all" | "custom";
export type SetupMedia = { id: number; note?: string };
export type SetupAccess = {
  space: Space; shared: boolean; mine: boolean; canEdit: boolean; canShare: boolean; canPromote: boolean; canAddExamples: boolean;
};

/** Viewer as far as the client knows it (role-based fallback when the API is older). */
export type ViewerLike = { name: string | null; canEdit: boolean; isCurator: boolean; isSenior?: boolean };

export function spaceOf(e: Pick<PlaybookEntry, "space" | "trader">): Space {
  if (e.space === "office" || e.space === "personal") return e.space;
  return e.trader ? "personal" : "office";
}
export function isSharedEntry(e: Pick<PlaybookEntry, "space" | "trader" | "visibility" | "sharedWith">): boolean {
  if (spaceOf(e) !== "personal") return false;
  if (e.visibility === "all") return true;
  if (e.visibility === "custom") return (e.sharedWith?.users?.length ?? 0) + (e.sharedWith?.cohorts?.length ?? 0) > 0;
  return false;
}

/** Permissions for one setup: server `access` when present, otherwise the same rules derived client-side. */
export function accessOf(e: PlaybookEntry, v: ViewerLike): SetupAccess {
  if (e.access) return e.access;
  const space = spaceOf(e);
  const mine = space === "personal" && !!v.name && e.trader === v.name;
  const canEdit = space === "office" ? v.isCurator : mine ? v.canEdit : v.isCurator;
  return {
    space, shared: isSharedEntry(e), mine, canEdit,
    canShare: space === "personal" && mine && (v.isCurator || !!v.isSenior),
    canPromote: v.isCurator && space === "personal",
    canAddExamples: canEdit || (space === "office" && v.canEdit),
  };
}

/** Sidebar list a setup belongs to for this viewer. */
export type SpaceTab = "office" | "mine" | "shared" | "team";
export function spaceTabOf(e: PlaybookEntry, v: ViewerLike): SpaceTab {
  const a = accessOf(e, v);
  if (a.space === "office") return "office";
  if (a.mine) return "mine";
  if (a.shared) return "shared";
  return "team";
}

/* ---------- examples (playbook_examples) ---------- */

export type Tier = 1 | 2 | 3;
export const TIERS: { tier: Tier; label: string; short: string; hint: string; tone: Tone }[] = [
  { tier: 1, label: "Tier 1 · Эталон", short: "T1", hint: "Показательная: всё по плану — так и надо", tone: "up" },
  { tier: 2, label: "Tier 2 · Хорошая", short: "T2", hint: "По сетапу, но с отклонениями", tone: "accent" },
  { tier: 3, label: "Tier 3 · На разбор", short: "T3", hint: "Учебная ошибка: что пошло не так, чего не повторять", tone: "down" },
];
export const tierMeta = (t: number) => TIERS.find((x) => x.tier === t) ?? TIERS[1];

export type SetupExample = {
  id: number; playbookId: number; tradeId: number; tier: Tier; note: string | null;
  checklistMarks: Record<string, boolean> | null; mediaId: number | null; sortOrder: number;
  addedBy: string | null; createdAt: string | null; updatedAt: string | null;
  ticker: string; date: string; closeDate: string | null; side: string | null; result: string | null;
  netPnl: number | null; pnl: number | null; fees: number | null; signedR: number | null; horizon: string | null;
  trader: string | null; qty: number | null; entry: number | null; exit: number | null;
  /** First entry / last exit fill (ISO), when executions are known. */
  entryTime?: string | null; exitTime?: string | null;
  /** Server hid the $ facts (net / pnl / fees / qty): someone else's trade and the viewer is not staff. */
  redacted?: boolean;
  /* gallery only */
  setupName?: string; setupFolder?: string | null; setupSpace?: Space; setupOwner?: string | null;
};

export type PickerTrade = {
  id: number; ticker: string; date: string; closeDate: string | null; side: string | null; result: string | null;
  netPnl: number | null; signedR: number | null; horizon: string | null; trader: string | null; setup: string | null;
  playbookId: number | null; playbookName: string | null; autoSetup: string | null; autoConfidence: number | null;
  inSetup: boolean; linkedHere: boolean; matchesSetup: boolean; autoMatch: boolean;
  /** $ hidden by the server (someone else's trade). */
  redacted?: boolean;
};

export type UsdStats = {
  n: number; wins: number; losses: number; winrate: number | null; net: number | null; expectancy: number | null;
  avgWin: number | null; avgLoss: number | null; payoff: number | null; profitFactor: number | null; best: number | null; worst: number | null;
};
export type SlotStat = UsdStats & { slot: string };
export type SetupStats = {
  trader: string | null; count: number; usd: UsdStats; recent: UsdStats;
  edge: { avgR: number | null; expectancy?: number | null; rCount: number; maxDrawdown: number | null; fees: number | null; profitFactor: number | null };
  slots: SlotStat[]; bestSlots: SlotStat[]; timeCoverage: number | null;
  /** Net $ by close day; empty when the $ are hidden (see `redacted`). */
  equity: { day: string; net: number; cum: number }[];
  /** Cumulative signed R by close day (always present on the current API). */
  equityR?: { day: string; r: number; cum: number }[];
  /** $ fields are null: the sample includes other traders' trades and the viewer is not staff. */
  redacted?: boolean;
  tickers: (UsdStats & { ticker: string })[];
  byHorizon: Record<string, UsdStats>;
  traders: (UsdStats & { trader: string })[] | null;
  firstDate: string | null; lastDate: string | null;
};

export const HORIZON_LABEL: Record<string, string> = { intraday: "Интрадей", overnight: "Овернайт", swing: "Свинг" };
export const TIME_OF_DAY_OPTIONS = ["Премаркет", "Открытие 9:30–10:00", "Утро 10:00–11:30", "Обед 11:30–14:00", "Закрытие 14:00–16:00", "Весь день"];

export type StructuredKey =
  | "contextText" | "triggerText" | "entryText" | "stopText" | "targetsText" | "managementText" | "invalidationText" | "idealConditions";
/** Structured card fields in display order. */
export const STRUCTURED: { key: StructuredKey; label: string; placeholder: string; tone: Tone }[] = [
  { key: "contextText", label: "Контекст", placeholder: "Рынок, катализатор, почему бумага в игре", tone: "accent" },
  { key: "triggerText", label: "Триггер", placeholder: "Что должно произойти, чтобы появилась точка входа", tone: "accent" },
  { key: "entryText", label: "Вход", placeholder: "Где и как входим, размер", tone: "up" },
  { key: "stopText", label: "Стоп", placeholder: "Где стоп и почему именно там", tone: "down" },
  { key: "targetsText", label: "Цели", placeholder: "Уровни частичной и полной фиксации", tone: "warn" },
  { key: "managementText", label: "Сопровождение", placeholder: "Перенос стопа, добор, частичные выходы", tone: "purple" },
  { key: "invalidationText", label: "Инвалидация", placeholder: "Когда идея сломана и сетап больше не валиден", tone: "down" },
  { key: "idealConditions", label: "Идеальные условия", placeholder: "Объём, RVOL, float, время, состояние рынка", tone: "neutral" },
];

export const fmtUsd = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
export const moneyTone = (v: number | null | undefined): Tone => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");
/** dd.MM (tables) from YYYY-MM-DD. */
export const ddmm = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : d ?? "—");

/** Row of GET /api/playbook/:id/trades (shared trade math applied server-side: signedR / netPnl). */
export type LinkedTrade = {
  id: number; ticker: string; date: string; side: string | null; result: string;
  /** Gross P&L. */
  pnl: number | null;
  fees?: number | null;
  /** Net P&L = gross − |fees| (null without P&L). */
  netPnl?: number | null;
  /** Raw stored R; prefer `signedR`. */
  rMultiple: number | null;
  /** Signed R from the shared trade math (sign follows result). */
  signedR?: number | null;
  entry?: number | null; exit?: number | null; stop?: number | null; qty?: number | null; riskUsd?: number | null;
  exitDate?: string | null; closeDate?: string | null;
  setup: string | null; trader: string | null; playbookId?: number | null;
  /** $ facts (pnl / fees / net / qty / risk $) hidden by the server: someone else's trade. */
  redacted?: boolean;
  /** 'intraday' | 'overnight' | 'swing'; null ⇒ intraday. */
  horizon?: string | null;
  source?: "propreports" | "manual" | null;
  brokerAccount?: string | null;
  setupScore?: number | null;
  createdAt?: string | null;
};

/** Per-horizon slice of a setup's edge (GET /api/playbook/summary). */
export type HorizonStat = { n: number; wins: number; losses: number; winrate: number | null; avgR: number | null; netPnl: number | null };

/** Row of GET /api/playbook/summary (per-setup aggregates). */
export type SetupSummary = {
  id: number;
  tradeCount: number; wins: number; losses: number; be: number; open: number; rCount: number; pnlCount: number;
  /** W / (W + L), break-even excluded. */
  winrate: number | null; avgR: number | null; expectancy: number | null; edgeScore: number | null;
  /** ΣR⁺ / |ΣR⁻|; null when there are no losing R (never ∞). */
  profitFactor: number | null;
  /** Σ net P&L (gross − |fees|). */
  netPnl: number | null;
  grossPnl: number | null;
  /** @deprecated same as netPnl */
  totalPnl: number | null;
  recentAvgR: number | null; recentRCount: number;
  /** Last 20 trades run clearly below the lifetime expectancy (needs ≥ 30 R). */
  edgeDecay: boolean;
  byHorizon: { intraday: HorizonStat; overnight: HorizonStat; swing: HorizonStat };
  reviewVerdict: "approved" | "needs_work" | "retired" | string | null;
  lastTradeDate: string | null; lastTradeAt: string | null; lastRunAt: string | null; lastUsedAt: string | null;
  exampleCount: number; childCount: number;
  /* new API ($-first; R stays optional) */
  expectancyUsd?: number | null; avgWinUsd?: number | null; avgLossUsd?: number | null; profitFactorUsd?: number | null;
  tier1Count?: number; ideaCount?: number;
  /** $ fields are null: linked trades include other traders' and the viewer is not staff. */
  redacted?: boolean;
};

export type FolderSetting = { folderName: string; colorIndex: number | null; sortOrder: number };

export type ActivityItem = {
  id: number; action: string; section: string; entityTitle?: string; trader?: string; details?: string; createdAt: string;
};

export type FormData = {
  name: string; folder: string; setupType: string; conditions: string; checklist: string;
  notes: string; confidenceLevel: string; screenshotUrls: string[]; screenshotNotes: string[]; tags: string;
  ticker: string; marketCap: string; float: string; adv: string;
  atr: string; relativeVolume: string; beta: string; shortInterest: string; sector: string; longName: string;
};

export const blankForm = (): FormData => ({
  name: "", folder: "", setupType: "", conditions: "", checklist: "", notes: "", confidenceLevel: "70",
  screenshotUrls: [""], screenshotNotes: [""], tags: "", ticker: "", marketCap: "", float: "", adv: "",
  atr: "", relativeVolume: "", beta: "", shortInterest: "", sector: "", longName: "",
});

export function entryToForm(e: PlaybookEntry): FormData {
  const urls = stringToScreenshotUrls(e.screenshotUrl);
  return {
    name: e.name, folder: e.folder ?? "", setupType: e.setupType ?? "", conditions: e.conditions ?? "",
    checklist: e.checklist ?? "", notes: e.notes ?? "",
    confidenceLevel: e.confidenceLevel != null ? String(e.confidenceLevel) : "70",
    screenshotUrls: urls, screenshotNotes: stringToScreenshotNotes(e.screenshotNotes, urls.length),
    tags: e.tags ?? "", ticker: e.ticker ?? "", marketCap: e.marketCap ?? "", float: e.float ?? "", adv: e.adv ?? "",
    atr: e.atr != null ? String(e.atr) : "", relativeVolume: e.relativeVolume != null ? String(e.relativeVolume) : "",
    beta: e.beta != null ? String(e.beta) : "", shortInterest: e.shortInterest != null ? String(e.shortInterest) : "",
    sector: e.sector ?? "", longName: e.longName ?? "",
  };
}

/** Request body for POST/PATCH /api/playbook from the form. */
export function formToBody(data: FormData, folder: string | null, trader: string) {
  const { screenshotUrls, screenshotNotes: sNotes, ticker, marketCap, float: floatVal, adv, atr, relativeVolume, beta, shortInterest, sector, longName, ...rest } = data;
  const num = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ...rest,
    folder: folder || null,
    confidenceLevel: num(data.confidenceLevel),
    screenshotUrl: screenshotUrlsToString(screenshotUrls) || null,
    screenshotNotes: screenshotNotesToString(sNotes) || null,
    trader,
    ticker: ticker ? ticker.toUpperCase() : null,
    marketCap: marketCap || null,
    float: floatVal || null,
    adv: adv || null,
    atr: num(atr),
    relativeVolume: num(relativeVolume),
    beta: num(beta),
    shortInterest: num(shortInterest),
    sector: sector || null,
    longName: longName || null,
  };
}

export const SETUP_GROUPS: { label: string; items: string[] }[] = [
  { label: "SMB Capital Core 20", items: ["Opening Drive", "Second Day Play", "Opening Consolidation", "Gap and Go", "Flag / Pennant", "Breakout Trade", "Explosive Move", "Flipping", "Fade Trade", "Stuffed Trade", "Bounce Trade", "Biotech Fade", "Support Play", "Pullback Trade", "2D VWAP Trade", "Relative Strength Trade", "Fundamental / Catalyst Trade", "IPO Trade", "IPO Day Trade", "Secondary Offering Trade", "Special Dividend Trade"] },
  { label: "SMB Advanced", items: ["Dr. S Trade", "Market Play", "Scalp Trade", "Opening Volatility Collapse", "Big Bid / Catalyst Trade", "ABCD Pattern"] },
  { label: "Gap plays", items: ["Gap", "Gap Up", "Gap Down", "Gap and Go Long", "Gap and Go Short", "Gap Fill", "Earnings Gap Up", "Earnings Gap Down", "Earnings Gap Down Short"] },
  { label: "Breakout / Continuation", items: ["Breakout", "Retest", "Trend Continuation", "Bull Flag", "Bear Flag", "ORB", "ORB 5min", "ORB 15min", "ORB 30min", "Narrow Range Break (NR7)", "Flat Top Breakout", "Cup and Handle"] },
  { label: "Momentum", items: ["Intraday Momentum", "Momentum Ignition", "Volume Pocket Pivot", "Parabolic Run", "Runner"] },
  { label: "Short setups", items: ["Short", "Parabolic Short", "HOD Failure", "Dead Cat Bounce", "Failed Follow Through", "Short Squeeze", "Overextended Short", "Blow-Off Top Short"] },
  { label: "Reversal", items: ["Reversal", "Red to Green", "Green to Red", "Reddog Reversal", "V-Bottom Reversal", "Double Bottom", "Double Top", "Hammer Capitulation Buy", "Key Reversal Day"] },
  { label: "Support / Resistance", items: ["Support", "Resistance", "Scalp"] },
  { label: "Mean Reversion / Stat Arb", items: ["Mean Reversion", "Pairs Trade", "ETF Arbitrage", "Relative Value"] },
  { label: "Auction / Order Flow / OPG / IMBX / MOC", items: ["OPG", "OPG Gap Fade", "OPG Momentum", "Imbalance", "Opening Imbalance (OPG)", "IMBX Long", "IMBX Short", "IMBX Fade", "IMBX + VWAP", "MOC", "MOC Imbalance", "MOC Fade", "MOC Pin Risk", "Closing Cross Play", "Liquidity Sweep", "Dark Pool Print"] },
  { label: "Prop Desk Specialty", items: ["Halt & Resume", "Sympathy Play", "Sector Rotation Play", "Earnings Drift (PEAD)", "Pre-Earnings Run", "Post-Earnings Continuation", "Basket Trade", "Hedged Swing", "Macro Play"] },
  { label: "Прочее", items: ["Другой"] },
];

export const SOURCE_LABELS: Record<string, string> = {
  trade: "Сделка", research: "Ресёрч", dailyfeed: "Дневная лента", event: "Событие", watchlist: "Вотчлист", trade_idea: "Идея",
};

/** Tone of a setup-type pill (direction/family at a glance). */
export function setupTone(type: string | null | undefined): Tone {
  if (!type) return "neutral";
  const t = type.toLowerCase();
  if (/short|fade|parabolic|hod fail|dead cat|blow-off|exhaustion/.test(t)) return "down";
  if (/gap|second day|opening drive|support play|pullback|relative strength|catalyst/.test(t)) return "up";
  if (/breakout|flag|orb|range|flat top|cup|triangle|wedge|retest/.test(t)) return "warn";
  if (/momentum|explosive|power|run|acceleration|vwap/.test(t)) return "accent";
  if (/reversal|red to|green to|reddog|bottom|top|hammer|bounce|stuffed|mean|pairs|arb|imbalance|moc|opg|closing|dark pool|liquidity|ipo|offering|dividend/.test(t)) return "purple";
  return "neutral";
}

/** Folder colours: stored on the server as an index into the legacy 12-colour palette; mapped to tokens here. */
// Class names are written out literally so Tailwind's scanner picks them up.
type FolderSwatch = { label: string; text: string; bg: string };
const SWATCH_AMBER: FolderSwatch = { label: "Янтарный", text: "text-[hsl(var(--chart-3))]", bg: "bg-[hsl(var(--chart-3))]" };
const SWATCH_GREEN: FolderSwatch = { label: "Зелёный", text: "text-[hsl(var(--chart-2))]", bg: "bg-[hsl(var(--chart-2))]" };
const SWATCH_BLUE: FolderSwatch = { label: "Голубой", text: "text-[hsl(var(--chart-1))]", bg: "bg-[hsl(var(--chart-1))]" };
const SWATCH_RED: FolderSwatch = { label: "Красный", text: "text-[hsl(var(--chart-4))]", bg: "bg-[hsl(var(--chart-4))]" };
const SWATCH_PURPLE: FolderSwatch = { label: "Фиолетовый", text: "text-[hsl(var(--chart-5))]", bg: "bg-[hsl(var(--chart-5))]" };
const SWATCH_ACCENT: FolderSwatch = { label: "Синий", text: "text-primary", bg: "bg-primary" };
const SWATCH_GREY: FolderSwatch = { label: "Серый", text: "text-muted-foreground", bg: "bg-muted-foreground" };
/** Index → swatch. Legacy indices 6–10 (pink, indigo, yellow, orange, teal) fold onto the nearest token. */
export const FOLDER_SWATCHES: FolderSwatch[] = [
  SWATCH_AMBER, SWATCH_GREEN, SWATCH_BLUE, SWATCH_RED, SWATCH_PURPLE, SWATCH_ACCENT,
  SWATCH_RED, SWATCH_PURPLE, SWATCH_AMBER, SWATCH_AMBER, SWATCH_GREEN, SWATCH_GREY,
];
/** Distinct swatches offered in the colour picker (index into FOLDER_SWATCHES). */
export const PICKER_SWATCH_INDICES = [0, 1, 2, 3, 4, 5, 11];

const AUTO_SWATCHES = [SWATCH_BLUE, SWATCH_GREEN, SWATCH_AMBER, SWATCH_PURPLE, SWATCH_RED, SWATCH_ACCENT];
export function folderSwatch(name: string | null | undefined, colors: Record<string, number>): FolderSwatch {
  if (!name) return SWATCH_GREY;
  const idx = colors[name];
  if (idx != null && FOLDER_SWATCHES[idx]) return FOLDER_SWATCHES[idx];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AUTO_SWATCHES[Math.abs(h) % AUTO_SWATCHES.length];
}

export function splitTags(tags: string | null | undefined): string[] {
  return tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

export function checklistCount(e: Pick<PlaybookEntry, "checklist" | "checklistItems">): number {
  if (e.checklistItems?.length) return e.checklistItems.length;
  return e.checklist ? e.checklist.split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean).length : 0;
}

/** Text a setup is searchable by. */
export function searchHaystack(e: PlaybookEntry): string {
  return [e.name, e.folder, e.setupType, e.conditions, e.tags, e.notes, e.ticker, e.sector, e.longName, e.checklist]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function isSameLocalDay(iso: string | null | undefined, ref: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

export function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diff)) return null;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export const fmtPct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
export const fmtR = (x: number | null | undefined) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}R`);

export type SortKey = "folder" | "edge" | "used" | "new" | "name";
export type QuickFilter = "all" | "today" | "edge" | "untested" | "unreviewed" | "noExamples";

/** $ expectancy per trade (net), only with ≥ 3 trades — R is usually absent, so $ is the primary edge. */
export function usdEdge(s: SetupSummary | undefined): number | null {
  if (!s || s.tradeCount < 3) return null;
  if (s.expectancyUsd != null) return s.expectancyUsd;
  return s.netPnl != null && s.tradeCount ? s.netPnl / s.tradeCount : null;
}

/** Sorts setups in place-safe manner (returns a new array). */
export function sortEntries(list: PlaybookEntry[], sort: SortKey, summary: Map<number, SetupSummary>): PlaybookEntry[] {
  const arr = [...list];
  const s = (e: PlaybookEntry) => summary.get(e.id);
  switch (sort) {
    case "edge":
      return arr.sort((a, b) => {
        const sa = s(a), sb = s(b);
        const ua = usdEdge(sa) ?? -Infinity, ub = usdEdge(sb) ?? -Infinity;
        if (ua !== ub) return ub - ua;
        const ea = sa?.edgeScore ?? -Infinity, eb = sb?.edgeScore ?? -Infinity;
        if (ea !== eb) return eb - ea;
        const na = sa?.tradeCount ?? 0, nb = sb?.tradeCount ?? 0;
        if (na !== nb) return nb - na;
        return (b.confidenceLevel ?? 0) - (a.confidenceLevel ?? 0);
      });
    case "used":
      return arr.sort((a, b) => {
        const ua = s(a)?.lastUsedAt ?? "", ub = s(b)?.lastUsedAt ?? "";
        if (ua !== ub) return ua < ub ? 1 : -1;
        return a.name.localeCompare(b.name, "ru");
      });
    case "new":
      return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    default:
      return arr.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
}

export function matchesQuickFilter(e: PlaybookEntry, f: QuickFilter, summary: Map<number, SetupSummary>): boolean {
  const s = summary.get(e.id);
  switch (f) {
    case "today": return isSameLocalDay(s?.lastUsedAt);
    case "edge": return (usdEdge(s) ?? s?.expectancy ?? 0) > 0 && (s?.tradeCount ?? 0) >= 3;
    case "noExamples": return (s?.exampleCount ?? 0) === 0;
    case "untested": return !s || s.tradeCount === 0;
    case "unreviewed": return !e.reviewed;
    default: return true;
  }
}

export const LS = {
  view: "playbook-view",
  sort: "playbook-sort",
  filter: "playbook-quick-filter",
  openFolders: "playbook-open-folders",
  folderOrder: "playbook-folder-order",
  folderColors: "playbook-folder-colors",
  zoom: "playbook-zoom",
  recent: "playbook-recent",
} as const;

export function draftKey(editId?: number | null, parentId?: number | null) {
  if (editId) return `playbook-draft-${editId}`;
  return parentId ? `playbook-draft-new-child-${parentId}` : "playbook-draft-new";
}
