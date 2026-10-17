import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { Trade } from "@workspace/api-client-react";
import { ArrowUpRight, ExternalLink, ImageOff, LineChart } from "lucide-react";
import { Pill, StatRow, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { KPI_FORMULAS, closeDate, feesOf, grossPnl, netPnl, signedR } from "@/lib/trade-math";
import { TraderAvatar } from "./trader-avatar";
import { allScreenshots, firstScreenshot, fmtMoney, fmtR, thumbUrl } from "./utils";
import { setupOf } from "./leaderboard";

const RESULT_LABEL: Record<string, string> = { win: "Прибыль", loss: "Убыток", breakeven: "Безубыток", open: "Открыта" };

export function ResultPill({ result }: { result: string }) {
  const tone = result === "win" ? "up" : result === "loss" ? "down" : result === "open" ? "accent" : "neutral";
  return <Pill tone={tone}>{RESULT_LABEL[result] ?? result}</Pill>;
}

export function SidePill({ side }: { side?: string | null }) {
  if (!side) return null;
  const long = side.toLowerCase() === "long";
  return <Pill tone={long ? "up" : "down"}>{long ? "Long" : "Short"}</Pill>;
}

/** Screenshot thumbnail with graceful fallback (TradingView links resolved to snapshot PNG). */
export function ScreenshotThumb({ url, alt, className }: { url: string | null; alt: string; className?: string }) {
  const src = thumbUrl(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className={cn("grid place-items-center bg-[var(--glass-bg)] text-muted-foreground", className)} aria-hidden="true">
        {url ? <LineChart className="h-5 w-5 opacity-80" /> : <ImageOff className="h-5 w-5 opacity-80" />}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}

/** "Best trade" card: screenshot, ticker, R / P&L, setup, trader. */
export function BestTradeCard({
  trade,
  rank,
  onOpen,
}: {
  trade: Trade;
  rank?: number;
  onOpen: (t: Trade) => void;
}) {
  const shot = firstScreenshot(trade.screenshotUrl);
  const r = signedR(trade);
  const net = netPnl(trade);
  return (
    <button
      type="button"
      onClick={() => onOpen(trade)}
      className="glass-panel lift group flex min-w-0 flex-col overflow-hidden rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${trade.ticker}, ${fmtR(r)}, ${trade.trader ?? ""} — открыть детали`}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-border">
        <ScreenshotThumb url={shot} alt={`График ${trade.ticker}`} className="h-full w-full" />
        {rank != null && (
          <span className="glass absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">#{rank}</span>
        )}
        <span className="absolute right-2 top-2">
          <Pill tone={toneOf(r)} className="backdrop-blur">{fmtR(r)}</Pill>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-semibold tracking-tight">{trade.ticker}</span>
          <SidePill side={trade.side} />
        </div>
        <p className="truncate text-xs text-muted-foreground" title={setupOf(trade)}>{setupOf(trade)}</p>
        <div className="mt-auto flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <TraderAvatar name={trade.trader} size="xs" />
            <span className="truncate">{trade.trader ?? "—"}</span>
          </span>
          <span className={cn("tabular-nums", toneText(toneOf(net)))} title={net != null ? `${KPI_FORMULAS.netPnl}` : undefined}>
            {net != null ? `${fmtMoney(net)} нетто` : closeDate(trade) ?? trade.date}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Right-side sheet with full trade details and a link into the trade journal. */
export function TradeDetailSheet({ trade, onClose }: { trade: Trade | null; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const shots = trade ? allScreenshots(trade.screenshotUrl) : [];
  const net = trade ? netPnl(trade) : null;
  const gross = trade ? grossPnl(trade) : null;
  const fees = trade ? feesOf(trade) : 0;
  const r = trade ? signedR(trade) : null;
  return (
    <Sheet open={!!trade} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {trade && (
          <div className="flex flex-col gap-4">
            <SheetHeader className="pr-10 text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-xl">
                {trade.ticker}
                <SidePill side={trade.side} />
                <ResultPill result={trade.result} />
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                <TraderAvatar name={trade.trader} size="xs" />
                {trade.trader ?? "—"} · {trade.date}
                {trade.exitDate && trade.exitDate !== trade.date ? ` → ${trade.exitDate}` : ""} · {setupOf(trade)}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-3 gap-2">
              <Metric label="R" value={fmtR(r)} tone={toneText(toneOf(r))} title="R = результат сделки в единицах риска (знак по результату)" />
              <Metric
                label="P&L нетто"
                value={fmtMoney(net)}
                tone={toneText(toneOf(net))}
                title={net != null ? `${KPI_FORMULAS.netPnl}. Брутто ${fmtMoney(gross)}, комиссии ${fmtMoney(-Math.abs(fees))}` : KPI_FORMULAS.netPnl}
              />
              <Metric label="Удержание" value={trade.holdTime || "—"} />
            </div>

            <div className="glass-panel rounded-xl px-4 py-2">
              <StatRow label="Вход" value={trade.entry ?? "—"} />
              <StatRow label="Выход" value={trade.exit ?? "—"} />
              <StatRow label="Стоп" value={trade.stop ?? "—"} />
              {trade.relativeVolume != null && <StatRow label="Отн. объём" value={`${trade.relativeVolume}×`} />}
              {trade.float && <StatRow label="Флоат" value={trade.float} />}
              {trade.marketCap && <StatRow label="Капитализация" value={trade.marketCap} />}
            </div>

            {shots.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="micro-label">Скриншоты</span>
                <div className="grid grid-cols-2 gap-2">
                  {shots.slice(0, 4).map((u, i) => (
                    <a
                      key={u + i}
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Открыть скриншот ${i + 1} в новой вкладке`}
                    >
                      <ScreenshotThumb url={u} alt={`Скриншот ${i + 1} — ${trade.ticker}`} className="aspect-video w-full" />
                      <ExternalLink className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {[
              ["Что сработало", trade.whatWorked],
              ["Что не сработало", trade.whatFailed],
              ["Вывод", trade.conclusion],
              ["Заметки", trade.notes],
            ]
              .filter(([, v]) => v && String(v).trim())
              .map(([label, v]) => (
                <div key={label as string} className="flex flex-col gap-1">
                  <span className="micro-label">{label}</span>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{v}</p>
                </div>
              ))}

            {trade.tags && (
              <div className="flex flex-wrap gap-1.5">
                {trade.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                  <Pill key={t}>{t}</Pill>
                ))}
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => {
                onClose();
                setLocation(links.trade(trade.id));
              }}
            >
              Открыть в журнале сделок <ArrowUpRight />
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value, tone, title }: { label: string; value: ReactNode; tone?: string; title?: string }) {
  return (
    <div className="glass-panel flex min-w-0 flex-col gap-0.5 rounded-xl p-3" title={title}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("truncate text-lg font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}
