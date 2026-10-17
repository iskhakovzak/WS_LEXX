/**
 * Watchlist page chrome (pages/watchlist.tsx): header actions, list tabs (drop targets for dragged rows),
 * search + quick filters, the bulk-action bar and the delete confirmation. Presentational only — state and
 * mutations stay in the page.
 */
import type * as React from "react";
import {
  Activity, AlertTriangle, Archive, ArchiveRestore, CalendarClock, Clock, Crosshair, Download, Eye, Flame, Keyboard,
  MoreHorizontal, MoveVertical, Radar, Rows3, Rows4, Search, Trash2, Volume2, X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FilterChip, Kbd } from "@/components/ds";
import { cn } from "@/lib/utils";
import { LISTS, LIST_HINT, LIST_LABELS, type ListName, type WatchlistItem } from "./lib";
import type { Density } from "./WatchlistTable";

export type View = ListName | "all" | "archive";
export type Filter = "events" | "gap" | "rvol" | "level";

export const FILTERS: { key: Filter; label: string; icon: React.ElementType; hint: string }[] = [
  { key: "events", label: "События", icon: CalendarClock, hint: "Отчёт сегодня / вчера AMC / в ближайшие 2 дня или новости за 24 ч" },
  { key: "gap", label: "Гэп ≥ 3%", icon: MoveVertical, hint: "Гэп на открытии не меньше 3% в любую сторону" },
  { key: "rvol", label: "rVol ≥ 1.5×", icon: Volume2, hint: "Относительный объём от 1.5×" },
  { key: "level", label: "У уровня", icon: Crosshair, hint: "Цена в пределах 0.25 ATR (или 0.5%) от PDH / PDL / VWAP / стопа / цели" },
];

const HOTKEYS: [string[], string][] = [
  [["A"], "добавить тикеры (поле ввода)"],
  [["/"], "поиск по списку"],
  [["J", "K"], "вниз / вверх по строкам (или ↓ ↑)"],
  [["Enter"], "открыть карточку тикера"],
  [["E"], "заметка к строке"],
  [["1", "2", "3"], "перенести в Сегодня / Свинги / Наблюдаю"],
  [["X"], "выбрать строку"],
  [["Del"], "в архив (с отменой)"],
  [["R"], "обновить котировки"],
  [["D"], "плотность строк"],
  [["?"], "эта подсказка"],
];

/** Hotkeys popover + «Ещё действия» menu (next to the quote status in the page header). */
export function WatchlistHeaderMenus({ helpOpen, onHelpOpen, canEdit, canExport, onExport, onAddDetailed, canScoreAll, scoringAll, onScoreAll }: {
  helpOpen: boolean;
  onHelpOpen: (v: boolean) => void;
  canEdit: boolean;
  canExport: boolean;
  onExport: () => void;
  onAddDetailed: () => void;
  canScoreAll: boolean;
  scoringAll: boolean;
  onScoreAll: () => void;
}) {
  return (
    <>
      <Popover open={helpOpen} onOpenChange={onHelpOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="hidden h-9 w-9 sm:inline-flex" aria-label="Горячие клавиши (?)" title="Горячие клавиши (?)">
            <Keyboard className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] bg-popover">
          <p className="mb-2 text-sm font-semibold text-foreground">Горячие клавиши</p>
          <ul className="space-y-1.5 text-sm">
            {HOTKEYS.map(([keys, label]) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex w-20 shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                <span className="text-muted-foreground">{label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Строки можно перетаскивать на вкладки списков. В поле добавления — несколько тикеров через запятую или пробел, можно вставить столбец.</p>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Ещё действия"><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={onExport} disabled={!canExport}><Download className="mr-2 h-4 w-4" />Экспорт видимых строк в CSV</DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuItem onSelect={onAddDetailed}>
                <Radar className="mr-2 h-4 w-4" />Добавить с катализатором и уровнями…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onScoreAll} disabled={scoringAll || !canScoreAll}>
                <Activity className="mr-2 h-4 w-4" />{scoringAll ? "Считаем score…" : "Пересчитать score всех"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const TABS: { v: View; label: string; icon: React.ElementType; title: string }[] = [
  { v: "today", label: LIST_LABELS.today, icon: Flame, title: LIST_HINT.today },
  { v: "swing", label: LIST_LABELS.swing, icon: Clock, title: LIST_HINT.swing },
  { v: "watch", label: LIST_LABELS.watch, icon: Eye, title: LIST_HINT.watch },
  { v: "all", label: "Все", icon: Radar, title: "Все рабочие списки" },
];

/** Lists + archive tabs (drop targets while a row is dragged), the «в минусе по истории» hint and the density toggle. */
export function WatchlistTabs({ view, onView, counts, canEdit, dragging, dropOver, onDropOver, onDropTo, losing, density, onToggleDensity }: {
  view: View;
  onView: (v: View) => void;
  counts: Record<View, number>;
  canEdit: boolean;
  dragging: boolean;
  dropOver: View | null;
  onDropOver: (fn: (d: View | null) => View | null) => void;
  onDropTo: (target: View) => (e: React.DragEvent) => void;
  /** Tickers in view with a losing history: [ticker, net $]. */
  losing: Array<[string, number]>;
  density: Density;
  onToggleDensity: () => void;
}) {
  const dragProps = (v: View, droppable: boolean) => ({
    onDragOver: (e: React.DragEvent) => { if (!droppable) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDropOver(() => v); },
    onDragLeave: () => onDropOver((d) => (d === v ? null : d)),
    onDrop: droppable ? onDropTo(v) : undefined,
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Списки" className="glass-field inline-flex max-w-full items-center gap-0.5 overflow-x-auto p-1">
        {TABS.map((t) => {
          const active = view === t.v;
          const droppable = dragging && t.v !== "all";
          const Icon = t.icon;
          return (
            <button
              key={t.v}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.v === "all" ? t.title : `${t.title}${canEdit ? ` · клавиша ${LISTS.indexOf(t.v as ListName) + 1} переносит строку сюда` : ""}`}
              onClick={() => onView(t.v)}
              {...dragProps(t.v, droppable)}
              className={cn(
                "inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-[var(--dur-1)]",
                active ? "bg-primary-solid text-primary-foreground" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
                droppable && !active && "ring-1 ring-dashed ring-primary/50",
                dropOver === t.v && "ring-2 ring-primary",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />{t.label}
              <span className={cn("tabular-nums", active ? "opacity-90" : "opacity-80")}>{counts[t.v]}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        role="tab"
        aria-selected={view === "archive"}
        onClick={() => onView("archive")}
        {...dragProps("archive", dragging)}
        title="Пропущенные тикеры. Перетащите строку сюда, чтобы убрать из работы"
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm transition-colors",
          view === "archive" ? "bg-[var(--glass-hover-bg)] font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          dragging && "ring-1 ring-dashed ring-border",
          dropOver === "archive" && "ring-2 ring-primary",
        )}
      >
        <Archive className="h-3.5 w-3.5" aria-hidden="true" />Архив<span className="tabular-nums opacity-80">{counts.archive}</span>
      </button>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        {losing.length > 0 && (
          <span
            className="hidden min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground md:inline-flex"
            title={losing.map(([t, net]) => `${t}: ${Math.round(net)}$`).join("\n")}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-down" aria-hidden="true" />
            В минусе по истории: {losing.slice(0, 4).map(([t]) => t).join(", ")}{losing.length > 4 ? ` +${losing.length - 4}` : ""}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onToggleDensity}
          aria-label={density === "compact" ? "Подробные строки (D)" : "Компактные строки (D)"}
          title={density === "compact" ? "Подробные строки: название, катализатор, график 22 дня (D)" : "Компактные строки (D)"}
          aria-pressed={density === "comfortable"}
        >
          {density === "compact" ? <Rows3 className="h-4 w-4" /> : <Rows4 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

/** Search box + quick filter chips. */
export function WatchlistSearch({ inputRef, query, onQuery, filters, onToggleFilter, filterCounts }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (v: string) => void;
  filters: Set<Filter>;
  onToggleFilter: (f: Filter) => void;
  filterCounts: Record<Filter, number>;
}) {
  return (
    <>
      <div className="relative w-full sm:w-44 2xl:w-52">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Поиск"
          aria-label="Поиск по вотчлисту"
          className="glass-field h-10 w-full pl-9 pr-8 text-sm outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button type="button" onClick={() => onQuery("")} aria-label="Очистить поиск" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : <Kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>}
      </div>
      {/* Phones: one scrollable row of chips instead of two wrapped rows; from sm up they flow inline. */}
      <div className="-mx-1 flex w-[calc(100%+0.5rem)] gap-2 overflow-x-auto px-1 sm:contents">
        {FILTERS.map((f) => (
          <FilterChip key={f.key} active={filters.has(f.key)} onClick={() => onToggleFilter(f.key)} count={filterCounts[f.key] || undefined} className="min-h-10 shrink-0">
            <f.icon className="h-3.5 w-3.5" aria-hidden="true" /><span title={f.hint}>{f.label}</span>
          </FilterChip>
        ))}
      </div>
    </>
  );
}

/** Sticky bar with bulk actions for the selected rows. */
export function SelectionBar({ items, view, mayModify, onRestore, onMove, onArchive, onDelete, onClear }: {
  items: WatchlistItem[];
  view: View;
  mayModify: (i: WatchlistItem) => boolean;
  /** From the archive back into a list. */
  onRestore: (list: ListName) => void;
  onMove: (list: ListName) => void;
  onArchive: () => void;
  onDelete: (items: WatchlistItem[]) => void;
  onClear: () => void;
}) {
  const deletable = items.filter(mayModify);
  return (
    <div className="glass-thick sticky-top flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2" role="region" aria-label="Действия с выбранными">
      <span className="text-sm font-medium text-foreground">Выбрано: {items.length}</span>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      {view === "archive" ? (
        LISTS.map((l) => (
          <Button key={l} size="sm" variant="outline" onClick={() => onRestore(l)}>
            <ArchiveRestore className="h-4 w-4" />В «{LIST_LABELS[l]}»
          </Button>
        ))
      ) : (
        <>
          {LISTS.map((l, k) => (
            <Button key={l} size="sm" variant="outline" disabled={view === l} onClick={() => onMove(l)}>
              В «{LIST_LABELS[l]}» <Kbd className="ml-1 hidden sm:inline-flex">{k + 1}</Kbd>
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={onArchive}><Archive className="h-4 w-4" />В архив</Button>
        </>
      )}
      {deletable.length > 0 && (
        <Button
          size="sm" variant="ghost" className="text-down"
          title={deletable.length === items.length ? undefined : "Удалятся только твои тикеры — чужие может удалить автор или куратор"}
          onClick={() => onDelete(deletable)}
        >
          <Trash2 className="h-4 w-4" />Удалить{deletable.length === items.length ? "" : ` (${deletable.length})`}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}><X className="h-4 w-4" />Снять выбор</Button>
    </div>
  );
}

/** «Удалить N тикеров?» — the delete itself is undoable from the toast. */
export function DeleteTickersDialog({ items, busy, onCancel, onConfirm }: {
  items: WatchlistItem[] | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (items: WatchlistItem[]) => void;
}) {
  return (
    <AlertDialog open={!!items} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {items && items.length === 1 ? `Удалить ${items[0].ticker}?` : `Удалить ${items?.length ?? 0} тикеров?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {items && items.length > 1 ? `${items.map((d) => d.ticker).join(", ")}. ` : ""}
            Чтобы просто убрать из работы, используйте «В архив». Удаление можно отменить кнопкой в уведомлении.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); if (items) onConfirm(items); }}
            disabled={busy}
            className={buttonVariants({ variant: "destructive" })}
          >
            {busy ? "Удаляем…" : "Удалить"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
