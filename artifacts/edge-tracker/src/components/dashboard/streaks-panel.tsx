import { Flame, Snowflake, Zap } from "lucide-react";
import { Panel } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { pluralRu } from "@/lib/format";
import type { DashboardToday } from "./use-dashboard";

function Mini({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">
        {value} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

/** Rhythm: current streak, records and the last 20 results as a strip. */
export function StreaksPanel({ data, isLoading, fill }: { data: DashboardToday | undefined; isLoading: boolean; fill?: boolean }) {
  if (isLoading && !data) {
    return (
      <Panel title="Серии" icon={Zap} fill={fill}>
        <div className="flex flex-col gap-3" role="status" aria-label="Загрузка">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-6 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </Panel>
    );
  }
  if (!data) return null;
  const s = data.streaks;
  const cur = s.current;
  const isWin = cur.type === "win";
  const isLoss = cur.type === "loss";
  const CurIcon = isLoss ? Snowflake : Flame;

  return (
    <Panel title="Серии" icon={Zap} fill={fill} description={data.scope === "team" ? "По всей команде" : "По вашим сделкам"}>
      <div className="flex flex-1 flex-col gap-4">
        <div className={cn("flex items-center gap-3 rounded-xl p-3", isWin ? "bg-up/10" : isLoss ? "bg-down/10" : "tile")}>
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full",
              isWin ? "bg-up/20 text-up" : isLoss ? "bg-down/20 text-down" : "bg-[var(--glass-hover-bg)] text-muted-foreground",
            )}
          >
            <CurIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Текущая серия</div>
            <div className={cn("text-xl font-semibold tabular-nums", isWin ? "text-up" : isLoss ? "text-down" : "")}>
              {cur.count > 0
                ? `${cur.count} ${isWin ? pluralRu(cur.count, "победа", "победы", "побед") : pluralRu(cur.count, "потеря", "потери", "потерь")} подряд`
                : "Нет серии"}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            {s.recent.length === 1 ? "Последняя сделка" : `Последние ${s.recent.length || 20} ${pluralRu(s.recent.length || 20, "сделка", "сделки", "сделок")}`}
          </div>
          {s.recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">Пока нет закрытых сделок.</p>
          ) : (
            <ol className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1" aria-label="Результаты от старых к новым">
              {s.recent.map((r, i) => (
                <li
                  key={i}
                  title={r === "win" ? "Победа" : r === "loss" ? "Потеря" : "Безубыток"}
                  className={cn("h-6 rounded", r === "win" ? "bg-up/50" : r === "loss" ? "bg-down/55" : "bg-[var(--glass-hover-bg)]")}
                >
                  <span className="sr-only">{r === "win" ? "победа" : r === "loss" ? "потеря" : "безубыток"}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="mt-auto grid grid-cols-3 gap-3">
          <Mini label="Рекорд побед" value={s.bestWin} unit="подряд" />
          <Mini label="Худшая серия" value={s.bestLoss} unit="подряд" />
          <Mini label="Дни в плюсе" value={s.greenDays} unit="подряд" />
        </div>
      </div>
    </Panel>
  );
}
