/**
 * «Команда» (partners only) + shared helpers: per-trader table, capital & goal form, CSV export and the
 * «Как считается» popover. Nothing here renders for members — the page does not mount these blocks and the
 * server never sends per-trader rows or $ to them.
 */
import * as React from "react";
import { Download, HelpCircle, Landmark, Save, Users } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, Sparkline, toneOf } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  fmtDay, fmtNum, fmtParen, fmtShare, fmtV, useSaveCapital,
  type AdminResponse, type AdminSetting, type OfficeView, type Rules, type TraderRow, type Unit,
} from "./api";
import { strategyColor, useDark } from "./palette";

type SortKey = "net" | "share" | "trades" | "winRate" | "profitFactor" | "consistency" | "volume" | "maxDrawdown";

export function TradersTable({ view, unit, periodLabel }: { view: OfficeView; unit: Unit; periodLabel: string }) {
  const dark = useDark();
  const rows = view.period.traders ?? [];
  const [sort, setSort] = React.useState<{ k: SortKey; dir: 1 | -1 }>({ k: "net", dir: -1 });
  const sorted = React.useMemo(() => {
    const val = (r: TraderRow) => (r[sort.k] as number | null) ?? -Infinity;
    return [...rows].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [rows, sort]);
  const th = (k: SortKey, label: string, title?: string) => (
    <th className="!text-right" aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" title={title} onClick={() => setSort((s) => ({ k, dir: s.k === k ? ((-s.dir) as 1 | -1) : -1 }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}{sort.k === k && <span aria-hidden="true">{sort.dir === -1 ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
  return (
    <Panel title="Трейдеры" description={`${periodLabel} · вклад каждого трейдера в результат офиса · видят только партнёры`} icon={Users}>
      {!rows.length ? <EmptyState compact icon={Users} title="Нет сделок за период" /> : (
        <DataTable ariaLabel="Трейдеры офиса" stickyFirstCol maxHeight="70vh">
          <table>
            <thead>
              <tr>
                <th>Трейдер</th>
                <th>Кривая</th>
                {th("net", "Нетто")}
                {th("share", "Доля", "доля в результате офиса")}
                {th("trades", "Сделок")}
                {th("winRate", "WR")}
                {th("profitFactor", "PF")}
                {th("consistency", "Стабильность", "доля зелёных дней из торговых")}
                {th("volume", "Объём", "акций за период")}
                {th("maxDrawdown", "Макс. DD")}
                <th>Лучший / худший день</th>
                <th>Стратегия</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.trader}>
                  <td className="whitespace-nowrap font-medium text-foreground">{r.trader}</td>
                  <td><Sparkline data={r.spark} width={88} height={22} baseline={0} ariaLabel={`Кривая ${r.trader}`} /></td>
                  <td className={cn("text-right font-semibold", r.net >= 0 ? "text-up" : "text-down")}>{fmtV(r.net, unit)}</td>
                  <td className="text-right">{r.share != null ? <Pill tone={toneOf(r.share)}>{fmtShare(r.share)}</Pill> : "—"}</td>
                  <td className="text-right">{r.trades}</td>
                  <td className="text-right">{fmtShare(r.winRate)}</td>
                  <td className={cn("text-right", r.profitFactor != null && (r.profitFactor >= 1 ? "text-up" : "text-down"))}>{r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="relative h-1.5 w-12 rounded-full bg-[var(--glass-bg)]"><span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(r.consistency ?? 0) * 100}%` }} /></span>
                      {fmtShare(r.consistency)}
                    </span>
                  </td>
                  <td className="text-right" title={r.volumeShare != null ? `${fmtShare(r.volumeShare, 1)} объёма офиса` : undefined}>{fmtNum(r.volume)}<span className="ml-1 text-2xs text-muted-foreground">{fmtShare(r.volumeShare)}</span></td>
                  <td className="text-right text-down">{r.maxDrawdown < 0 ? fmtV(r.maxDrawdown, unit) : "—"}</td>
                  <td className="whitespace-nowrap text-xs">
                    <span className="text-up">{r.bestDay ? `${fmtV(r.bestDay.v, unit)} ${fmtDay(r.bestDay.date)}` : "—"}</span>
                    <span className="mx-1 text-muted-foreground">/</span>
                    <span className="text-down">{r.worstDay && r.worstDay.v < 0 ? `${fmtV(r.worstDay.v, unit)} ${fmtDay(r.worstDay.date)}` : "—"}</span>
                  </td>
                  <td>{r.topStrategy ? <span className="inline-flex items-center gap-1.5 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: strategyColor(r.topStrategy, dark) }} aria-hidden="true" />{r.topStrategy}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}

function CapitalRow({ s, onSaved }: { s: AdminSetting; onSaved: () => void }) {
  const save = useSaveCapital();
  const { toast } = useToast();
  const [capital, setCapital] = React.useState(s.capital != null ? String(s.capital) : "");
  const [goal, setGoal] = React.useState(String(s.goalPct));
  React.useEffect(() => { setCapital(s.capital != null ? String(s.capital) : ""); setGoal(String(s.goalPct)); }, [s.capital, s.goalPct]);
  const capNum = capital.trim() === "" ? null : Number(capital.replace(/[\s,]/g, ""));
  const goalNum = Number(goal.replace(",", "."));
  const capValid = capNum == null || (Number.isFinite(capNum) && capNum > 0 && capNum <= 1e11);
  const goalValid = Number.isFinite(goalNum) && goalNum >= 0 && goalNum <= 1000;
  const dirty = capNum !== s.capital || goalNum !== s.goalPct;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!capValid || !goalValid) return;
    save.mutate({ year: s.year, capital: capNum, goalPct: goalNum }, {
      onSuccess: () => { toast({ title: `Сохранено: ${s.year}` }); onSaved(); },
      onError: (err) => toast({ title: "Не сохранилось", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
    });
  };
  return (
    <form onSubmit={submit} className="tile grid grid-cols-2 items-end gap-2 p-3 sm:grid-cols-[3.5rem_minmax(7.5rem,1fr)_5.5rem_auto]">
      <span className="col-span-2 text-sm font-semibold text-foreground sm:col-span-1 sm:pb-2">{s.year}</span>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        Капитал, $
        <Input inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} placeholder="не указан" aria-invalid={!capValid} className={cn("tabular-nums", !capValid && "border-destructive")} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        Цель, %
        <Input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} aria-invalid={!goalValid} className={cn("tabular-nums", !goalValid && "border-destructive")} />
      </label>
      <Button type="submit" size="sm" disabled={!dirty || !capValid || !goalValid || save.isPending} className="col-span-2 sm:col-span-1">
        <Save className="h-4 w-4" /> {save.isPending ? "Сохраняю…" : "Сохранить"}
      </Button>
      {s.updatedBy && <p className="col-span-2 text-2xs text-muted-foreground sm:col-span-4">изменил {s.updatedBy}{s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleDateString("ru-RU")}` : ""}</p>}
    </form>
  );
}

export function CapitalPanel({ data }: { data: AdminResponse }) {
  const years = [...data.settings].sort((a, b) => b.year - a.year);
  return (
    <Panel
      id="capital"
      title="Капитал и цель"
      description="база для процентов: результат года ÷ капитал офиса за этот год · цель по умолчанию +40% · сумму видят только партнёры"
      icon={Landmark}
      fill
      className="lg:col-span-6"
    >
      <div className="flex flex-col gap-2">
        {years.map((s) => <CapitalRow key={s.year} s={s} onSaved={() => undefined} />)}
        <p className="text-2xs text-muted-foreground">Пустое поле капитала — сбросить. Трейдеры и кураторы видят только проценты; без капитала они видят «Партнёры ещё не указали капитал».</p>
      </div>
    </Panel>
  );
}

// ─── CSV export (partners) ─────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(Math.round(v * 10000) / 10000) : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(data: AdminResponse, unit: Unit) {
  const view = unit === "usd" ? data.usd : data.pct;
  const u = unit === "usd" ? "$" : "%";
  const lines: string[] = [];
  const row = (...c: unknown[]) => lines.push(c.map(csvCell).join(";"));
  row(`Статистика офиса · период ${view.period.from} — ${view.period.to} · единицы: ${u}`);
  row();
  row("Дни"); row("Дата", "Год", `Нетто ${u}`, `С начала года ${u}`, "Сделок");
  for (const y of view.years) for (const d of y.days) row(d.date, y.year, d.v, d.cum, d.trades);
  row();
  row("Стратегии за период"); row("Стратегия", "Сделок", "WR", "PF", "Ср. R", `Нетто ${u}`, "Доля результата", "Доля объёма", "Объём");
  for (const s of view.period.strategies) row(s.key, s.trades, s.winRate, s.profitFactor, s.avgR, s.net, s.netShare, s.volumeShare, s.volume);
  row();
  row("Трейдеры за период"); row("Трейдер", "Сделок", `Нетто ${u}`, "Доля", "WR", "PF", "Стабильность", "Объём", `Макс. DD ${u}`, "Стратегия");
  for (const t of view.period.traders ?? []) row(t.trader, t.trades, t.net, t.share, t.winRate, t.profitFactor, t.consistency, t.volume, t.maxDrawdown, t.topStrategy);
  row();
  row("Месяцы"); row("Год", "Месяц", `Нетто ${u}`, "Дней", "Зелёных", "Красных");
  for (const y of view.years) for (const m of y.months) if (m.days) row(y.year, m.month, m.v, m.days, m.green, m.red);
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `office-stats-${view.period.from}_${view.period.to}-${unit}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function CsvButton({ data, unit }: { data: AdminResponse; unit: Unit }) {
  return (
    <Button variant="outline" size="sm" onClick={() => exportCsv(data, unit)}>
      <Download className="h-4 w-4" /> CSV
    </Button>
  );
}

// ─── «Как считается» ─────────────────────────────────────────────────────────

export function RulesPopover({ rules, isAdmin }: { rules: Rules; isAdmin: boolean }) {
  const dark = useDark();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm"><HelpCircle className="h-4 w-4" /> Как считается</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,30rem)] max-h-[70vh] overflow-y-auto text-sm">
        <p className="font-semibold text-foreground">Как считается</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Нетто сделки = P&L − комиссии; день сделки — дата закрытия. Проценты = нетто ÷ капитал офиса за год, который задают партнёры.
          {isAdmin ? " Вы видите и $, и %." : " Трейдерам и кураторам видны только проценты и доли — без сумм и без разбивки по людям."}
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Стратегии (время Нью‑Йорка)</p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {rules.strategies.map((s) => (
            <li key={s.key} className="flex gap-2 text-xs">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: strategyColor(s.key, dark) }} aria-hidden="true" />
              <span><b className="text-foreground">{s.key}</b> — <span className="text-muted-foreground">{s.text}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{rules.order}</p>
        {rules.notes.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {rules.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Выводы в блоке «Главное» считаются по фиксированным правилам, без ИИ.</p>
      </PopoverContent>
    </Popover>
  );
}

export { fmtParen };
