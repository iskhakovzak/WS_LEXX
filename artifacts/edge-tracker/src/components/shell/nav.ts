/**
 * Single source of truth for the app's information architecture: sidebar groups, mobile tabs,
 * command-palette pages and document titles all read from here.
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Crosshair, ShieldAlert, CandlestickChart, NotebookPen, Calculator,
  LineChart, BarChart3, ListChecks, BookMarked, Eye, Radar, CalendarClock, BookOpen, Newspaper,
  Award, Layers, Gauge, Lightbulb, MessageSquare, Mic, NotebookText, Trophy, Crown, Activity,
  Settings, ShieldCheck, PieChart, Plug, TrendingUp, ClipboardCheck, Bell, FlaskConical, Brain, FileText, MessageSquareText, GraduationCap, Target, School, UserCheck, UsersRound, PencilRuler, ClipboardList, Building2,
} from "lucide-react";

export type NavItem = {
  /** Russian label shown everywhere (sidebar, tabs, palette, document title). */
  name: string;
  /** Short label for the mobile tab bar. */
  short?: string;
  href: string;
  icon: LucideIcon;
  /** Extra palette search terms (EN synonyms, slang). */
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

export type NavGroup = { id: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "day",
    label: "День",
    items: [
      { name: "Дашборд", href: "/", icon: LayoutDashboard, keywords: "dashboard главная сегодня today", goKey: "d" },
      { name: "План дня", short: "План", href: "/game-plan", icon: Crosshair, keywords: "game plan премаркет premarket in play катализаторы уровни", goKey: "p" },
      { name: "Риск-деск", short: "Риск", href: "/risk", icon: ShieldAlert, keywords: "risk лимиты limits просадка drawdown buying power", goKey: "r" },
    ],
  },
  {
    id: "trade",
    label: "Торговля",
    items: [
      { name: "Сделки", href: "/trades", icon: CandlestickChart, keywords: "trades трейды позиции", goKey: "t" },
      { name: "Дневник", href: "/journal", icon: NotebookPen, keywords: "journal журнал дневник разбор дня eod закрытие дня", goKey: "j" },
      { name: "Калькулятор", href: "/calculator", icon: Calculator, keywords: "calculator опционы options греки black-scholes страйк IV payoff", goKey: "c" },
    ],
  },
  {
    id: "review",
    label: "Разбор",
    items: [
      { name: "Аналитика", href: "/analytics", icon: LineChart, keywords: "analytics equity expectancy R", goKey: "a" },
      { name: "Отчёт недели", href: "/weekly-review", icon: ClipboardCheck, keywords: "weekly review неделя итоги недели отчёт" },
      { name: "Разбор дня", href: "/day-report", icon: FileText, keywords: "day report разбор дня итоги дня отчёт план на завтра" },
      { name: "Поведение и сетапы", short: "Поведение", href: "/behavior", icon: Brain, keywords: "behavior тильт реванш овертрейдинг дисциплина сетапы классификатор setups" },
      { name: "Симулятор", href: "/simulator", icon: FlaskConical, keywords: "what-if симулятор что если комиссии тариф" },
      { name: "График и реплей", short: "График", href: "/chart-lab", icon: CandlestickChart, keywords: "chart lab график реплей тренировка ws chart свечи vwap уровни" },
      { name: "Статистика", href: "/stats", icon: BarChart3, keywords: "stats статистика winrate", goKey: "s" },
      { name: "Спроси журнал", short: "Спросить", href: "/ask", icon: MessageSquareText, keywords: "ask спроси журнал вопрос поиск запрос сколько лучший худший", goKey: "q" },
      { name: "Правила", href: "/rules", icon: ListChecks, keywords: "rules ошибки errors дисциплина error-tracker нарушения" },
      { name: "Плейбук", href: "/playbook", icon: BookMarked, keywords: "playbook сетапы setups A+", goKey: "b" },
    ],
  },
  {
    id: "market",
    label: "Рынок",
    items: [
      { name: "Вотчлист", href: "/watchlist", icon: Eye, keywords: "watchlist список тикеров", goKey: "w" },
      { name: "Big 7", href: "/big7", icon: Radar, keywords: "big7 мегакапы magnificent" },
      { name: "Катализаторы", href: "/events", icon: CalendarClock, keywords: "events earnings отчёты календарь catalysts катализаторы макро cpi fomc nfp события", goKey: "e" },
      { name: "Лента", href: "/dailyfeed", icon: Newspaper, keywords: "daily feed дневная лента тема дня" },
      { name: "Рейтинги аналитиков", href: "/analyst-actions", icon: Award, keywords: "analyst upgrades downgrades апгрейды даунгрейды" },
      { name: "Размещения", href: "/offerings", icon: Layers, keywords: "offerings размещения dilution SPO" },
      { name: "Индикаторы", href: "/indicators", icon: Gauge, keywords: "indicators макро VIX breadth" },
    ],
  },
  {
    id: "team",
    label: "Команда",
    items: [
      { name: "Кабинет куратора", short: "Кабинет", href: "/curator", icon: ClipboardList, keywords: "curator куратор кабинет подопечные разбор нарушения риск заметки трейдеры", staff: true },
      { name: "Идеи", href: "/trade-ideas", icon: Lightbulb, keywords: "ideas trade ideas идеи", also: ["/trade-idea-stats"], goKey: "i" },
      { name: "Бенчмарк деска", short: "Бенчмарк", href: "/benchmark", icon: Gauge, keywords: "benchmark бенчмарк сравнение команда деск перцентили sharpe" },
      { name: "Статистика офиса", short: "Офис", href: "/office", icon: Building2, keywords: "office офис партнёры статистика стратегии цель капитал" },
      { name: "Обсуждения", href: "/discussions", icon: MessageSquare, keywords: "discussions чат треды" },
      { name: "Сводка автора", href: "/author-notes", icon: Mic, keywords: "author notes авторская сводка" },
      { name: "Сводка джунов", href: "/junior-notes", icon: NotebookText, keywords: "junior notes джуны" },
      { name: "Рейтинги", href: "/ratings", icon: Trophy, keywords: "ratings рейтинг трейдеров leaderboard" },
      { name: "План масштабирования", href: "/scaling", icon: TrendingUp, keywords: "scaling масштабирование лимиты уровни tier" },
      { name: "Топ-результаты", href: "/top-results", icon: Crown, keywords: "top results лучшие", staff: true },
      { name: "Активность", href: "/activity", icon: Activity, keywords: "activity лента активности" },
      { name: "Статистика идей", href: "/trade-idea-stats", icon: PieChart, keywords: "idea stats", hidden: true },
      { name: "Уведомления", href: "/notifications", icon: Bell, keywords: "notifications уведомления колокольчик инбокс inbox упоминания алерты", hidden: true, goKey: "n" },
    ],
  },
  {
    id: "academy",
    label: "Академия",
    items: [
      { name: "Моё обучение", short: "Обучение", href: "/academy/my", icon: School, keywords: "academy академия моё обучение цели ипр занятия посещаемость" },
      { name: "Обучение", short: "Курсы", href: "/academy/learn", icon: BookOpen, keywords: "academy академия курсы уроки тесты задания программа обучение" },
      { name: "Путь трейдера", short: "Путь", href: "/academy/path", icon: GraduationCap, keywords: "academy академия путь стажёр джун трейдер сеньор перевод ступень критерии" },
      { name: "Экзамены", href: "/academy/challenges", icon: Target, keywords: "academy экзамены challenge челлендж оценка капитал" },
      { name: "Наставник", href: "/academy/mentor", icon: UserCheck, keywords: "academy наставник ментор ученики 1:1 договорённости", staff: true },
      { name: "Когорты", href: "/academy/cohorts", icon: UsersRound, keywords: "academy когорты группы офис удалённо расписание занятия" },
      { name: "Редактор курсов", short: "Редактор", href: "/academy/content-admin", icon: PencilRuler, keywords: "academy редактор курсов уроки тесты задания контент", staff: true },
    ],
  },
  {
    id: "admin",
    label: "Админ",
    items: [
      { name: "Настройки", href: "/settings", icon: Settings, keywords: "settings профиль тема" },
      { name: "Интеграции", href: "/integrations", icon: Plug, keywords: "integrations propreports импорт import брокер выписка", staff: true },
      { name: "Админка", href: "/admin", icon: ShieldCheck, keywords: "admin модерация жалобы пользователи", staff: true },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Mobile bottom tab bar (the 5th slot is "Ещё"). */
export const MOBILE_TABS = ["/", "/game-plan", "/trades", "/journal"];

export function isNavActive(item: NavItem, location: string): boolean {
  const match = (p: string) => (p === "/" ? location === "/" : location === p || location.startsWith(p + "/"));
  return match(item.href) || (item.also?.some(match) ?? false);
}

export function navItemFor(location: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => isNavActive(i, location));
}

/** Russian section title for a path (document.title). */
const EXTRA_TITLES: [string, string][] = [
  ["/research", "Архив исследований"],
  ["/error-tracker", "Правила"],
  ["/academy/lesson", "Урок"],
];

export function routeTitle(location: string): string | null {
  return navItemFor(location)?.name
    ?? EXTRA_TITLES.find(([p]) => location === p || location.startsWith(p + "/"))?.[1]
    ?? null;
}

export const GO_KEYS: Record<string, string> = Object.fromEntries(
  ALL_NAV_ITEMS.filter((i) => i.goKey).map((i) => [i.goKey!, i.href]),
);
