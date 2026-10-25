/**
 * Single source of truth for the app's information architecture: sidebar groups, mobile tabs,
 * command-palette pages and document titles all read from here.
 *
 * Two levels, grouped by the trader's day (nav-structure, 2026-10-25): Сегодня (plan → trade → risk) → Разбор (journal,
 * analytics, playbook, rules) → Рынок → Команда → Обучение; staff get «Управление» right under «Сегодня» (the curator
 * cabinet with its review queue, the admin pages). Five groups for a trader, six for staff:
 * - a group holds a few sidebar rows (16 for a trader);
 * - a row may own `children`: pages of the same job (Аналитика → Статистика, Поведение…). They show under the row
 *   while you are inside that set or when the row is opened with its chevron; a pinned page sits in «Закреплённые»
 *   at the top (use-nav-prefs.ts). A row left with a single visible child lists it as a row (nav-model.ts).
 *   Every page keeps its own route; nothing is merged, so deep links and old URLs keep working.
 *
 * Labels come from the `shell` namespace (i18n/locales/<lang>/shell.ts → nav.*, navShort.*, groups.*).
 * `name`, `short` and `label` are getters, so they always return the current language when read during
 * render (never cache them in module-level constants).
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Crosshair, ShieldAlert, CandlestickChart, NotebookPen, Calculator,
  LineChart, BarChart3, ListChecks, BookMarked, Eye, Radar, CalendarClock, BookOpen, Newspaper,
  Award, Layers, Gauge, Lightbulb, MessageSquare, Mic, NotebookText, Trophy, Crown, Activity,
  Settings, ShieldCheck, PieChart, Plug, TrendingUp, ClipboardCheck, Bell, FlaskConical, Brain, FileText, TextSearch,
  GraduationCap, Target, School, UserCheck, UsersRound, PencilRuler, ClipboardList, Building2, Gamepad2, Shapes, ScanSearch,
  ChartSpline, Scale, IdCard,
} from "lucide-react";
import { shellI18n, type NavGroupKey, type NavKey, type NavShortKey } from "@/i18n/ns/shell";
import ruShell from "@/i18n/locales/ru/shell";

/** Sections behind a desk switch (GET /api/permissions/me → `nav.<feature>`); off or unknown → not in the menu. */
export type NavFeature = "authorNotes";

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
  /** Shown only while this desk switch is on (sidebar, phone sheet and palette alike). */
  feature?: NavFeature;
  /** Other path prefixes that should highlight this item. */
  also?: string[];
  /** Two-key shortcut after "G" (e.g. G then D). */
  goKey?: string;
  /** Link target when it differs from `href` (a tab of the page, e.g. «Мой прогресс» → /ratings?tab=quests). */
  to?: string;
  /** Pages one level below this sidebar row (same job, own routes). */
  children?: NavItem[];
};

export type NavGroup = {
  id: NavGroupKey;
  readonly label: string;
  /** Sidebar rows. */
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

function group(id: NavGroupKey, items: NavItem[]): NavGroup {
  return {
    id,
    items,
    get label() { return shellI18n.t(`groups.${id}`); },
  };
}

export const NAV_GROUPS: NavGroup[] = [
  // The live day: the plan, the trades as they come in from PropReports, what is left to the stop.
  group("today", [
    nav("dashboard", { short: true, href: "/", icon: LayoutDashboard, keywords: "dashboard главная сегодня today", goKey: "d" }),
    nav("gamePlan", { short: true, href: "/game-plan", icon: Crosshair, keywords: "game plan премаркет premarket in play катализаторы уровни", goKey: "p" }),
    nav("trades", { href: "/trades", icon: CandlestickChart, keywords: "trades трейды позиции сделки", goKey: "t" }),
    nav("risk", { short: true, href: "/risk", icon: ShieldAlert, keywords: "risk лимиты limits просадка drawdown buying power стоп", goKey: "r" }),
  ]),
  // Staff work (curators, admins): the review queue first, then the desk's configuration. Traders never see the group.
  group("manage", [
    nav("curator", { short: true, href: "/curator", icon: ClipboardList, keywords: "curator куратор кабинет подопечные разбор очередь нарушения риск заметки трейдеры", staff: true, goKey: "k", children: [
      nav("academyMentor", { href: "/academy/mentor", icon: UserCheck, keywords: "academy наставник ментор ученики 1:1 договорённости mentor", staff: true }),
      nav("scaling", { href: "/scaling", icon: TrendingUp, keywords: "scaling масштабирование лимиты уровни tier тир buying power одобрение", staff: true }),
    ] }),
    nav("admin", { href: "/admin", icon: ShieldCheck, keywords: "admin модерация жалобы пользователи люди доступ настройки деска", staff: true, children: [
      nav("integrations", { href: "/integrations", icon: Plug, keywords: "integrations propreports импорт import брокер выписка", staff: true }),
      nav("academyContent", { short: true, href: "/academy/content-admin", icon: PencilRuler, keywords: "academy редактор курсов уроки тесты задания контент content editor", staff: true }),
    ] }),
  ]),
  // After the close: what happened (journal), why (analytics), the setups and rules it feeds.
  group("review", [
    nav("journal", { href: "/journal", icon: NotebookPen, keywords: "journal журнал дневник разбор дня eod закрытие дня вечер сводка итог дня junior notes", goKey: "j", children: [
      nav("dayReport", { href: "/day-report", icon: FileText, keywords: "day report разбор дня итоги дня отчёт план на завтра" }),
      nav("weeklyReview", { href: "/weekly-review", icon: ClipboardCheck, keywords: "weekly review неделя итоги недели отчёт" }),
      // Волна 2 п. 2.9: the trader's own 30-day answer (where I earn / lose, one rule for tomorrow); staff keep /analytics.
      nav("myReview", { href: "/my-review", icon: ScanSearch, keywords: "my review мой разбор где зарабатываю где теряю правило на завтра итоги месяца" }),
    ] }),
    // Every analysis tool under one umbrella; «Мой edge и рынок» is the page's own tab (/analytics?tab=myedge).
    nav("analytics", { href: "/analytics", icon: LineChart, keywords: "analytics equity expectancy R аналитика my edge мой edge и рынок edge matrix монте-карло monte carlo психология", goKey: "a", children: [
      nav("stats", { href: "/stats", icon: BarChart3, keywords: "stats статистика winrate", goKey: "s" }),
      nav("behavior", { short: true, href: "/behavior", icon: Brain, keywords: "behavior тильт реванш овертрейдинг дисциплина сетапы классификатор setups" }),
      nav("whatIf", { href: "/what-if", icon: FlaskConical, keywords: "what-if что если комиссии тариф правила издержки costs fees" }),
      nav("chartLab", { short: true, href: "/chart-lab", icon: ChartSpline, keywords: "chart lab график разбор реплей replay review ws chart свечи vwap уровни рисование tools инструменты" }),
      nav("ask", { short: true, href: "/ask", icon: TextSearch, keywords: "ask спроси журнал вопрос поиск запрос сколько лучший худший", goKey: "q" }),
    ] }),
    nav("playbook", { href: "/playbook", icon: BookMarked, keywords: "playbook сетапы setups A+", goKey: "b" }),
    nav("rules", { href: "/rules", icon: ListChecks, keywords: "rules ошибки errors дисциплина error-tracker нарушения", also: ["/error-tracker"] }),
  ]),
  group("market", [
    nav("events", { href: "/events", icon: CalendarClock, keywords: "events earnings отчёты календарь catalysts катализаторы макро cpi fomc nfp события", goKey: "e", children: [
      nav("analystActions", { href: "/analyst-actions", icon: Award, keywords: "analyst upgrades downgrades апгрейды даунгрейды аналитики" }),
      nav("offerings", { href: "/offerings", icon: Layers, keywords: "offerings размещения dilution SPO" }),
    ] }),
    nav("themes", { href: "/themes", icon: Shapes, keywords: "themes темы рынка theme tracker сектора секторы корзины сильные слабые от открытия за день" }),
    nav("watchlist", { href: "/watchlist", icon: Eye, keywords: "watchlist список тикеров", goKey: "w", children: [
      nav("big7", { href: "/big7", icon: Radar, keywords: "big7 мегакапы magnificent" }),
      nav("indicators", { href: "/indicators", icon: Gauge, keywords: "indicators макро VIX breadth" }),
      // Options chain + advisor for a ticker (?ticker= prefills it): a market view, opened from a ticker.
      nav("calculator", { href: "/calculator", icon: Calculator, keywords: "calculator калькулятор опционы options греки black-scholes страйк IV payoff tools инструменты", goKey: "c" }),
    ] }),
  ]),
  group("team", [
    nav("discussions", { href: "/discussions", icon: MessageSquare, keywords: "discussions чат треды обсуждения", goKey: "m", children: [
      // Волна 2 п. 2.15: behind the desk switch nav.authorNotes (default off) — nobody writes it on the pilot.
      nav("authorNotes", { href: "/author-notes", icon: Mic, keywords: "author notes авторская сводка", feature: "authorNotes" }),
      // Волна 1, item 1.20: the day's desk news and manual posts are on the desk plan; the full feeds stay, last.
      nav("dailyFeed", { href: "/dailyfeed", icon: Newspaper, keywords: "daily feed дневная лента тема дня" }),
      nav("activity", { href: "/activity", icon: Activity, keywords: "activity лента активности" }),
      // Item 1.5: the evening summary is the journal's «Закрыть день»; the old page only reads past notes (legacy).
      nav("juniorNotes", { href: "/junior-notes", icon: NotebookText, keywords: "junior notes джуны", hidden: true }),
    ] }),
    nav("ideas", { href: "/trade-ideas", icon: Lightbulb, keywords: "ideas trade ideas идеи", goKey: "i" }),
    // Who performs best: people, the desk, the day's top, idea authors (components/ratings/idea-metrics), the office.
    nav("ratings", { href: "/ratings", icon: Trophy, keywords: "ratings рейтинг трейдеров leaderboard", children: [
      nav("benchmark", { short: true, href: "/benchmark", icon: Scale, keywords: "benchmark бенчмарк сравнение команда деск перцентили sharpe" }),
      nav("topResults", { href: "/top-results", icon: Crown, keywords: "top results лучшие топ дня top of the day календарь прибыль убыток лидеры" }),
      nav("ideaStats", { href: "/trade-idea-stats", icon: PieChart, keywords: "idea stats статистика идей авторы калибровка hit rate" }),
      nav("office", { short: true, href: "/office", icon: Building2, keywords: "office офис партнёры статистика стратегии цель капитал" }),
    ] }),
  ]),
  group("learn", [
    nav("academyMy", { short: true, href: "/academy/my", icon: School, keywords: "academy академия моё обучение цели ипр занятия посещаемость", goKey: "l", children: [
      nav("academyLearn", { short: true, href: "/academy/learn", icon: BookOpen, keywords: "academy академия курсы уроки тесты задания программа обучение" }),
      nav("academyPath", { short: true, href: "/academy/path", icon: GraduationCap, keywords: "academy академия путь стажёр джун трейдер сеньор перевод ступень критерии" }),
      nav("academyChallenges", { href: "/academy/challenges", icon: Target, keywords: "academy экзамены challenge челлендж оценка капитал" }),
      nav("academyCohorts", { href: "/academy/cohorts", icon: UsersRound, keywords: "academy когорты группы офис удалённо расписание занятия" }),
    ] }),
    // Practice on real charts (bar by bar, the day's task, own days): learning by doing, next to the courses.
    nav("trainer", { href: "/trainer", icon: Gamepad2, also: ["/simulator"], keywords: "trainer тренажёр симулятор simulator игра задача дня найди вход мои дни chartgame бар за баром тренировка practice drill tools инструменты" }),
  ]),
];

/** Sections reached from the header (user menu, bell): searchable and titled, never in the sidebar. */
const HEADER_ITEMS: NavItem[] = [
  // Everyone's own profile (scouting card, biography, analytics) — from the user menu and the palette, like settings
  // (the sidebar stays at 16 rows, nav-structure); /people/:id (a member's, staff / own) is titled by it too.
  nav("profile", { href: "/profile", icon: IdCard, keywords: "profile профиль характеристика автобиография карточка трейдера мой профиль people", hidden: true, also: ["/people"] }),
  nav("settings", { href: "/settings", icon: Settings, keywords: "settings профиль тема настройки", hidden: true }),
  nav("notifications", { href: "/notifications", icon: Bell, keywords: "notifications уведомления колокольчик инбокс inbox упоминания алерты", hidden: true, goKey: "n" }),
];

/** Row + its children, in sidebar order. */
const flatten = (i: NavItem): NavItem[] => [i, ...(i.children ?? [])];

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items.flatMap(flatten)), ...HEADER_ITEMS];

const PARENT = new Map<string, NavItem>();
const GROUP = new Map<string, NavGroup>();
for (const g of NAV_GROUPS) {
  for (const row of g.items) {
    for (const i of flatten(row)) GROUP.set(i.href, g);
    for (const c of row.children ?? []) PARENT.set(c.href, row);
  }
}

/** The sidebar row a child page lives under (undefined for rows themselves). */
export function parentOf(item: NavItem): NavItem | undefined {
  return PARENT.get(item.href);
}

/** The sidebar group of a page (undefined for header-only pages). */
export function groupOf(item: NavItem): NavGroup | undefined {
  return GROUP.get(item.href);
}

export function isNavActive(item: NavItem, location: string): boolean {
  const match = (p: string) => (p === "/" ? location === "/" : location === p || location.startsWith(p + "/"));
  return match(item.href) || (item.also?.some(match) ?? false);
}

/** The row's own page or one of its children is open. */
export function isWithin(row: NavItem, location: string): boolean {
  return isNavActive(row, location) || (row.children?.some((c) => isNavActive(c, location)) ?? false);
}

/** The item that owns this path: its own href first, then an item that merely lists it in `also`. */
export function navItemFor(location: string): NavItem | undefined {
  const own = (i: NavItem) => (i.href === "/" ? location === "/" : location === i.href || location.startsWith(i.href + "/"));
  return ALL_NAV_ITEMS.find(own) ?? ALL_NAV_ITEMS.find((i) => isNavActive(i, location));
}

type TitleKey = "research" | "lesson" | "quiz" | "assignment" | "deskDay";
const navTitle = (key: NavKey) => () => shellI18n.t(`nav.${key}`);
const title = (key: TitleKey) => () => shellI18n.t(`titles.${key}`);

/** Section titles for paths outside the nav (document.title). */
const EXTRA_TITLES: [string, () => string][] = [
  ["/research", title("research")],
  ["/error-tracker", navTitle("rules")],
  ["/academy/lesson", title("lesson")],
  ["/desk-day", title("deskDay")],
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

/** Window event fired when G is pressed outside text fields (detail: true): the sidebar shows every quick-jump letter. */
export const GO_MODE_EVENT = "ws-go-mode";

/** Same physical keys on the Russian layout (ЙЦУКЕН), so «G then letter» works without switching layouts. */
export const GO_KEYS_RU_LAYOUT: Record<string, string> = {
  в: "d", з: "p", к: "r", е: "t", о: "j", с: "c", ф: "a", ы: "s", и: "b", ц: "w", у: "e", ш: "i", й: "q", т: "n", л: "k", ь: "m", д: "l", // i18n-ignore (RU layout keys)
};
