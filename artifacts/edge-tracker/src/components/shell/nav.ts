/**
 * Single source of truth for the app's information architecture: sidebar groups, mobile tabs,
 * command-palette pages and document titles all read from here.
 *
 * Labels come from the `shell` namespace (i18n/locales/<lang>/shell.ts → nav.*, navShort.*, groups.*). `name`,
 * `short`, `label` and `memberLabel` are getters, so they always return the current language when read during
 * render (never cache them in module-level constants).
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Crosshair, ShieldAlert, CandlestickChart, NotebookPen, Calculator,
  LineChart, BarChart3, ListChecks, BookMarked, Eye, Radar, CalendarClock, BookOpen, Newspaper,
  Award, Layers, Gauge, Lightbulb, MessageSquare, Mic, NotebookText, Trophy, Crown, Activity,
  Settings, ShieldCheck, PieChart, Plug, TrendingUp, ClipboardCheck, Bell, FlaskConical, Brain, FileText, MessageSquareText, GraduationCap, Target, School, UserCheck, UsersRound, PencilRuler, ClipboardList, Building2,
} from "lucide-react";
import { shellI18n, type NavGroupKey, type NavKey, type NavShortKey } from "@/i18n/ns/shell";
import ruShell from "@/i18n/locales/ru/shell";

export type NavItem = {
  /** Stable id = the dictionary key (shell `nav.<key>`). */
  key: NavKey;
  /** Label in the current language (sidebar, tabs, palette, document title). */
  readonly name: string;
  /** Short label for the mobile tab bar. */
  readonly short?: string;
  /** Russian label (palette search matches it in every UI language). */
  readonly ruName: string;
  href: string;
  icon: LucideIcon;
  /** Extra palette search terms (RU/EN synonyms, slang) — not shown, not translated. */
  keywords?: string;
  /** Only curators/admins see it. */
  staff?: boolean;
  /** Not shown in the sidebar (still searchable, still titled). */
  hidden?: boolean;
  /** Other path prefixes that should highlight this item. */
  also?: string[];
  /** Two-key shortcut after "G" (e.g. G then D). */
  goKey?: string;
};

export type NavGroup = {
  id: NavGroupKey;
  readonly label: string;
  /** Label when the viewer sees none of the group's staff items (e.g. a trader sees only «Настройки» in «Админ»). */
  readonly memberLabel?: string;
  items: NavItem[];
};

type NavDef<K extends NavKey> = Omit<NavItem, "key" | "name" | "short" | "ruName"> & {
  /** true → the item has a `navShort.<key>` label (only keys present in navShort are allowed). */
  short?: K extends NavShortKey ? true : never;
};

function nav<K extends NavKey>(key: K, def: NavDef<K>): NavItem {
  const { short, ...rest } = def;
  // Widen the generic K to the key union, so t() can check the template key (a bare generic stays unresolved).
  const k: NavKey = key;
  const sk = k as NavShortKey;
  return {
    key,
    ...rest,
    get name() { return shellI18n.t(`nav.${k}`); },
    get short() { return short ? shellI18n.t(`navShort.${sk}`) : undefined; },
    get ruName() { return ruShell.nav[k]; },
  };
}

function group(id: NavGroupKey, items: NavItem[], memberLabel?: NavGroupKey): NavGroup {
  return {
    id,
    items,
    get label() { return shellI18n.t(`groups.${id}`); },
    get memberLabel() { return memberLabel ? shellI18n.t(`groups.${memberLabel}`) : undefined; },
  };
}

export const NAV_GROUPS: NavGroup[] = [
  group("day", [
    nav("dashboard", { short: true, href: "/", icon: LayoutDashboard, keywords: "dashboard главная сегодня today", goKey: "d" }),
    nav("gamePlan", { short: true, href: "/game-plan", icon: Crosshair, keywords: "game plan премаркет premarket in play катализаторы уровни", goKey: "p" }),
    nav("risk", { short: true, href: "/risk", icon: ShieldAlert, keywords: "risk лимиты limits просадка drawdown buying power", goKey: "r" }),
  ]),
  group("trade", [
    nav("trades", { href: "/trades", icon: CandlestickChart, keywords: "trades трейды позиции", goKey: "t" }),
    nav("journal", { href: "/journal", icon: NotebookPen, keywords: "journal журнал дневник разбор дня eod закрытие дня", goKey: "j" }),
    nav("calculator", { href: "/calculator", icon: Calculator, keywords: "calculator опционы options греки black-scholes страйк IV payoff", goKey: "c" }),
  ]),
  group("review", [
    nav("analytics", { href: "/analytics", icon: LineChart, keywords: "analytics equity expectancy R", goKey: "a" }),
    nav("weeklyReview", { href: "/weekly-review", icon: ClipboardCheck, keywords: "weekly review неделя итоги недели отчёт" }),
    nav("dayReport", { href: "/day-report", icon: FileText, keywords: "day report разбор дня итоги дня отчёт план на завтра" }),
    nav("behavior", { short: true, href: "/behavior", icon: Brain, keywords: "behavior тильт реванш овертрейдинг дисциплина сетапы классификатор setups" }),
    nav("simulator", { href: "/simulator", icon: FlaskConical, keywords: "what-if симулятор что если комиссии тариф" }),
    nav("chartLab", { short: true, href: "/chart-lab", icon: CandlestickChart, keywords: "chart lab график реплей тренировка ws chart свечи vwap уровни" }),
    nav("stats", { href: "/stats", icon: BarChart3, keywords: "stats статистика winrate", goKey: "s" }),
    nav("ask", { short: true, href: "/ask", icon: MessageSquareText, keywords: "ask спроси журнал вопрос поиск запрос сколько лучший худший", goKey: "q" }),
    nav("rules", { href: "/rules", icon: ListChecks, keywords: "rules ошибки errors дисциплина error-tracker нарушения" }),
    nav("playbook", { href: "/playbook", icon: BookMarked, keywords: "playbook сетапы setups A+", goKey: "b" }),
  ]),
  group("market", [
    nav("watchlist", { href: "/watchlist", icon: Eye, keywords: "watchlist список тикеров", goKey: "w" }),
    nav("big7", { href: "/big7", icon: Radar, keywords: "big7 мегакапы magnificent" }),
    nav("events", { href: "/events", icon: CalendarClock, keywords: "events earnings отчёты календарь catalysts катализаторы макро cpi fomc nfp события", goKey: "e" }),
    nav("dailyFeed", { href: "/dailyfeed", icon: Newspaper, keywords: "daily feed дневная лента тема дня" }),
    nav("analystActions", { href: "/analyst-actions", icon: Award, keywords: "analyst upgrades downgrades апгрейды даунгрейды" }),
    nav("offerings", { href: "/offerings", icon: Layers, keywords: "offerings размещения dilution SPO" }),
    nav("indicators", { href: "/indicators", icon: Gauge, keywords: "indicators макро VIX breadth" }),
  ]),
  group("team", [
    nav("curator", { short: true, href: "/curator", icon: ClipboardList, keywords: "curator куратор кабинет подопечные разбор нарушения риск заметки трейдеры", staff: true }),
    nav("ideas", { href: "/trade-ideas", icon: Lightbulb, keywords: "ideas trade ideas идеи", also: ["/trade-idea-stats"], goKey: "i" }),
    nav("benchmark", { short: true, href: "/benchmark", icon: Gauge, keywords: "benchmark бенчмарк сравнение команда деск перцентили sharpe" }),
    nav("office", { short: true, href: "/office", icon: Building2, keywords: "office офис партнёры статистика стратегии цель капитал" }),
    nav("discussions", { href: "/discussions", icon: MessageSquare, keywords: "discussions чат треды" }),
    nav("authorNotes", { href: "/author-notes", icon: Mic, keywords: "author notes авторская сводка" }),
    nav("juniorNotes", { href: "/junior-notes", icon: NotebookText, keywords: "junior notes джуны" }),
    nav("ratings", { href: "/ratings", icon: Trophy, keywords: "ratings рейтинг трейдеров leaderboard" }),
    nav("scaling", { href: "/scaling", icon: TrendingUp, keywords: "scaling масштабирование лимиты уровни tier" }),
    nav("topResults", { href: "/top-results", icon: Crown, keywords: "top results лучшие", staff: true }),
    nav("activity", { href: "/activity", icon: Activity, keywords: "activity лента активности" }),
    nav("ideaStats", { href: "/trade-idea-stats", icon: PieChart, keywords: "idea stats", hidden: true }),
    nav("notifications", { href: "/notifications", icon: Bell, keywords: "notifications уведомления колокольчик инбокс inbox упоминания алерты", hidden: true, goKey: "n" }),
  ]),
  group("academy", [
    nav("academyMy", { short: true, href: "/academy/my", icon: School, keywords: "academy академия моё обучение цели ипр занятия посещаемость" }),
    nav("academyLearn", { short: true, href: "/academy/learn", icon: BookOpen, keywords: "academy академия курсы уроки тесты задания программа обучение" }),
    nav("academyPath", { short: true, href: "/academy/path", icon: GraduationCap, keywords: "academy академия путь стажёр джун трейдер сеньор перевод ступень критерии" }),
    nav("academyChallenges", { href: "/academy/challenges", icon: Target, keywords: "academy экзамены challenge челлендж оценка капитал" }),
    nav("academyMentor", { href: "/academy/mentor", icon: UserCheck, keywords: "academy наставник ментор ученики 1:1 договорённости", staff: true }),
    nav("academyCohorts", { href: "/academy/cohorts", icon: UsersRound, keywords: "academy когорты группы офис удалённо расписание занятия" }),
    nav("academyContent", { short: true, href: "/academy/content-admin", icon: PencilRuler, keywords: "academy редактор курсов уроки тесты задания контент", staff: true }),
  ]),
  group("admin", [
    nav("settings", { href: "/settings", icon: Settings, keywords: "settings профиль тема" }),
    nav("integrations", { href: "/integrations", icon: Plug, keywords: "integrations propreports импорт import брокер выписка", staff: true }),
    nav("admin", { href: "/admin", icon: ShieldCheck, keywords: "admin модерация жалобы пользователи", staff: true }),
  ], "account"),
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Mobile bottom tab bar (the 5th slot is «More»). */
export const MOBILE_TABS = ["/", "/game-plan", "/trades", "/journal"];

export function isNavActive(item: NavItem, location: string): boolean {
  const match = (p: string) => (p === "/" ? location === "/" : location === p || location.startsWith(p + "/"));
  return match(item.href) || (item.also?.some(match) ?? false);
}

/** The item that owns this path: its own href first, then an item that merely lists it in `also`
 *  (so /trade-idea-stats is «Idea stats», not «Ideas»). */
export function navItemFor(location: string): NavItem | undefined {
  const own = (i: NavItem) => (i.href === "/" ? location === "/" : location === i.href || location.startsWith(i.href + "/"));
  return ALL_NAV_ITEMS.find(own) ?? ALL_NAV_ITEMS.find((i) => isNavActive(i, location));
}

type TitleKey = "research" | "lesson" | "quiz" | "assignment";
const navTitle = (key: NavKey) => () => shellI18n.t(`nav.${key}`);
const title = (key: TitleKey) => () => shellI18n.t(`titles.${key}`);

/** Section titles for paths outside the nav (document.title). */
const EXTRA_TITLES: [string, () => string][] = [
  ["/research", title("research")],
  ["/error-tracker", navTitle("rules")],
  ["/academy/lesson", title("lesson")],
];

/** Sub-views of one route told apart by the query string (first matching param wins). */
const SEARCH_TITLES: Record<string, [string, () => string][]> = {
  "/academy/lesson": [["quiz", title("quiz")], ["assignment", title("assignment")], ["id", title("lesson")]],
};

/** Section title for a path in the current language (document.title), or null for an unknown path. */
export function routeTitle(location: string, search = ""): string | null {
  const bySearch = SEARCH_TITLES[location];
  if (bySearch && search) {
    const params = new URLSearchParams(search);
    const hit = bySearch.find(([key]) => params.has(key));
    if (hit) return hit[1]();
  }
  return navItemFor(location)?.name
    ?? EXTRA_TITLES.find(([p]) => location === p || location.startsWith(p + "/"))?.[1]()
    ?? null;
}

export const GO_KEYS: Record<string, string> = Object.fromEntries(
  ALL_NAV_ITEMS.filter((i) => i.goKey).map((i) => [i.goKey!, i.href]),
);
