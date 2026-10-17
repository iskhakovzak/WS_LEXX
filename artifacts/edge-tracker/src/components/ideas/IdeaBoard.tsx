import { Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import { IdeaCard } from "./IdeaCard";
import { STAGES, type IdeaTracking, type Stage, type TradeIdea } from "./model";

const EMPTY_COPY: Record<Stage, string> = {
  draft: "Нет черновиков. Нажмите N, чтобы набросать идею.",
  review: "Очередь ревью пуста.",
  active: "Нет активных идей.",
  won: "Пока ничего не сработало.",
  lost: "Нет закрытых по стопу.",
  rejected: "",
};

/** Kanban-style pipeline: Черновик → На ревью → Активна → Сработала / Не сработала (+ Отклонена when present). */
export function IdeaBoard({
  groups,
  tracking,
  onOpen,
  query,
  selectedId,
}: {
  groups: Record<Stage, TradeIdea[]>;
  tracking: Record<string, IdeaTracking>;
  onOpen: (i: TradeIdea) => void;
  query: string;
  selectedId: number | null;
}) {
  const lanes = STAGES.filter((s) => s.key !== "rejected" || groups.rejected.length > 0);
  return (
    <div
      className={cn(
        "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2",
        lanes.length === 5 ? "xl:grid xl:grid-cols-5 xl:overflow-visible" : "2xl:grid 2xl:grid-cols-6 2xl:overflow-visible",
      )}
      role="list"
      aria-label="Воронка идей по статусам"
    >
      {lanes.map((lane) => {
        const items = groups[lane.key];
        return (
          <section
            key={lane.key}
            role="listitem"
            aria-label={`${lane.label}: ${items.length}`}
            className={cn(
              "flex w-[80vw] max-w-[320px] shrink-0 snap-start flex-col gap-2 sm:w-[300px]",
              lanes.length === 5 ? "xl:w-auto xl:min-w-0 xl:max-w-none" : "2xl:w-auto 2xl:min-w-0 2xl:max-w-none",
            )}
          >
            <header className="flex items-center justify-between gap-2 px-1" title={lane.hint}>
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Pill tone={lane.tone} dot className="px-1.5"><span className="sr-only">{lane.label}</span></Pill>
                {lane.label}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {items.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  stage={lane.key}
                  tracking={tracking[String(idea.id)]}
                  onOpen={onOpen}
                  query={query}
                  selected={selectedId === idea.id}
                />
              ))}
              {items.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--field-border)] px-3 py-6 text-center text-xs text-muted-foreground">
                  {EMPTY_COPY[lane.key] || "Пусто"}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
