/**
 * Cheat sheet of one setup — read top to bottom in one glance: name + time window + own edge / mastery; the picture
 * row (the schematic | a REAL example chart with the entry / exit marked — example-chart.tsx; no example → the
 * schematic, larger); Вход / Стоп / Цель / Отмена as large rows; «Грейд A, если»; the live checklist with its grade;
 * the size calculator (cheat-parts.tsx). Details (description, examples, stats, history) come in as `children`,
 * collapsed under «Подробнее». The card is a size container: narrow (a column of the plan, the quick sheet, a phone)
 * it is one column; wide it splits the rules | the checklist. No text is clipped anywhere.
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Lock, Star, X } from "lucide-react";
import { Pill } from "@/components/ds";
import { SetupMasteryChip } from "@/components/shared/mastery-chip";
import { gamificationMeQuery } from "@/lib/api/queries";
import type { PlaybookToday, TodaySetup } from "@/lib/playbook-today/types";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { CheatLines, GradeABullets, LiveChecklist, SizeCalc } from "./cheat-parts";
import { ExampleChart, ExampleChartSkeleton, useExampleChart } from "./example-chart";
import { SetupSchema } from "./schema-art";
import type { Grade } from "./today-model";
import { edgeChip, edgeDetail, timeText, unlockText, windowLabel } from "./today-text";

/** Own mastery of the setup (gamification, level 0–4); nothing when the API has none or the setup is missing. */
function CardMastery({ setupId }: { setupId: number }) {
  const m = useQuery(gamificationMeQuery()).data?.mastery?.find((x) => x.setupId === setupId);
  return m ? <SetupMasteryChip mastery={m} size="xs" /> : null;
}

/** The schematic next to the real example; without an example the schematic alone, larger. */
function PictureRow({ setup, withExample, onLeave }: { setup: TodaySetup; withExample: boolean; onLeave?: () => void }) {
  const { t } = playbookTodayI18n.useT();
  const chart = useExampleChart(setup.id, withExample && setup.schema !== "routine");
  const schematic = (big: boolean) => (
    <figure className={cn("m-0 flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2", big ? "py-3" : "")}>
      <SetupSchema schema={setup.schema} className={cn("h-auto w-full", big ? "max-w-[340px]" : "max-w-[260px]")} />
      <figcaption className="text-xs text-muted-foreground">{t("example.schematic")}</figcaption>
    </figure>
  );
  if (chart.state === "none") return setup.schema ? schematic(true) : null;
  return (
    <div className="grid min-w-0 items-stretch gap-2 @lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      {setup.schema ? <div className="hidden @lg:flex">{schematic(false)}</div> : <span className="hidden @lg:block" />}
      {chart.state === "loading" || !chart.ex || !chart.view ? <ExampleChartSkeleton /> : <ExampleChart ex={chart.ex} view={chart.view} onOpen={onLeave} />}
      {setup.schema && <div className="@lg:hidden">{schematicSmall(setup.schema, t("example.schematic"))}</div>}
    </div>
  );
}

/** Phones / narrow cards: the schematic as a compact strip under the chart (the chart goes full width first). */
function schematicSmall(schema: string, caption: string) {
  return (
    <span className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5">
      <SetupSchema schema={schema} className="h-[54px] w-[90px]" />
      <span className="text-xs text-muted-foreground">{caption}</span>
    </span>
  );
}

export function CheatCard({
  setup, oneR, date, picked, canPick, onTogglePick, onClose, actions, children, className, narrow, showEdge = true, withExample = true, onLeave,
}: {
  setup: TodaySetup;
  oneR: PlaybookToday["oneR"];
  date: string;
  picked?: boolean;
  /** Show the «На сегодня» toggle (traders with a plan). */
  canPick?: boolean;
  onTogglePick?: () => void;
  onClose?: () => void;
  /** Extra header actions (e.g. «Открыть в плейбуке»). */
  actions?: ReactNode;
  /** Collapsed details for preparation (shown under «Подробнее»). */
  children?: ReactNode;
  className?: string;
  /** Always one column (the quick sheet). */
  narrow?: boolean;
  /** The viewer's own edge chip (traders; staff have no own record). */
  showEdge?: boolean;
  /** The real example chart in the picture row (off in tests / where the network is not wanted). */
  withExample?: boolean;
  /** The card links away (the example's desk day): a sheet closes itself. */
  onLeave?: () => void;
}) {
  const { t } = playbookTodayI18n.useT();
  const [grade, setGrade] = useState<Grade | null>(null);
  const [open, setOpen] = useState(false);
  const chip = edgeChip(setup.myEdge);
  return (
    <article className={cn("@container glass-panel flex min-w-0 flex-col gap-4 rounded-2xl", className ?? "p-[var(--panel-p)]")} aria-labelledby={`pb-cheat-${setup.id}`} data-setup-id={setup.id}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[min(100%,14rem)] flex-1">
          <h2 id={`pb-cheat-${setup.id}`} className="text-lg font-semibold leading-tight tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-xl">{setup.name}</h2>
          <p className="mt-1 text-sm text-foreground/80">{[windowLabel(setup.window), timeText(setup)].filter(Boolean).join(" · ")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {showEdge && <Pill tone={chip.tone} title={edgeDetail(setup.myEdge)} className="h-auto max-w-full whitespace-normal py-1 text-left leading-tight">{chip.text}</Pill>}
            {setup.locked && <Pill tone="warn"><Lock aria-hidden="true" /> {t("list.locked")}</Pill>}
            <CardMastery setupId={setup.id} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canPick && !setup.locked && onTogglePick && (
            <button
              type="button"
              aria-pressed={!!picked}
              onClick={onTogglePick}
              title={picked ? t("picks.remove", { name: setup.name }) : t("picks.add", { name: setup.name })}
              className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", picked ? "border-warn/50 bg-warn/12 text-warn" : "border-[var(--field-border)] text-foreground/85 hover:text-foreground")}
            >
              <Star className={cn("h-4 w-4", picked && "fill-current")} aria-hidden="true" />
              {picked ? t("card.picked") : t("card.pick")}
            </button>
          )}
          {actions}
          {onClose && (
            <button type="button" onClick={onClose} aria-label={t("card.close")} title={t("card.close")} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {setup.locked && (
        <p className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span>{t("lock.noteCard", { text: unlockText(setup) })}</span>
        </p>
      )}

      <PictureRow setup={setup} withExample={withExample} onLeave={onLeave} />

      <div className={cn("grid min-w-0 gap-4", !narrow && "@3xl:grid-cols-2 @3xl:gap-6")}>
        <section className="flex min-w-0 flex-col gap-3">
          <CheatLines setup={setup} />
          <GradeABullets items={setup.cheat.gradeA} />
        </section>
        <section className="flex min-w-0 flex-col gap-4">
          <LiveChecklist setup={setup} date={date} onGrade={setGrade} />
          <div className="border-t border-[var(--glass-border)] pt-3">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("card.size")}</h3>
            <SizeCalc setupId={setup.id} oneR={oneR} grade={grade} date={date} />
          </div>
        </section>
      </div>

      {children && (
        <div className="border-t border-[var(--glass-border)] pt-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
            {open ? t("card.hideDetails") : t("card.details")}
          </button>
          {open && <div className="mt-3">{children}</div>}
        </div>
      )}
    </article>
  );
}
