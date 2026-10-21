/**
 * Cards mode of the curator group («Группа» → «Карточки»). Renders in pages: «Все группы» in cards mode is the whole
 * desk (6 curators × ~25 juniors and more), and every card carries a sparkline, limit bar and patterns.
 * The parent remounts it with `key={group}`, so switching the group starts from the first page again.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { curatorI18n } from "@/i18n/ns/curator";
import type { PatternBrief, TraderSignal } from "./api";
import { sortTraders, type TraderSort } from "./curator-math";
import type { SearchMark } from "./group-model";
import { TraderNameHL } from "./name-highlight";
import { TraderCard } from "./trader-card";

const PAGE = 48;

export function GroupCards({ traders, sort, marks, showPatterns, patterns, patternsLoading, onOpenTrader }: {
  traders: TraderSignal[];
  sort: TraderSort;
  marks: Map<string, SearchMark>;
  showPatterns: boolean;
  patterns: Record<string, PatternBrief[]> | null | undefined;
  patternsLoading: boolean;
  onOpenTrader: (trader: string, tab?: string) => void;
}) {
  const { t } = curatorI18n.useT();
  const sorted = React.useMemo(() => sortTraders(traders, sort), [traders, sort]);
  const [limit, setLimit] = React.useState(PAGE);
  const rest = sorted.length - limit;
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-[var(--grid-gap)]">
        {sorted.slice(0, limit).map((s) => (
          <TraderCard
            key={s.trader}
            s={s}
            title={<TraderNameHL s={s} mark={marks.get(s.trader)} />}
            showPatterns={showPatterns}
            patterns={patterns?.[s.trader] ?? null}
            patternsLoading={patternsLoading}
            onOpen={(tab) => onOpenTrader(s.trader, tab)}
          />
        ))}
      </div>
      {rest > 0 && (
        <Button type="button" variant="outline" className="self-center" onClick={() => setLimit((n) => n + PAGE)}>
          {t("showMore", { count: Math.min(PAGE, rest) })}
        </Button>
      )}
    </div>
  );
}
