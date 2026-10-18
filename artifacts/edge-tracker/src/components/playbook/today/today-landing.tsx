/**
 * «Сегодня» landing pieces under the plan («Все сетапы дня»): «Где у тебя преимущество» (own edge summary) and the
 * setups grouped by window (own edge chip, lock with its unlock condition, a star to take it for today). Every name and
 * line wraps — nothing is cut with an ellipsis (owner: «текст чтобы не скрывался»).
 */
import { Lock, Star, TrendingUp } from "lucide-react";
import { Pill, toneText } from "@/components/ds";
import type { PlaybookToday, TodaySetup } from "@/lib/playbook-today/types";
import { fmtR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { SetupSchema } from "./schema-art";
import { edgeSummary, isTradeable, windowPhases, windowSetups, type WindowPhase } from "./today-model";
import { edgeChip, edgeDetail, timeText, unlockText, windowLabel } from "./today-text";

/* ── own edge ───────────────────────────────────────────────────────────── */

function SetupChip({ s, onOpen }: { s: TodaySetup; onOpen: (id: number) => void }) {
  const r = s.myEdge?.avgR ?? null;
  return (
    <button
      type="button"
      onClick={() => onOpen(s.id)}
      title={edgeDetail(s.myEdge)}
      className="inline-flex min-h-9 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-2xl border border-[var(--field-border)] bg-[var(--glass-bg)] px-3 py-1 text-left text-sm hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">{s.name}</span>
      {r != null && <span className={cn("shrink-0 tabular-nums", toneText(r > 0 ? "up" : r < 0 ? "down" : "neutral"))}>{fmtR(r)}</span>}
      {s.myEdge && <span className="shrink-0 tabular-nums text-muted-foreground">· {s.myEdge.trades}</span>}
    </button>
  );
}

export function EdgeSummaryPanel({ setups, onOpen }: { setups: TodaySetup[]; onOpen: (id: number) => void }) {
  const { t } = playbookTodayI18n.useT();
  const sum = edgeSummary(setups);
  const empty = !sum.strong.length && !sum.careful.length;
  return (
    <section aria-labelledby="pb-edge-h" className="glass-panel min-w-0 rounded-2xl p-[var(--panel-p)]">
      <h2 id="pb-edge-h" className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-foreground">
        <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> {t("edge.title")}
      </h2>
      {empty ? (
        <p className="text-sm text-foreground/80">{t("edge.none")}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {sum.strong.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-up">{t("edge.strongTitle")}</span>
              <div className="flex flex-wrap gap-1.5">{sum.strong.map((s) => <SetupChip key={s.id} s={s} onOpen={onOpen} />)}</div>
            </div>
          )}
          {sum.careful.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-down">{t("edge.carefulTitle")}</span>
              <div className="flex flex-wrap gap-1.5">{sum.careful.map((s) => <SetupChip key={s.id} s={s} onOpen={onOpen} />)}</div>
            </div>
          )}
          {sum.fresh > 0 && <p className="text-sm text-foreground/75">{t("edge.fresh", { count: sum.fresh })}</p>}
        </div>
      )}
    </section>
  );
}

/* ── setups by window ───────────────────────────────────────────────────── */

const PHASE_TONE: Record<WindowPhase, "accent" | "neutral"> = { now: "accent", next: "accent", past: "neutral", later: "neutral" };

function SetupRow({ s, picked, canPick, onOpen, onTogglePick }: { s: TodaySetup; picked: boolean; canPick: boolean; onOpen: (id: number) => void; onTogglePick: (id: number) => void }) {
  const { t } = playbookTodayI18n.useT();
  const chip = edgeChip(s.myEdge);
  return (
    <li className={cn("flex min-w-0 items-center gap-1 rounded-xl transition-colors hover:bg-[var(--tile-hover-bg)]", s.locked && "opacity-75")}>
      <button
        type="button"
        onClick={() => onOpen(s.id)}
        aria-label={t("list.open", { name: s.name })}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="hidden shrink-0 self-start rounded-lg bg-[var(--glass-bg)] p-0.5 min-[400px]:block">
          <SetupSchema schema={s.schema} className="h-10 w-[66px]" title="" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">{s.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground/75">
            {s.locked ? (
              <span className="min-w-0"><Lock className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-warn" aria-hidden="true" />{unlockText(s)}</span>
            ) : (
              <span className="tabular-nums">{timeText(s)}</span>
            )}
            {canPick && !s.locked && isTradeable(s) && (
              <Pill tone={chip.tone} title={edgeDetail(s.myEdge)} className="h-auto max-w-full whitespace-normal py-1 text-left leading-tight">
                {chip.text}
              </Pill>
            )}
          </span>
        </span>
      </button>
      {canPick && !s.locked && isTradeable(s) && (
        <button
          type="button"
          aria-pressed={picked}
          onClick={() => onTogglePick(s.id)}
          aria-label={picked ? t("picks.remove", { name: s.name }) : t("picks.add", { name: s.name })}
          title={picked ? t("picks.remove", { name: s.name }) : t("picks.add", { name: s.name })}
          className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", picked ? "text-warn" : "text-muted-foreground hover:text-foreground")}
        >
          <Star className={cn("h-4 w-4", picked && "fill-current")} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function WindowList({
  today, now, draft, canPick, onOpen, onTogglePick,
}: {
  today: PlaybookToday;
  now: number;
  draft: number[];
  canPick: boolean;
  onOpen: (id: number) => void;
  onTogglePick: (id: number) => void;
}) {
  const { t } = playbookTodayI18n.useT();
  const phases = windowPhases(today.windows, now);
  return (
    <section aria-label={t("list.aria")} className="flex min-w-0 flex-col gap-[var(--grid-gap)]">
      {today.windows.map((w) => {
        const list = windowSetups(today, w);
        const phase = phases[w.key];
        return (
          <section key={w.key} id={`pb-window-${w.key}`} aria-labelledby={`pb-window-h-${w.key}`} className={cn("glass-panel min-w-0 scroll-mt-24 rounded-2xl p-[var(--panel-p)]", phase === "past" && "opacity-80")}>
            <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id={`pb-window-h-${w.key}`} className="text-[15px] font-semibold text-foreground">{windowLabel(w.key)}</h3>
              <span className="text-sm tabular-nums text-foreground/70">{w.from}–{w.to}</span>
              {phase && <Pill tone={PHASE_TONE[phase]} className="ml-auto">{t(`phase.${phase}`)}</Pill>}
            </header>
            {list.length === 0 ? (
              <p className="px-2 py-1 text-sm text-foreground/70">{t("list.emptyWindow")}</p>
            ) : (
              <ul className="-mx-1 flex flex-col gap-0.5">
                {list.map((s) => <SetupRow key={s.id} s={s} picked={draft.includes(s.id)} canPick={canPick} onOpen={onOpen} onTogglePick={onTogglePick} />)}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}
