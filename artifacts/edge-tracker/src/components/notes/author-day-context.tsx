
import { Link } from "wouter";
import { ArrowUpRight, CandlestickChart, ClipboardList, Moon, CornerDownLeft } from "lucide-react";
import { Panel, Pill, toneOf, toneText, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HORIZON_LABEL, type DayContext, type DayTrade } from "./author-model";
import { fmtDate, fmtR, fmtUsd } from "@/lib/format";

const RESULT: Record<string, { label: string; tone: Tone }> = {
  win: { label: "Профит", tone: "up" },
  loss: { label: "Убыток", tone: "down" },
  breakeven: { label: "В ноль", tone: "neutral" },
  open: { label: "Открыта", tone: "accent" },
};

function TradeLine({ t, showSince }: { t: DayTrade; showSince?: boolean }) {
  const res = RESULT[t.result] ?? { label: t.result, tone: "neutral" as Tone };
  const money = t.pnlNet ?? null;
  return (
    <li>
      <Link
        href={`/trades?highlight=${t.id}`}
        className="group flex min-h-10 items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="w-14 shrink-0 truncate text-sm font-semibold">{t.ticker}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {[t.side, t.horizon !== "intraday" ? HORIZON_LABEL[t.horizon].toLowerCase() : null, showSince ? `с ${fmtDate(t.date, "dayMonth")}` : t.setup]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {showSince ? (
          <Pill tone={t.horizon === "swing" ? "purple" : "accent"}>{HORIZON_LABEL[t.horizon]}</Pill>
        ) : (
          <>
            {money != null ? (
              <span className={cn("text-sm font-medium tabular-nums", toneText(toneOf(money)))}>{fmtUsd(money, { signed: true, decimals: 0 })}</span>
            ) : (t.rSigned ?? t.rMultiple) != null ? (
              <span className={cn("text-sm font-medium tabular-nums", toneText(toneOf(t.rSigned ?? t.rMultiple)))}>{fmtR(t.rSigned ?? t.rMultiple, 1)}</span>
            ) : (
              <Pill tone={res.tone}>{res.label}</Pill>
            )}
          </>
        )}
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function AuthorDayContext({
  date,
  data,
  loading,
  unavailable,
  canInsert,
  onInsertTrades,
  onInsertHeld,
}: {
  date: string;
  data: DayContext | undefined;
  loading: boolean;
  unavailable: boolean;
  canInsert: boolean;
  onInsertTrades: (trades: DayTrade[]) => void;
  onInsertHeld: (held: DayTrade[]) => void;
}) {
  const s = data?.summary;
  return (
    <Panel
      title="Торговый день"
      description={fmtDate(date, "dayMonth")}
      icon={CandlestickChart}
      actions={
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link href={`/game-plan?date=${date}`}>
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Game plan
          </Link>
        </Button>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Загрузка сделок">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-xl" />
        </div>
      ) : unavailable || !data ? (
        <p className="text-sm text-muted-foreground">
          Сделки дня подтянутся сюда после обновления сервера. Пока открой их в разделе{" "}
          <Link href="/trades" className="text-primary hover:underline">Сделки</Link>.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[var(--glass-bg)] px-3 py-2">
              <div className="text-xs text-muted-foreground">Сделок</div>
              <div className="text-lg font-semibold tabular-nums">{s?.count ?? 0}</div>
            </div>
            <div className="rounded-xl bg-[var(--glass-bg)] px-3 py-2">
              <div className="text-xs text-muted-foreground">P&L net</div>
              <div className={cn("text-lg font-semibold tabular-nums", toneText(toneOf(s?.pnlNet)))}>{fmtUsd(s?.pnlNet, { signed: true, decimals: 0 })}</div>
            </div>
            <div className="rounded-xl bg-[var(--glass-bg)] px-3 py-2">
              <div className="text-xs text-muted-foreground">Σ R</div>
              <div className={cn("text-lg font-semibold tabular-nums", toneText(toneOf(s?.rSum)))}>{fmtR(s?.rSum, 1)}</div>
            </div>
          </div>

          {data.trades.length === 0 ? (
            <p className="text-sm text-muted-foreground">За этот день сделок нет.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="micro-label">Сделки дня · {s?.wins ?? 0}W / {s?.losses ?? 0}L</span>
                {canInsert && (
                  <Button variant="ghost" size="sm" className="gap-1" title="Вставит тикеры и R — без сумм в $, сводку читает вся команда" onClick={() => onInsertTrades(data.trades)}>
                    <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    В запись
                  </Button>
                )}
              </div>
              <ul className="-mx-2 flex flex-col">
                {data.trades.slice(0, 12).map((t) => <TradeLine key={t.id} t={t} />)}
              </ul>
              {data.trades.length > 12 && (
                <span className="text-xs text-muted-foreground">и ещё {data.trades.length - 12}</span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="micro-label inline-flex items-center gap-1.5">
                <Moon className="h-3 w-3" aria-hidden="true" />
                Несу через ночь · {data.held.length}
              </span>
              {canInsert && data.held.length > 0 && (
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => onInsertHeld(data.held)}>
                  <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  В план
                </Button>
              )}
            </div>
            {data.held.length === 0 ? (
              <p className="text-sm text-muted-foreground">Флэт к закрытию — гэп-риска нет.</p>
            ) : (
              <ul className="-mx-2 flex flex-col">
                {data.held.map((t) => <TradeLine key={t.id} t={t} showSince />)}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * Lines inserted into the note from the day's trades. R only, never $: the note is read by the whole team and
 * traders must not see each other's money (same rule as lib/playbookPrivacy on the server).
 */
export function tradeLine(t: DayTrade): string {
  const parts = [t.ticker, t.side ?? undefined];
  const r = t.rSigned ?? (t.result === "open" ? null : t.rMultiple);
  const res = r != null ? fmtR(r, 1) : RESULT[t.result]?.label.toLowerCase();
  return `• ${parts.filter(Boolean).join(" ")}${t.setup ? ` (${t.setup})` : ""} — ${res ?? t.result}: `;
}

export function heldLine(t: DayTrade): string {
  return `• ${t.ticker}${t.side ? ` ${t.side}` : ""} · ${HORIZON_LABEL[t.horizon].toLowerCase()} с ${fmtDate(t.date, "dayMonth")} · стоп: · план на гэп: `;
}
