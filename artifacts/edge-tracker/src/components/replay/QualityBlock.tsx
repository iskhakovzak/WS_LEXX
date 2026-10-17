import * as React from "react";
import { AlertTriangle, Info, RotateCw } from "lucide-react";
import type { Trade } from "@workspace/api-client-react";
import { Pill, Segmented, toneOf, toneText, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPrice, fmtR } from "@/components/trades/trade-utils";
import { fmtDuration, fmtEtTimeSec } from "@/components/trade-chart-parts/chart-utils";
import { useTradeQuality } from "./hooks";
import { AFTER_EXIT_OPTIONS, DEFAULT_AFTER_EXIT, REASON_LABEL, type Excursion, type TradeQuality } from "./types";

const AFTER_EXIT_KEY = "ws.trades.quality.afterExit";

export function useAfterExitMinutes(): [number, (n: number) => void] {
  const [v, setV] = React.useState<number>(() => {
    try {
      const raw = Number(window.localStorage.getItem(AFTER_EXIT_KEY));
      return (AFTER_EXIT_OPTIONS as readonly number[]).includes(raw) ? raw : DEFAULT_AFTER_EXIT;
    } catch { return DEFAULT_AFTER_EXIT; }
  });
  const set = React.useCallback((n: number) => {
    setV(n);
    try { window.localStorage.setItem(AFTER_EXIT_KEY, String(n)); } catch { /* storage unavailable */ }
  }, []);
  return [v, set];
}

export function fmtPctSigned(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

/** Legacy minute formatter (kept for callers outside this file); new code prefers fmtDuration(seconds). */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  return fmtDuration(min * 60);
}

/** Seconds from entry to the excursion: v2 carries them, v1 cache rows only whole minutes. */
function excSeconds(e: Excursion): number {
  return e.seconds != null && Number.isFinite(e.seconds) ? e.seconds : e.minutes * 60;
}

/** «через 1 мин 11 с» / «в момент входа» / «в момент выхода». */
function whenText(seconds: number, atFill: "entry" | "exit" | null): string {
  if (atFill === "entry") return "в момент входа";
  if (atFill === "exit") return "в момент выхода";
  return `через ${fmtDuration(seconds)}`;
}

/** Tone for exit efficiency: ≥0.6 good, 0.3–0.6 so-so, below — poor; negative — the exit lost more than the move gave. */
export function exitEffTone(e: number | null | undefined): Tone {
  if (e == null) return "neutral";
  if (e >= 0.6) return "up";
  if (e >= 0.3) return "warn";
  return "down";
}

function Big({ label, value, sub, tone = "neutral", explain, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; explain: string; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-2xl bg-[var(--glass-bg)] px-3.5 py-3", className)} title={explain}>
      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">{label}<Info className="h-3 w-3 opacity-60" aria-hidden="true" /></p>
      <p className={cn("mt-0.5 truncate text-xl font-semibold tabular-nums tracking-tight", toneText(tone))}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-2xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Small({ label, value, tone = "neutral", explain }: { label: string; value: React.ReactNode; tone?: Tone; explain: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--glass-bg)] px-2.5 py-1 text-xs" title={explain}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", toneText(tone))}>{value}</span>
    </span>
  );
}

const perShareText = (v: number, sign = 1) => `${sign * v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}/акц.`;

function rAndUsd(r: number | null, usd: number | null, perShare: number, sign = 1): string {
  const parts: string[] = [];
  if (r != null) parts.push(fmtR(sign * r));
  if (usd != null) parts.push(fmtMoney(sign * usd));
  if (!parts.length) parts.push(perShareText(perShare, sign));
  return parts.join(" · ");
}

/** Headline value of an excursion: R when a stop exists, else $ of the position, else $/share. */
function excValue(e: Excursion, sign: 1 | -1): string {
  if (e.r != null) return fmtR(sign * e.r);
  if (e.usd != null) return fmtMoney(sign * e.usd);
  return perShareText(e.perShare, sign);
}

export function QualitySummaryLine({ q }: { q: TradeQuality }) {
  if (q.status === "unavailable" || !q.mfe) return null;
  const eff = q.exitEfficiency;
  const capturedR = q.captured?.r;
  const mfeR = q.mfe.r;
  const text = eff == null
    ? "Позиция ещё открыта — эффективность выхода появится после закрытия."
    : eff < 0
      ? `Выход хуже входа: цена давала ${mfeR != null ? fmtR(mfeR) : q.mfe.usd != null ? fmtMoney(q.mfe.usd) : `$${q.mfe.perShare.toFixed(2)}/акц.`} в плюс, но сделка закрыта в минус.`
      : `Вы забрали ${fmtPctSigned(eff)} движения: ${mfeR != null && capturedR != null ? `${fmtR(capturedR)} из ${fmtR(mfeR)} доступных` : q.captured?.usd != null && q.mfe.usd != null ? `${fmtMoney(q.captured.usd)} из ${fmtMoney(q.mfe.usd)} доступных` : `$${(q.captured?.perShare ?? 0).toFixed(2)} из $${q.mfe.perShare.toFixed(2)} на акцию`}.`;
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

const PARTIAL_BAR_NOTE = "Бары входа и выхода учитываются частично: внутри бара известен только путь «открытие → цена исполнения → закрытие», поэтому минимум/максимум, напечатанные до входа или после выхода, не считаются.";

export function QualityBlock({ trade, afterExit, onAfterExitChange, compact }: { trade: Trade; afterExit: number; onAfterExitChange?: (n: number) => void; compact?: boolean }) {
  const { data, isLoading, error, refresh, isFetching } = useTradeQuality(trade.id, afterExit);
  const [refreshing, setRefreshing] = React.useState(false);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }
  if (error || !data) {
    const status = (error as Error & { status?: number } | null)?.status;
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-[var(--glass-bg)] px-3.5 py-3 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--chart-3))]" aria-hidden="true" />
        {status === 404 ? "Эндпоинт качества исполнения ещё не подключён на сервере." : `Не удалось посчитать качество исполнения${error ? `: ${(error as Error).message}` : ""}.`}
      </div>
    );
  }

  const q = data.quality;
  const short = q.side === "short";
  const dirWord = short ? "вниз" : "вверх";

  if (q.status === "unavailable") {
    return (
      <div className="space-y-2 rounded-2xl bg-[var(--glass-bg)] px-3.5 py-3 text-sm">
        <p className="flex items-center gap-2 text-muted-foreground"><AlertTriangle className="h-4 w-4 text-[hsl(var(--chart-3))]" aria-hidden="true" /> Качество исполнения недоступно.</p>
        <ul className="list-disc pl-5 text-xs text-muted-foreground">{q.reasons.map((r) => <li key={r}>{REASON_LABEL[r]}</li>)}</ul>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }}>
          <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Пересчитать
        </Button>
      </div>
    );
  }

  const mfe = q.mfe, mae = q.mae;
  const timed = q.timedFills === true || (q.timedFills == null && q.placement === "time");
  const hasStop = q.riskPerShare != null && q.riskSource === "stop";
  const holdSeconds = q.holdSeconds != null ? q.holdSeconds : q.holdMinutes != null ? q.holdMinutes * 60 : null;
  const atFill = (e: Excursion | null): "entry" | "exit" | null => {
    if (!e || !timed) return null;
    if (q.entryAt != null && e.at === q.entryAt) return "entry";
    if (q.exitAt != null && e.at === q.exitAt) return "exit";
    return null;
  };
  const capturedTone: Tone = q.captured ? toneOf(q.captured.perShare) : q.unrealised ? toneOf(q.unrealised.perShare) : "neutral";
  const warnReasons = q.reasons.filter((r) => r !== "atr_from_day_range");
  const heatWorkedAt = q.heat ? (q.heat.workedAtSeconds != null ? q.heat.workedAtSeconds : q.heat.workedAtMinutes != null ? q.heat.workedAtMinutes * 60 : null) : null;
  const windowTitle = `Свечи: ${q.interval}, ${q.barsUsed} баров${data.window ? ` · ${data.window.from}${data.window.to !== data.window.from ? ` → ${data.window.to}` : ""}` : ""}${timed ? `\n${PARTIAL_BAR_NOTE}` : "\nИсполнения без времени: бары входа и выхода считаются целиком."}`;

  return (
    <div className="@container space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <QualitySummaryLine q={q} />
        <div className="ml-auto flex items-center gap-2">
          {q.status === "partial" && <Pill tone="warn" className="px-1.5 text-2xs">частично</Pill>}
          <span className="text-2xs text-muted-foreground" title={windowTitle}>
            {q.interval} · {q.barsUsed} бар.{timed ? " · по времени исполнений" : ""}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Пересчитать" title="Пересчитать по свежим свечам" disabled={refreshing || isFetching} onClick={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }}>
            <RotateCw className={cn("h-3.5 w-3.5", (refreshing || isFetching) && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className={cn("grid grid-cols-2 gap-2", compact ? "sm:grid-cols-4" : "@lg:grid-cols-3 @4xl:grid-cols-5")}>
        <Big
          label="MFE"
          value={mfe ? excValue(mfe, 1) : "—"}
          sub={mfe ? `${mfe.r != null && mfe.usd != null ? `${fmtMoney(mfe.usd)} · ` : mfe.usd != null ? `$${mfe.perShare.toFixed(2)}/акц. · ` : ""}до ${fmtPrice(mfe.price)} ${whenText(excSeconds(mfe), atFill(mfe))}` : undefined}
          tone="up"
          explain={`Максимальное движение в вашу сторону (${dirWord}) от средней цены входа до выхода. Сколько сделка «давала» в лучший момент. ${timed ? PARTIAL_BAR_NOTE : ""}`}
        />
        <Big
          label="MAE"
          value={mae ? excValue(mae, -1) : "—"}
          sub={mae ? `${mae.r != null && mae.usd != null ? `${fmtMoney(-mae.usd)} · ` : mae.usd != null ? `−$${mae.perShare.toFixed(2)}/акц. · ` : ""}${mae.perShare > 0 ? `до ${fmtPrice(mae.price)} ${whenText(excSeconds(mae), atFill(mae))}` : "цена не ходила против позиции"}${q.gaps?.count ? " · с гэпом" : ""}` : undefined}
          tone={mae && mae.perShare > 0 ? "down" : "neutral"}
          explain={`Максимальное движение против позиции (просадка) до выхода. Если был овернайт-гэп, он включён.${hasStop ? " Сравните со стопом: MAE > 1R означает, что стоп должен был сработать." : ""} ${timed ? PARTIAL_BAR_NOTE : ""}`}
        />
        <Big
          label="Эффективность выхода"
          value={fmtPctSigned(q.exitEfficiency)}
          sub={q.captured ? `забрали ${rAndUsd(q.captured.r, q.captured.usd, q.captured.perShare)}` : q.unrealised ? `открыто: ${rAndUsd(q.unrealised.r, q.unrealised.usd, q.unrealised.perShare)}` : undefined}
          tone={q.exitEfficiency == null ? capturedTone : exitEffTone(q.exitEfficiency)}
          explain="Захваченное движение / MFE. 100% — вышли на самом лучшем баре; 50% — забрали половину того, что давал рынок; меньше 0 — закрылись в минус, хотя плюс был."
        />
        <Big
          label={`Оставили на столе (${q.leftOnTable?.windowMinutes ?? afterExit} мин)`}
          value={q.leftOnTable ? (q.leftOnTable.r != null ? fmtR(q.leftOnTable.r) : q.leftOnTable.usd != null ? fmtMoney(q.leftOnTable.usd) : `$${q.leftOnTable.perShare.toFixed(2)}/акц.`) : "—"}
          sub={q.leftOnTable ? `${q.leftOnTable.r != null && q.leftOnTable.usd != null ? `${fmtMoney(q.leftOnTable.usd)} · ` : q.leftOnTable.usd != null ? `$${q.leftOnTable.perShare.toFixed(2)}/акц. · ` : ""}лучшая ${fmtPrice(q.leftOnTable.bestPrice)}${q.leftOnTable.toCloseOfDay != null && q.leftOnTable.toCloseOfDay > q.leftOnTable.perShare ? ` · до закрытия $${q.leftOnTable.toCloseOfDay.toFixed(2)}` : ""}` : q.reasons.includes("no_bars_after_exit") ? "после выхода баров нет" : q.captured == null ? "позиция открыта" : "0 — вышли на максимуме окна"}
          tone={q.leftOnTable ? (q.leftOnTable.r != null ? (q.leftOnTable.r >= 1 ? "down" : q.leftOnTable.r >= 0.5 ? "warn" : "up") : q.captured && q.captured.perShare > 0 && q.leftOnTable.perShare > q.captured.perShare ? "warn" : "neutral") : "neutral"}
          explain="Насколько цена ушла дальше в вашу сторону после выхода в заданном окне (от момента выхода). Большое значение при раннем выходе — сигнал держать по плану, а не по эмоциям."
        />
        <Big
          label={q.heat?.threshold === "1R" ? "Нагрев до +1R" : "Нагрев до пика"}
          value={q.heat ? (q.heat.r != null ? fmtR(-q.heat.r) : q.heat.usd != null ? fmtMoney(-q.heat.usd) : `−$${q.heat.perShare.toFixed(2)}/акц.`) : "—"}
          sub={q.heat
            ? q.heat.threshold === "1R"
              ? (heatWorkedAt != null ? `+1R через ${fmtDuration(heatWorkedAt)}` : "сделка не дошла до +1R")
              : (heatWorkedAt != null ? `пик (MFE) через ${fmtDuration(heatWorkedAt)}` : mfe && mfe.perShare > 0 ? "до момента MFE" : "в плюс не ходила")
            : undefined}
          tone={q.heat ? (q.heat.r != null ? (q.heat.r >= 0.8 ? "down" : q.heat.r >= 0.4 ? "warn" : "up") : q.heat.perShare > 0 ? "warn" : "neutral") : "neutral"}
          explain={q.heat?.threshold === "1R"
            ? "Максимальная просадка до того, как сделка пошла в плюс на 1R. Показывает, сколько приходилось «терпеть» на правильных идеях."
            : "Стоп не задан, поэтому порог — лучшая точка сделки (MFE): максимальная просадка до того, как цена дошла до пика."}
          className={compact ? "hidden" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Small label="Вход в баре" value={fmtPctSigned(q.entryEfficiency)} tone={q.entryEfficiency == null ? "neutral" : q.entryEfficiency >= 0.6 ? "up" : q.entryEfficiency >= 0.35 ? "warn" : "down"} explain="Где цена входа внутри диапазона бара входа: 100% — купили на минимуме бара (продали на максимуме), 0% — на худшей цене бара." />
        <Small label="Выход в диапазоне" value={fmtPctSigned(q.rangeEfficiency)} tone={q.rangeEfficiency == null ? "neutral" : q.rangeEfficiency >= 0.6 ? "up" : q.rangeEfficiency >= 0.35 ? "warn" : "down"} explain="Положение средней цены выхода внутри всего диапазона сделки (вход → выход): 100% — лучшая цена периода, 0% — худшая." />
        {q.stopAtr && <Small label="Стоп в ATR" value={`${q.stopAtr.distanceAtr.toFixed(2)}×`} tone={q.stopAtr.distanceAtr < 0.3 ? "down" : q.stopAtr.distanceAtr < 0.6 ? "warn" : "neutral"} explain={`Расстояние до стопа в ATR (${q.stopAtr.source === "dayRange" ? "ATR = диапазон дня сделки" : "ATR из карточки сделки"}). Меньше 0.3 ATR — стоп внутри шума.`} />}
        {mfe && mfe.perShare > 0 && <Small label="Время до MFE" value={whenText(excSeconds(mfe), atFill(mfe)).replace(/^через /, "")} explain="Через сколько после входа цена достигла лучшей точки." />}
        {holdSeconds != null && <Small label="В позиции" value={fmtDuration(holdSeconds)} explain={timed ? `От первого входа до последнего выхода по времени исполнений${q.entryAt != null && q.exitAt != null ? ` (${fmtEtTimeSec(q.entryAt)} → ${fmtEtTimeSec(q.exitAt)} ET)` : ""}.` : "Время от первого входа до последнего выхода по барам (исполнения без времени)."} />}
        {q.gaps?.count ? <Small label="Гэпы" value={`${q.gaps.count} · худший ${q.gaps.worstR != null ? fmtR(q.gaps.worstR) : `$${(q.gaps.worstPerShare ?? 0).toFixed(2)}`}`} tone={q.gaps.worstPerShare != null && q.gaps.worstPerShare < 0 ? "down" : "up"} explain="Овернайт-гэпы внутри сделки: открытие следующего дня относительно закрытия предыдущего, в вашу сторону (+) или против (−)." /> : null}
        {q.avgEntry != null && q.fillsUsed > 2 && <Small label="Ср. вход / выход" value={`${fmtPrice(q.avgEntry)} → ${q.avgExit != null ? fmtPrice(q.avgExit) : "—"}`} explain="Средние цены по всем исполнениям (доборы и частичные выходы учтены)." />}
        {onAfterExitChange && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            окно после выхода
            <Segmented size="sm" ariaLabel="Окно после выхода" value={String(afterExit)} onChange={(v) => onAfterExitChange(Number(v))} options={AFTER_EXIT_OPTIONS.map((n) => ({ value: String(n), label: `${n}м` }))} />
          </span>
        )}
      </div>

      {warnReasons.length > 0 && (
        <p className="text-2xs text-muted-foreground">
          {warnReasons.map((r) => REASON_LABEL[r]).join(" · ")}
        </p>
      )}
    </div>
  );
}
