/**
 * «Профиль трейдера» — верх страницы «Поведение»: стиль (скальпер / интрадей / свинг), лучшие и худшие часы,
 * лучшие и худшие сетапы (сделка → иначе авто-классификатор), стоимость плохих привычек ($, без двойного
 * счёта, по месяцам) и индекс дисциплины с трендом (30 дней против предыдущих).
 */
import * as React from "react";
import { Clock, Gauge, Layers, Wallet, Zap } from "lucide-react";
import { Delta, Pill, ProgressRing, Tile, toneOf, toneText, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PATTERN_SHORT, PATTERN_TONE, fmtMinutes, fmtPct, fmtUsd, fmtUsdCompact, monthLabel, pluralDays, pluralTrades,
  type BehaviorReport, type Bucket, type ProfileBucket, type TraderProfile,
} from "./api";

/** Метка часа из движка («10» → «10:00–11:00»). */
export function hourLabel(label: string): string {
  if (label === "до 9:30") return "до 9:30";
  if (label === "9:30") return "9:30–10:00";
  if (label === "16+") return "после 16:00";
  const h = Number(label);
  return Number.isFinite(h) ? `${h}:00–${h + 1}:00` : label;
}

function disciplineTone(v: number | null | undefined): Tone {
  if (v == null) return "neutral";
  return v >= 85 ? "up" : v >= 65 ? "warn" : "down";
}

function TileHead({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function BucketLine({ kind, b, label, auto }: { kind: "best" | "worst"; b: Bucket | ProfileBucket | null; label: string; auto?: boolean }) {
  if (!b) return <div className="text-xs text-muted-foreground">{kind === "best" ? "Лучший" : "Худший"}: мало данных</div>;
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{kind === "best" ? "Лучший" : "Худший"}</div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground" title={label}>{label}</span>
          {auto && <Pill tone="neutral" title="Часть сделок размечена авто-классификатором (не принято в сделку)">авто</Pill>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn("text-sm font-semibold tabular-nums", toneText(toneOf(b.net)))}>{fmtUsd(b.net, { digits: 0 })}</div>
        <div className="text-xs tabular-nums text-muted-foreground">{pluralTrades(b.n)} · ср. {fmtUsdCompact(b.avgNet)}</div>
      </div>
    </div>
  );
}

function StyleTile({ s }: { s: TraderProfile["style"] }) {
  return (
    <Tile className="flex flex-col gap-2 lg:col-span-3">
      <TileHead icon={Zap}>Стиль</TileHead>
      <div className="text-xl font-semibold text-foreground">{s.label}</div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
      <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div><dt className="text-muted-foreground">Медиана удержания</dt><dd className="tabular-nums text-foreground">{fmtMinutes(s.medianHoldMin)}</dd></div>
        <div><dt className="text-muted-foreground">Сделок в день</dt><dd className="tabular-nums text-foreground">{s.tradesPerDay}</dd></div>
        <div><dt className="text-muted-foreground">Короче 5 мин</dt><dd className="tabular-nums text-foreground">{fmtPct(s.scalpShare)}</dd></div>
        <div><dt className="text-muted-foreground">С переносом</dt><dd className="tabular-nums text-foreground">{fmtPct(s.carryShare)}</dd></div>
      </dl>
    </Tile>
  );
}

function HoursTile({ h }: { h: TraderProfile["hours"] }) {
  return (
    <Tile className="flex flex-col gap-3 lg:col-span-3">
      <TileHead icon={Clock}>Часы входа (Нью-Йорк)</TileHead>
      <BucketLine kind="best" b={h.best} label={h.best ? hourLabel(h.best.label) : ""} />
      <BucketLine kind="worst" b={h.worst} label={h.worst ? hourLabel(h.worst.label) : ""} />
      <p className="mt-auto text-xs text-muted-foreground">Учитываются часы с ≥ {pluralTrades(h.minN)}.</p>
    </Tile>
  );
}

function SetupsTile({ st, onOpenSetups }: { st: TraderProfile["setups"]; onOpenSetups?: () => void }) {
  const none = !st.best && !st.worst;
  return (
    <Tile className="flex flex-col gap-3 lg:col-span-3">
      <TileHead icon={Layers}>Сетапы</TileHead>
      {none ? (
        <div className="flex flex-1 flex-col justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {st.coverage > 0 ? `Размечено ${fmtPct(st.coverage)} сделок — мало для сравнения (нужно ≥ ${st.minN} на сетап).` : "Сделки без сетапа. Авто-классификатор подскажет сетап по свечам дня."}
          </p>
          {onOpenSetups && <Button size="sm" variant="outline" className="self-start" onClick={onOpenSetups}>Разметить сетапы</Button>}
        </div>
      ) : (
        <>
          <BucketLine kind="best" b={st.best} label={st.best?.label ?? ""} auto={(st.best?.auto ?? 0) > 0} />
          <BucketLine kind="worst" b={st.worst} label={st.worst?.label ?? ""} auto={(st.worst?.auto ?? 0) > 0} />
          <p className="mt-auto text-xs text-muted-foreground">
            Размечено {fmtPct(st.coverage)} сделок{st.autoShare > 0 ? `, из них авто ${fmtPct(st.autoShare)}` : ""}.
          </p>
        </>
      )}
    </Tile>
  );
}

function DisciplineTile({ d }: { d: TraderProfile["discipline"] }) {
  return (
    <Tile className="flex flex-col gap-2 lg:col-span-3">
      <TileHead icon={Gauge}>Индекс дисциплины</TileHead>
      <div className="flex items-center gap-3">
        <ProgressRing value={d.avg} max={100} size={56} stroke={5} tone={disciplineTone(d.avg)} label={d.avg == null ? "—" : Math.round(d.avg)} ariaLabel="Средний индекс дисциплины за период" />
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Последние 30 дней</div>
          <div className="flex items-center gap-2">
            <span className={cn("text-xl font-semibold tabular-nums", toneText(disciplineTone(d.recent)))}>{d.recent == null ? "—" : Math.round(d.recent)}</span>
            <Delta value={d.delta} precision={0} />
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">до этого: {d.prior == null ? "—" : Math.round(d.prior)}</div>
        </div>
      </div>
      <p className="mt-auto text-xs text-muted-foreground">
        {d.direction === "better" ? "Дисциплина растёт." : d.direction === "worse" ? "Дисциплина проседает — смотрите паттерны ниже." : d.direction === "flat" ? "Без заметных изменений." : "Мало дней для сравнения."}
      </p>
    </Tile>
  );
}

function HabitsTile({ hb, net }: { hb: TraderProfile["habits"]; net: number | null }) {
  const maxAbs = React.useMemo(() => Math.max(1, ...hb.byPattern.map((p) => Math.abs(p.cost))), [hb.byPattern]);
  const monthMax = React.useMemo(() => Math.max(1, ...hb.monthly.map((m) => Math.abs(m.cost ?? 0))), [hb.monthly]);
  const without = hb.total != null && net != null ? net - hb.total : null;
  return (
    <Tile className="flex flex-col gap-3 lg:col-span-12">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <TileHead icon={Wallet}>Стоимость плохих привычек за период</TileHead>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={cn("text-[32px] font-semibold leading-none tabular-nums tracking-tight", toneText(toneOf(hb.total)))}>{fmtUsd(hb.total, { digits: 0 })}</span>
            <span className="text-xs text-muted-foreground">
              {pluralTrades(hb.trades)} за {pluralDays(hb.days)} против среднего «чистой» сделки {fmtUsd(hb.baselineAvg)}
            </span>
          </div>
          {without != null && hb.total != null && hb.total < 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Нетто периода {fmtUsd(net, { digits: 0 })}; без этих привычек было бы около <span className="font-medium tabular-nums text-foreground">{fmtUsd(without, { digits: 0 })}</span>.
            </p>
          )}
        </div>
        {hb.monthly.length > 1 && (
          <div className="flex shrink-0 flex-col gap-1" role="img" aria-label={`Стоимость привычек по месяцам: ${hb.monthly.map((m) => `${monthLabel(m.month)} ${fmtUsdCompact(m.cost)}`).join(", ")}`}>
            <div className="flex h-12 items-end gap-1">
              {hb.monthly.map((m) => {
                const v = m.cost ?? 0;
                return (
                  <span
                    key={m.month}
                    title={`${monthLabel(m.month)}: ${fmtUsd(m.cost)} · ${pluralTrades(m.n)}`}
                    className={cn("w-5 rounded-t-sm", v < 0 ? "bg-down/70" : "bg-up/60")}
                    style={{ height: `${Math.max(6, (Math.abs(v) / monthMax) * 100)}%` }}
                  />
                );
              })}
            </div>
            <div className="flex gap-1 text-xs text-muted-foreground" aria-hidden="true">
              {hb.monthly.map((m) => <span key={m.month} className="w-5 text-center">{monthLabel(m.month).slice(0, 1)}</span>)}
            </div>
          </div>
        )}
      </div>
      {hb.byPattern.length > 0 && (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2 2xl:grid-cols-3" aria-label="Вклад паттернов">
          {hb.byPattern.map((p) => (
            <li key={p.key} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-foreground">{PATTERN_SHORT[p.key] ?? p.title}</span>
              <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/40" aria-hidden="true">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full", PATTERN_TONE[p.key] === "purple" ? "bg-purple" : PATTERN_TONE[p.key] === "warn" ? "bg-warn" : "bg-down")}
                  style={{ width: `${(Math.abs(p.cost) / maxAbs) * 100}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-down">{fmtUsdCompact(p.cost)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Сделки всех паттернов со стоимостью &lt; 0 считаются один раз (сумма стоимостей отдельных паттернов — {fmtUsd(hb.sumOfCosts, { digits: 0 })} — двойной счёт пересечений).
      </p>
    </Tile>
  );
}

export const TraderProfilePanel = React.memo(function TraderProfilePanel({
  report, onOpenSetups,
}: {
  report: BehaviorReport;
  onOpenSetups?: () => void;
}) {
  const p = report.profile;
  if (!p) return null;
  return (
    <div className="grid grid-cols-1 items-stretch gap-[var(--grid-gap)] lg:grid-cols-12">
      <StyleTile s={p.style} />
      <HoursTile h={p.hours} />
      <SetupsTile st={p.setups} onOpenSetups={onOpenSetups} />
      <DisciplineTile d={p.discipline} />
      <HabitsTile hb={p.habits} net={report.summary.net} />
    </div>
  );
});
