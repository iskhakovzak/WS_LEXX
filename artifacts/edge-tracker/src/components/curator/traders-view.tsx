import * as React from "react";
import { Search, Users } from "lucide-react";
import { EmptyState, Segmented, Toolbar, usePersistentState } from "@/components/ds";
import { Input } from "@/components/ui/input";
import type { TraderSignal } from "./api";
import { matchesQuery, sortTraders, type TraderSort } from "./curator-math";
import { TraderCard } from "./trader-card";

const SORTS: { value: TraderSort; label: string }[] = [
  { value: "attention", label: "Внимание" },
  { value: "pnl", label: "Неделя ↑" },
  { value: "discipline", label: "Дисциплина ↑" },
  { value: "name", label: "Имя" },
];

type Filter = "all" | "risk" | "queue" | "quiet";

/** «Мои трейдеры»: card grid with search, sort and an attention filter. */
export function TradersView({ traders, onOpenTrader }: { traders: TraderSignal[]; onOpenTrader: (trader: string, tab?: string) => void }) {
  const [sort, setSort] = usePersistentState<TraderSort>("curator.sort", "attention");
  const [filter, setFilter] = usePersistentState<Filter>("curator.filter", "all");
  const [patterns, setPatterns] = usePersistentState<"on" | "off">("curator.patterns", traders.length <= 16 ? "on" : "off");
  const [q, setQ] = React.useState("");

  const isRisk = (s: TraderSignal) => s.risk.halted || s.risk.nearStop || !s.risk.hasLimits || s.breaches.unreviewed > 0;
  const isQueue = (s: TraderSignal) => s.eod.pending > 0 || s.weekly.submittedPending || s.academy.pendingSubmissions > 0 || s.academy.overdueActions > 0;
  const counts = {
    all: traders.length,
    risk: traders.filter(isRisk).length,
    queue: traders.filter(isQueue).length,
    quiet: traders.filter((s) => s.nextAction.kind === "none" || s.nextAction.priority < 40).length,
  };
  const shown = sortTraders(
    traders.filter((s) => matchesQuery(s, q)).filter((s) =>
      filter === "risk" ? isRisk(s) : filter === "queue" ? isQueue(s) : filter === "quiet" ? s.nextAction.kind === "none" || s.nextAction.priority < 40 : true),
    sort,
  );

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <Toolbar>
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Трейдер, этап, тир…" className="h-9 pl-8" aria-label="Поиск трейдера" />
        </div>
        <Segmented
          size="sm"
          ariaLabel="Фильтр"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Все", count: counts.all },
            { value: "risk", label: "Риск", count: counts.risk },
            { value: "queue", label: "Ждут разбора", count: counts.queue },
            { value: "quiet", label: "Спокойно", count: counts.quiet },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Segmented size="sm" ariaLabel="Паттерны поведения" value={patterns} onChange={setPatterns} options={[{ value: "on", label: "Паттерны" }, { value: "off", label: "Без паттернов" }]} />
          <Segmented size="sm" ariaLabel="Сортировка" value={sort} onChange={setSort} options={SORTS} />
        </div>
      </Toolbar>

      {shown.length === 0 ? (
        <EmptyState icon={Users} title={traders.length ? "Никто не подходит под фильтр" : "Трейдеров нет"} description={traders.length ? "Сбросьте поиск или выберите «Все»." : "За вами пока не закреплены трейдеры, а в деске нет активных."} />
      ) : (
        <div className="grid grid-cols-1 gap-[var(--grid-gap)] md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((s) => <TraderCard key={s.trader} s={s} showPatterns={patterns === "on"} onOpen={(tab) => onOpenTrader(s.trader, tab)} />)}
        </div>
      )}
    </div>
  );
}
