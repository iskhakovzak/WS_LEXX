import * as React from "react";
import { forwardRef } from "react";
import { ArrowUpRight, Bell, Database, Palette, Plug, Search, ShieldCheck, SlidersHorizontal, UserRound, Users, type LucideIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { Capability } from "@/lib/permissions";

export type SectionId = "profile" | "appearance" | "trading" | "notifications" | "team" | "permissions" | "data" | "integrations";

export type SectionMeta = {
  id: SectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Extra words the settings search matches (Russian + common English terms). */
  keywords: string;
  /** Shown only when the viewer holds at least one of these capabilities (see auth-context `can`). */
  requiresAny?: Capability[];
  /** The section lives on another page now: selecting it navigates there instead of rendering here. */
  href?: string;
};

export const SECTIONS: SectionMeta[] = [
  { id: "profile", label: "Профиль", description: "Имя, роль, команда, пароль", icon: UserRound,
    keywords: "профиль пароль сессии выйти куратор ментор риск-менеджер аккаунт password profile" },
  { id: "appearance", label: "Внешний вид", description: "Тема интерфейса", icon: Palette,
    keywords: "тема тёмная темная светлая сумеречная dim dark light оформление вид" },
  { id: "trading", label: "Торговля", description: "Счёт, риск, комиссии, плечо", icon: SlidersHorizontal,
    keywords: "счёт счет риск комиссия плечо leverage горизонт интрадей овернайт свинг чек-лист checklist покупательная buying power размер позиции" },
  { id: "notifications", label: "Уведомления", description: "Дайджест и Telegram-оповещения", icon: Bell,
    keywords: "уведомления дайджест digest email почта утро вечер расписание оповещения" },
  { id: "team", label: "Команда", description: "Пользователи, роли, назначения", icon: Users, requiresAny: ["users.read.team"], href: "/admin?tab=people",
    keywords: "команда пользователи роли пригласить добавить деактивировать куратор ментор риск-менеджер назначения users team invite" },
  { id: "permissions", label: "Права доступа", description: "Матрица прав по ролям", icon: ShieldCheck, requiresAny: ["users.read.team", "permissions.manage"], href: "/admin?tab=roles",
    keywords: "права доступ роли матрица разрешения permissions capabilities куратор админ трейдер scope закреплённые" },
  { id: "data", label: "Данные и бэкапы", description: "Экспорт CSV, бэкап БД", icon: Database,
    keywords: "данные экспорт импорт csv json бэкап backup база выгрузка" },
  { id: "integrations", label: "Интеграции", description: "Telegram-бот, рассылки", icon: Plug,
    keywords: "интеграции telegram телеграм бот привязать отвязать рассылка broadcast" },
];

export function visibleSections(can: (cap: Capability) => boolean): SectionMeta[] {
  return SECTIONS.filter((s) => !s.requiresAny || s.requiresAny.some((c) => can(c)));
}

export function matchSections(list: SectionMeta[], q: string): SectionMeta[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((s) => `${s.label} ${s.description} ${s.keywords}`.toLowerCase().includes(needle));
}

type NavProps = {
  sections: SectionMeta[];
  active: SectionId;
  onSelect: (id: SectionId) => void;
  query: string;
  onQuery: (q: string) => void;
  badges?: Partial<Record<SectionId, React.ReactNode>>;
};

/** Desktop: sticky vertical nav with search. Mobile: search + horizontally scrolling chips. */
export const SettingsNav = forwardRef<HTMLInputElement, NavProps>(function SettingsNav(
  { sections, active, onSelect, query, onQuery, badges },
  searchRef,
) {
  const filtered = matchSections(sections, query);
  const listRef = React.useRef<HTMLDivElement>(null);

  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-nav]") ?? []);
    const i = items.findIndex((b) => b === document.activeElement);
    const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  }

  return (
    <nav aria-label="Разделы настроек" className="flex flex-col gap-2 lg:sticky lg:top-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered[0]) { onSelect(filtered[0].id); onQuery(""); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { onQuery(""); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="Найти настройку"
          aria-label="Поиск по настройкам"
          className="glass-field h-9 w-full rounded-full pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 lg:inline-flex">/</Kbd>
      </div>

      {/* Mobile / tablet: chips */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden" role="tablist" aria-label="Разделы">
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active === s.id}
            data-active={active === s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
              active === s.id ? "bg-primary-solid text-primary-foreground" : "chip",
            )}
          >
            <s.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {s.label}
            {s.href && <ArrowUpRight className="h-3 w-3 text-muted-foreground" aria-label="в пульте деска" />}
          </button>
        ))}
      </div>

      {/* Desktop: vertical list */}
      <div ref={listRef} onKeyDown={onListKey} className="glass-panel hidden flex-col gap-0.5 rounded-2xl p-1.5 lg:flex">
        {filtered.map((s) => {
          const idx = sections.findIndex((x) => x.id === s.id) + 1;
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              data-nav
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(s.id)}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
              )}
            >
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", isActive ? "bg-primary-solid text-primary-foreground" : "bg-[var(--glass-bg)]")}>
                <s.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.description}</span>
              </span>
              {badges?.[s.id]}
              {s.href && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Откроется в пульте деска" />}
              {idx <= 9 && <Kbd className="opacity-0 transition-opacity group-hover:opacity-100">{idx}</Kbd>}
            </button>
          );
        })}
        {filtered.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">Ничего не найдено</p>}
      </div>
      {filtered.length === 0 && <p className="px-1 text-xs text-muted-foreground lg:hidden">Ничего не найдено</p>}
    </nav>
  );
});
