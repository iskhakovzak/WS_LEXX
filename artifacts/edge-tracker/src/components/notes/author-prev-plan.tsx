import * as React from "react";
import { Check, CircleDashed, CornerDownLeft, History } from "lucide-react";
import { Panel, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type DayTrade } from "./author-model";
import { fmtDate, fmtR } from "@/lib/format";
import { followThrough, planLines, type FollowItem, type PrevPlan } from "./author-plan";
import { RichText } from "./author-reader";

function Item({ it, graded }: { it: FollowItem; graded: boolean }) {
  return (
    <li className="flex items-start gap-2 py-1">
      {graded && it.status === "traded" ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-up" aria-label="Торговал" />
      ) : graded && it.status === "missed" ? (
        <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Не торговал" />
      ) : (
        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 text-sm leading-relaxed">
        <RichText text={it.line} />
        {graded && it.traded.length > 0 && (
          <span className="ml-1.5 whitespace-nowrap text-xs tabular-nums">
            {it.traded.map((t, i) => (
              <span key={t.ticker} className={cn(t.r != null && toneText(toneOf(t.r)))}>
                {i > 0 ? ", " : ""}{t.ticker}{t.r != null ? ` ${fmtR(t.r, 1)}` : ""}
              </span>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * «План с прошлой сводки» next to today's editor: what the author promised yesterday (hold overnight / at the
 * open) with each plan ticker marked traded / not traded from today's trades. One click puts a «План vs факт»
 * block into «Уроки» — R only, the note is read by the team. Nothing is sent to AI.
 */
export function AuthorPrevPlan({
  plan,
  trades,
  canInsert,
  onInsert,
  onOpenDay,
}: {
  plan: PrevPlan;
  /** Today's trades from day-context; undefined while loading or unavailable (lines are then shown ungraded). */
  trades: DayTrade[] | undefined;
  canInsert: boolean;
  onInsert: (items: FollowItem[]) => void;
  onOpenDay: (date: string) => void;
}) {
  const groups = React.useMemo(
    () =>
      [
        { id: "hold", label: "Держал на ночь", lines: planLines(plan.hold) },
        { id: "open", label: "На открытии", lines: planLines(plan.open) },
      ].filter((g) => g.lines.length > 0),
    [plan],
  );
  const graded = !!trades;
  const all = React.useMemo(() => followThrough(groups.flatMap((g) => g.lines), trades ?? []), [groups, trades]);
  const withTickers = all.filter((i) => i.status !== "none");
  const hit = withTickers.filter((i) => i.status === "traded").length;
  let idx = 0;

  return (
    <Panel
      title="План с прошлой сводки"
      icon={History}
      description={
        <button type="button" onClick={() => onOpenDay(plan.date)} className="inline-block hover:text-foreground hover:underline first-letter:uppercase">
          {fmtDate(plan.date, "weekdayDayMonthLong")}
        </button>
      }
      actions={
        canInsert && all.length > 0 ? (
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => onInsert(all)} title="Добавит в «Уроки» строку на каждый пункт плана">
            <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />В уроки
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {graded && withTickers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            По тикерам из плана: <span className="font-medium tabular-nums text-foreground">{hit} из {withTickers.length}</span> в сделках сегодня
          </p>
        )}
        {groups.map((g) => (
          <div key={g.id} className="flex flex-col gap-0.5">
            <span className="micro-label">{g.label}</span>
            <ul className="flex flex-col">
              {g.lines.map((line) => {
                const it = all[idx++]!;
                return <Item key={`${g.id}-${idx}-${line}`} it={it} graded={graded} />;
              })}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
