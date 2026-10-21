/**
 * «Серия из 10» views: the progress strip (one dot per game, coloured by the decision), the «не торгую» verdict (one
 * line + the missed move) and the series summary — traded / correct no-trade / skipped / net R, then the best and
 * the worst decision with a link to replay each, and one big «Ещё серия из 10 (Enter)» (closure).
 */
import * as React from "react";
import { Ban, CheckCircle2, Layers, Play, RotateCcw, SkipForward, ThumbsDown, ThumbsUp, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, StatCard, StatGrid, toneOf, toneText } from "@/components/ds";
import { fmtPrice, fmtR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trainerI18n } from "@/i18n/ns/trainer";
import type { NoTradeVerdict, SeriesResult, SeriesState } from "./series-api";
import { goodShare, progressDots, seriesPos, summaryPicks, type DotKind, type Pick } from "./series-model";
import { useFinePointer } from "./use-fine-pointer";

const DOT: Record<DotKind, string> = {
  win: "bg-up", loss: "bg-down", even: "bg-muted-foreground/60", good: "bg-up ring-2 ring-up/30", miss: "bg-down ring-2 ring-down/30",
  pass: "bg-muted-foreground/60", skip: "border border-dashed border-muted-foreground/60", current: "bg-primary ring-2 ring-primary/30", todo: "bg-[var(--glass-bg)] border border-[var(--glass-border)]",
};

export function SeriesDots({ series, className }: { series: SeriesState; className?: string }) {
  const { t } = trainerI18n.useT();
  const dots = progressDots(series);
  return (
    <ol className={cn("flex items-center gap-1", className)} aria-label={t("series.dotsLabel")}>
      {dots.map((d, i) => (
        <li key={i} className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[d])} title={`${i + 1} · ${t(`series.dot.${d}`)}`}>
          <span className="sr-only">{`${i + 1}: ${t(`series.dot.${d}`)}`}</span>
        </li>
      ))}
    </ol>
  );
}

/** «Игра 3 из 10» + the dots (result column). */
export function SeriesProgress({ series, gameId }: { series: SeriesState; gameId?: number | null }) {
  const { t } = trainerI18n.useT();
  const p = seriesPos(series, gameId);
  return (
    <div className="tile flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-medium"><Layers className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{t("series.progressLabel", { n: p.n, size: p.size })}</p>
      <SeriesDots series={series} />
    </div>
  );
}

/** «Не торгую»: right or a missed move, in one line, with the move measured in R. */
export function NoTradeVerdictCard({ verdict }: { verdict: NoTradeVerdict }) {
  const { t } = trainerI18n.useT();
  const r = fmtR(verdict.bestR, { decimals: 1, signed: false });
  return (
    <div className={cn("tile rounded-xl p-3", verdict.correct ? "ring-1 ring-up/40" : "ring-1 ring-down/40")} role="status">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{t("verdict.title")}</p>
      <p className={cn("mt-1 flex items-start gap-1.5 text-base font-semibold leading-snug", verdict.correct ? "text-up" : "text-down")}>
        {verdict.correct ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        {t(`verdict.${verdict.reasonKey}`, { r })}
      </p>
      {!verdict.correct && (
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">{t("verdict.missed")}: </span>
          {verdict.missed && (
            <span className="tabular-nums">
              <span className={verdict.missed.side === "long" ? "text-up" : "text-down"}>{t(`drill.side.${verdict.missed.side}`)}</span>
              {` ${fmtPrice(verdict.missed.entry)} → ${fmtPrice(verdict.missed.extreme)} · `}
            </span>
          )}
          <span className="font-semibold tabular-nums text-up">{fmtR(verdict.missed?.r ?? verdict.bestR, { decimals: 1 })}</span>
        </p>
      )}
      <p className="mt-1.5 text-2xs text-muted-foreground">{t("verdict.rule")}</p>
    </div>
  );
}

export function outcomeText(r: SeriesResult): string {
  const t = trainerI18n.t;
  if (r.outcome === "skipped") return t("series.outcome.skipped");
  if (r.outcome === "no_trade") return t(r.correct == null ? "series.outcome.noTrade" : r.correct ? "series.outcome.noTradeCorrect" : "series.outcome.noTradeMissed");
  return t("series.outcome.traded", { r: r.r != null ? fmtR(r.r) : "—" });
}

function PickRow({ label, pick, icon: Icon, onReplay }: { label: string; pick: Pick; icon: typeof Trophy; onReplay: (gameId: number) => void }) {
  const { t } = trainerI18n.useT();
  const r = pick.result;
  return (
    <li className="tile flex items-center gap-3 rounded-xl px-3 py-2">
      <Icon className={cn("h-4 w-4 shrink-0", r.outcome === "traded" ? toneText(toneOf(r.r ?? 0)) : r.correct ? "text-up" : "text-down")} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-muted-foreground">{label} · {t("series.gameN", { n: pick.n })}</p>
        <p className="truncate text-sm font-medium">{outcomeText(r)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => onReplay(r.gameId)}><RotateCcw aria-hidden="true" /> {t("series.replay")}</Button>
    </li>
  );
}

export function SeriesSummary({ series, onReplay, onAgain, onHome, starting }: {
  series: SeriesState; onReplay: (gameId: number) => void; onAgain: () => void; onHome: () => void; starting: boolean;
}) {
  const { t } = trainerI18n.useT();
  const fine = useFinePointer();
  const { best, worst } = summaryPicks(series.results);
  const tt = series.totals;
  const share = goodShare(series.results);
  const againRef = React.useRef(onAgain);
  againRef.current = starting ? () => {} : onAgain;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat && !(e.target as HTMLElement | null)?.closest("button,a,input,textarea,select")) {
        e.preventDefault();
        againRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-[var(--grid-gap)]">
      <section className="glass-panel rounded-2xl p-[var(--panel-p)]" aria-labelledby="series-summary-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="series-summary-title" className="flex items-center gap-2 text-base font-semibold"><Trophy className="h-4 w-4 text-warn" aria-hidden="true" />{t("series.summary.title")}</h2>
          <SeriesDots series={series} />
        </div>
        <p className={cn("mt-3 text-3xl font-semibold tabular-nums leading-tight", toneText(toneOf(tt.netR)))}>{fmtR(tt.netR)}</p>
        <p className="text-xs text-muted-foreground">
          {t("series.summary.netR")}{share != null ? ` · ${t("series.summary.good", { value: Math.round(share * 100) })}` : ""}
        </p>
        <StatGrid cols={3} min="8rem" className="mt-3">
          <StatCard label={t("series.summary.traded")} value={String(tt.traded)} icon={Play} />
          <StatCard label={t("series.summary.noTrade")} value={t("series.summary.noTradeValue", { correct: tt.correctNoTrade, total: tt.noTrade })} icon={Ban} tone={tt.noTrade > 0 && tt.correctNoTrade === tt.noTrade ? "up" : "neutral"} />
          <StatCard label={t("series.summary.skipped")} value={String(tt.skipped)} icon={SkipForward} />
        </StatGrid>
        <ul className="mt-3 flex flex-col gap-2">
          {best && <PickRow label={t("series.summary.best")} pick={best} icon={ThumbsUp} onReplay={onReplay} />}
          {worst ? <PickRow label={t("series.summary.worst")} pick={worst} icon={ThumbsDown} onReplay={onReplay} /> : (
            series.results.length > 0 && <li className="flex items-center gap-1.5 px-1 text-sm text-up"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t("series.summary.noWorst")}</li>
          )}
        </ul>
      </section>
      <Button size="lg" className="min-h-12" onClick={onAgain} disabled={starting}>
        <Layers aria-hidden="true" /> {t("series.summary.again")} {fine && <Kbd className="border-white/30 bg-white/10 text-white/90">Enter</Kbd>}
      </Button>
      <Button variant="ghost" className="self-center" onClick={onHome}>{t("series.summary.toHome")}</Button>
    </div>
  );
}
