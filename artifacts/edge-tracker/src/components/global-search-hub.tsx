/**
 * Command palette as the hub: its data (search corpora, ticker stats, a trade by #id) and the quick actions wired to
 * the existing flows (close the day, share card of the last trade, today's plan, new idea, risk, theme, language).
 * Lives next to global-search.tsx (not in components/palette/) because it composes several features.
 *
 * Nothing here fetches while the palette is closed: every query is `enabled: open`. Server lookups take the debounced
 * query and their AbortSignal, so a newer keystroke cancels the older request.
 */
import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Trade } from "@workspace/api-client-react";
import {
  useListEvents, useListResearch, useListDailyFeed, getTrade,
  getListEventsQueryKey, getListResearchQueryKey, getListDailyFeedQueryKey,
} from "@workspace/api-client-react";
import { BookMarked, CalendarClock, CircleHelp, ImageDown, Languages, Lightbulb, LockKeyhole, Moon, ShieldAlert, Crosshair, Sparkles, SunMoon } from "lucide-react";
import { fetchTradesPage, TRADES_PAGE_KEY, type TradesPageSummary } from "@/hooks/use-trades-page";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { dailyMeQuery, tradeIdeasQuery } from "@/lib/api/queries";
import { links } from "@/lib/links";
import { normalizeResult } from "@/lib/trade-result";
import { fmtDate } from "@/lib/format";
import { nyDate, prevWeekday } from "@/lib/trading-date";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { LANGS, LANG_META, setLang, useLang, type Lang } from "@/i18n";
import { shellI18n } from "@/i18n/ns/shell";
import { commonI18n } from "@/i18n/ns/common";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { lockI18n } from "@/i18n/ns/lock";
import ruShell from "@/i18n/locales/ru/shell";
import ruLock from "@/i18n/locales/ru/lock";
import { LOCK_KEYS } from "@/lib/lock/lock-model";
import { requestLock } from "@/lib/lock/lock-store";
import ruOnboarding from "@/i18n/locales/ru/onboarding";
import { onboardingI18n } from "@/i18n/ns/onboarding";
import { openHelp } from "@/lib/onboarding/store";
import { openAssistant } from "@/lib/assistant/bus";
import { assistantI18n } from "@/i18n/ns/assistant";
import ruAssistant from "@/i18n/locales/ru/assistant";
import { ALL_NAV_ITEMS } from "@/components/shell/nav";
import { navItemOpen } from "@/components/shell/nav-model";
import { useEodStatus } from "@/components/eod/eod-api";
import { nextStep } from "@/components/daily/next-step-model";
import { canShareTrade, sharePolicy } from "@/components/trades/share-card/model";
import { openSetupSheet } from "@/components/shared/playbook-sheet";
import type { Corpora } from "@/components/palette/results";

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

async function fetchList(path: string, signal?: AbortSignal): Promise<unknown[]> {
  const data = await http.get<unknown>(path, { signal });
  return Array.isArray(data) ? data : [];
}

/** Value that settles `ms` after the last change (inputs of server lookups). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Text the server searches with: no leading `$` / `#`, capped. */
export const serverQuery = (q: string) => q.trim().replace(/^[$#]\s*/, "").slice(0, 120);

/**
 * Search corpora. Trades are searched server-side (GET /api/trades/page?q=&limit=20&lite=1) per debounced query;
 * the other lists load on the first open and are filtered locally (instant on every keystroke).
 */
export function usePaletteCorpora(open: boolean, debounced: string, typed: string): { corpora: Corpora; loading: boolean } {
  const tradeQ = serverQuery(debounced);
  // `#123` is a trade id (looked up on its own), not a text search.
  const tradesOn = open && tradeQ.length > 0 && !/^#\s*\d+$/.test(debounced.trim());
  const trades = useQuery<unknown[]>({
    queryKey: [TRADES_PAGE_KEY, "search", tradeQ.toLowerCase()],
    queryFn: async ({ signal }) => (await fetchTradesPage(new URLSearchParams({ q: tradeQ, limit: "20", lite: "1" }), signal)).items ?? [],
    enabled: tradesOn,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const events = useListEvents(undefined, { query: { queryKey: getListEventsQueryKey(), enabled: open } });
  const research = useListResearch({ query: { queryKey: getListResearchQueryKey(), enabled: open } });
  const feeds = useListDailyFeed({ query: { queryKey: getListDailyFeedQueryKey(), enabled: open } });
  const playbook = useQuery<unknown[]>({ queryKey: ["playbook"], queryFn: ({ signal }) => fetchList("/api/playbook", signal), enabled: open, staleTime: STALE.default });
  // Same cache entry as the ideas board / stats / ratings (one request).
  const ideas = useQuery({ ...tradeIdeasQuery<unknown>(), enabled: open });
  const pending = serverQuery(typed) !== tradeQ;
  const loading = open && ((tradesOn && (trades.isLoading || pending)) || events.isLoading || research.isLoading || feeds.isLoading || playbook.isLoading || ideas.isLoading);
  const corpora = React.useMemo<Corpora>(() => ({
    trades: tradesOn ? asArray(trades.data) : [], events: asArray(events.data), research: asArray(research.data),
    feeds: asArray(feeds.data), playbook: asArray(playbook.data), ideas: asArray(ideas.data),
  }), [tradesOn, trades.data, events.data, research.data, feeds.data, playbook.data, ideas.data]);
  return { corpora, loading };
}

/** The viewer's own numbers on a ticker (whole history: count, win rate, net) + the date of the last such trade. */
export function useTickerStats(open: boolean, ticker: string | null, me: string | null) {
  return useQuery<TradesPageSummary | null>({
    queryKey: [TRADES_PAGE_KEY, "palette-ticker", ticker, me],
    queryFn: async ({ signal }) => (await fetchTradesPage(new URLSearchParams({ ticker: ticker ?? "", trader: me ?? "", limit: "1" }), signal)).summary ?? null,
    enabled: open && !!ticker && !!me,
    staleTime: STALE.short,
    retry: false,
  });
}

/** `#123`: the trade itself (the server applies the viewer's access; someone else's trade is redacted or 403/404). */
export function useTradeById(open: boolean, id: number | null) {
  return useQuery<Trade | null>({
    queryKey: [TRADES_PAGE_KEY, "palette-id", id],
    queryFn: ({ signal }) => getTrade(id ?? 0, { signal }).catch(() => null),
    enabled: open && id != null && id > 0,
    staleTime: STALE.short,
    retry: false,
  });
}

/** Day for a ticker chart: the viewer's last trade on it, else the latest weekday. */
export function chartDay(lastDate: string | null | undefined): string {
  if (lastDate && /^\d{4}-\d{2}-\d{2}/.test(lastDate)) return lastDate.slice(0, 10);
  const today = nyDate();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? prevWeekday(today) : today;
}

const EMPTY_TRADES: Trade[] = [];

/** The viewer's newest own trades (one small request shared by «close the day» and «image of the last trade»). */
function useMyLatestTrades(open: boolean, me: string | null): Trade[] {
  const q = useQuery<Trade[]>({
    queryKey: [TRADES_PAGE_KEY, "palette-latest", me],
    queryFn: async ({ signal }) => ((await fetchTradesPage(new URLSearchParams({ trader: me ?? "", limit: "10", lite: "1", sort: "date", dir: "desc" }), signal)).items ?? []) as Trade[],
    enabled: open && !!me,
    staleTime: STALE.short,
    retry: false,
  });
  return q.data ?? EMPTY_TRADES;
}

/** Latest own closed trade a share card can be made of (desk switch shareCards.enabled, model.canShareTrade). */
function useLatestShareTrade(latest: Trade[], me: string | null): Trade | null {
  const { permissions } = useAuth();
  const on = !!me && sharePolicy(permissions).enabled;
  return React.useMemo(() => (on ? latest.find((t) => canShareTrade(t, me, permissions)) ?? null : null), [on, latest, me, permissions]);
}

/**
 * «Close the day» is due (the dashboard's rule): the newest own trading day with a closed trade — before today, or
 * today once the session is over — whose end-of-day status is still open. Without the EOD API the daily loop's
 * evening card decides (nextStep).
 */
function useCloseDay(open: boolean, me: string | null, canJournal: boolean, latest: Trade[]): { href: string; date: string; trades?: number } | null {
  const on = open && !!me && canJournal;
  const daily = useQuery({ ...dailyMeQuery(nyDate()), enabled: on, retry: false });
  const today = daily.data?.today ?? nyDate();
  const afterClose = daily.data?.phase === "afterclose" || daily.data?.phase === "weekend";
  const lastDay = latest
    .filter((t) => normalizeResult(t.result) != null)
    .map((t) => String(t.exitDate ?? t.date ?? "").slice(0, 10))
    .find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && (d < today || (d === today && afterClose))) ?? null;
  const step = daily.data ? nextStep({ me: daily.data, plan: undefined }) : null;
  const date = lastDay ?? (step?.kind === "close" ? step.date : "");
  const status = useEodStatus(date, me ?? "", on && !!date);
  if (!on || !date || status.isLoading) return null;
  const row = status.data?.traders?.find((r) => r.trader === me);
  const due = status.data ? row?.status === "open" && row.trades > 0 : step?.kind === "close";
  if (!due) return null;
  return { href: `${links.journalDay(date)}&eod=1`, date, trades: row?.trades ?? step?.trades };
}

/** A palette command. `terms`: extra match words (any language); `quick`: listed under «Quick actions» on open. */
export type HubAction = {
  id: string;
  label: string;
  subtitle?: string;
  /** Keys of the global shortcut doing the same. */
  keys?: string[];
  icon: React.ElementType;
  run: () => void;
  terms: string[];
  quick?: boolean;
};

type Ctx = {
  open: boolean;
  /** Navigate and close the palette. */
  go: (path: string) => void;
  close: () => void;
  openShare: (t: Trade) => void;
  openLanguages: () => void;
  /** Typed text (the setup sheet searches it without the action's own words). */
  raw: string;
};

const ru = ruShell.palette;
/** Words that name the setup action itself (dropped from the text the cheat sheet searches). */
const setupWords = () => new Set([...`${ru.keywords.setup} ${shellI18n.t("palette.keywords.setup")} setup setap playbook pleybuk`.toLowerCase().split(/\s+/)].filter(Boolean));
export const setupQuery = (raw: string) => raw.split(/\s+/).filter((w) => w && !setupWords().has(w.toLowerCase())).join(" ");

const navOpen = (href: string, isCurator: boolean, nav: unknown) => {
  const item = ALL_NAV_ITEMS.find((i) => i.href === href);
  return !!item && navItemOpen(item, isCurator, nav);
};

/** Commands valid for this viewer right now (role, desk switches, state of the day). */
export function useHubActions(ctx: Ctx): HubAction[] {
  const { open, go, close, openShare, openLanguages, raw } = ctx;
  const { user, canEdit, isCurator, can, permissions } = useAuth();
  const me = user && user.role !== "guest" ? user.traderName : null;
  const { cycleTheme, themeLabel, theme } = useTheme();
  const lang = useLang();
  lockI18n.useT(); // the lock action's texts follow the language (its EN / UZ chunk loads on first use)
  assistantI18n.useT();
  const t = shellI18n.t;
  const canMine = !!me && can("journal.write.own", { trader: me });
  const latest = useMyLatestTrades(open, me);
  const closeDay = useCloseDay(open, me, canMine, latest);
  const shareTrade = useLatestShareTrade(latest, me);
  const nav = permissions.nav;

  const out: HubAction[] = [];
  if (closeDay) {
    out.push({
      id: "close-day", quick: true, icon: Moon, label: t("palette.action.closeDay"),
      subtitle: t("palette.action.closeDayHint", { date: fmtDate(closeDay.date, "dayMonth"), trades: commonI18n.t("units.trades", { count: closeDay.trades ?? 0 }) }),
      run: () => go(closeDay.href), terms: [ru.action.closeDay, ru.keywords.closeDay, t("palette.keywords.closeDay"), "eod close day wrap kunni yopish"],
    });
  }
  if (shareTrade) {
    out.push({
      id: "share-last", quick: true, icon: ImageDown, label: t("palette.action.shareLast"),
      subtitle: t("palette.action.shareLastHint", { ticker: shareTrade.ticker, date: fmtDate(String(shareTrade.date ?? "").slice(0, 10), "dayMonth") }),
      run: () => { close(); openShare(shareTrade); }, terms: [ru.action.shareLast, ru.keywords.share, t("palette.keywords.share"), "share card image picture rasm"],
    });
  }
  if (navOpen("/game-plan", isCurator, nav)) {
    out.push({
      id: "plan-today", quick: true, icon: Crosshair, keys: ["G", "P"], label: t("palette.action.planToday"),
      subtitle: canMine ? t("palette.action.planTodayHint") : undefined,
      run: () => go(canMine ? links.myPlan() : links.gamePlan()), terms: [ru.action.planToday, ru.keywords.plan, t("palette.keywords.plan"), "plan today premarket reja"],
    });
  }
  if (canEdit && navOpen("/trade-ideas", isCurator, nav)) {
    out.push({ id: "new-idea", quick: true, icon: Lightbulb, label: t("palette.action.newIdea"), run: () => go(links.newIdea()), terms: [ru.action.newIdea, ru.keywords.idea, t("palette.keywords.idea"), "new idea yangi goya"] });
  }
  if (navOpen("/risk", isCurator, nav)) {
    const desk = isCurator;
    out.push({
      id: "risk", quick: true, icon: ShieldAlert, keys: ["G", "R"], label: desk ? t("palette.action.riskDesk") : t("palette.action.myRisk"),
      subtitle: desk ? t("palette.action.riskDeskHint") : t("palette.action.myRiskHint"),
      run: () => go(links.risk()), terms: [ru.action.riskDesk, ru.action.myRisk, ru.keywords.risk, t("palette.keywords.risk"), "risk desk limits xavf"],
    });
  }
  if (me) {
    out.push({
      id: "lock", quick: true, icon: LockKeyhole, keys: [...LOCK_KEYS], label: lockI18n.t("palette.label"), subtitle: lockI18n.t("palette.hint"),
      run: () => { close(); requestLock(); }, terms: [ruLock.palette.label, ruLock.palette.keywords, lockI18n.t("palette.keywords"), "lock screen away qulf"],
    });
  }
  if (me && can("assistant.use")) {
    // «Ассистент WS» (components/assistant): opens the panel with the current page as context; Ctrl/⌘+J does the same.
    out.push({
      id: "assistant", quick: true, icon: Sparkles, keys: ["Ctrl", "J"], label: assistantI18n.t("palette.label"), subtitle: assistantI18n.t("palette.hint"),
      run: () => { close(); window.setTimeout(() => openAssistant({}), 0); },
      terms: [ruAssistant.palette.label, ruAssistant.palette.keywords, assistantI18n.t("palette.keywords"), "assistant ai ask chat yordamchi"],
    });
  }
  out.push({
    id: "theme", quick: true, icon: SunMoon, label: t("palette.action.theme"), subtitle: commonI18n.t("theme.currentHint", { name: themeLabel }),
    run: () => cycleTheme(), terms: [ru.action.theme, ru.keywords.theme, t("palette.keywords.theme"), `theme dark light mavzu ${theme}`],
  });
  out.push({
    id: "language", quick: true, icon: Languages, label: t("palette.action.languageMenu"), subtitle: t("palette.action.languageCurrent", { name: LANG_META[lang].native }),
    run: openLanguages, terms: [ru.action.languageMenu, ru.keywords.language, t("palette.keywords.language"), "language lang til"],
  });
  // Searchable only (not in the quick list): one command per other language, new event, the setup cheat sheet.
  for (const l of LANGS) {
    if (l === lang) continue;
    out.push({
      id: `lang-${l}`, icon: Languages, label: t("palette.action.language", { name: LANG_META[l].native }), run: () => switchLang(l, close),
      terms: [ru.keywords.language, t("palette.keywords.language"), LANG_META[l].code, ru.langNames[l], t(`palette.langNames.${l}`), "language lang til", LATIN_LANG[l]],
    });
  }
  if (canEdit && navOpen("/events", isCurator, nav)) {
    out.push({ id: "new-event", icon: CalendarClock, label: t("palette.action.newEvent"), run: () => go("/events?new=1"), terms: [ru.action.newEvent, ru.keywords.event, t("palette.keywords.event"), "new event catalyst earnings yangi voqea"] });
  }
  out.push({
    id: "setup", icon: BookMarked, label: playbookTodayI18n.t("palette.action"), subtitle: playbookTodayI18n.t("palette.hint"),
    run: () => { close(); openSetupSheet({ query: setupQuery(raw) }); }, terms: [ru.keywords.setup, t("palette.keywords.setup"), "setup setap playbook pleybuk orb vwap flag gap"],
  });
  out.push({
    id: "help", icon: CircleHelp, label: onboardingI18n.t("help.paletteAction"), subtitle: onboardingI18n.t("help.paletteHint"),
    run: () => { close(); window.setTimeout(openHelp, 0); },
    terms: [ruOnboarding.help.paletteAction, ruOnboarding.help.keywords, onboardingI18n.t("help.keywords"), "help hints tour shortcuts yordam"],
  });
  return out;
}

/** Latin names of each language in the other two Latin-script UIs (EN / UZ), so «uzbek» or «inglizcha» always match. */
const LATIN_LANG: Record<Lang, string> = { ru: "russian ruscha", en: "english inglizcha", uz: "uzbek ozbek ozbekcha" };

export function switchLang(l: Lang, close: () => void) {
  close();
  void setLang(l, { source: "user", focus: "#main-content" });
}

const LazyShareCardDialog = React.lazy(() => import("@/components/trades/share-card/ShareCardDialog"));

/** The share card dialog of «Image of the last trade»; rendered outside the palette so it outlives it. */
export function ShareCardHost({ trade, onClose }: { trade: Trade | null; onClose: () => void }) {
  if (!trade) return null;
  return (
    <React.Suspense fallback={null}>
      <LazyShareCardDialog trade={trade} open onOpenChange={(v) => { if (!v) onClose(); }} />
    </React.Suspense>
  );
}
