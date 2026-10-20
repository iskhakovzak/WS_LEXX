/**
 * One theme table («От открытия» or «За день»): rows sorted best → worst, each a diverging bar scaled to the largest
 * |value| of this panel (down colour grows left of the centre line, up colour right) and the signed % in tabular
 * numbers. A row opens inline with its members (ticker, both moves) and the tickers that had no quote.
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Panel, toneBg, toneOf, toneText } from "@/components/ds";
import { TickerContext } from "@/components/shared/finviz/ticker-context";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { barOf, panelScale, sortMembers, sortThemes, type MemberQuote, type ThemeMetric, type ThemeOut, type ThemeSession } from "./model";

function Bar({ value, scale }: { value: number | null; scale: number }) {
  const { side, width } = barOf(value, scale);
  return (
    <span className="relative flex h-3.5 min-w-0 items-center" aria-hidden="true">
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
      <span className="flex h-full w-1/2 justify-end">
        {side === "down" && <span className={cn("h-full rounded-l-sm opacity-85", toneBg("down"))} style={{ width: `${width}%` }} />}
      </span>
      <span className="flex h-full w-1/2">
        {side === "up" && <span className={cn("h-full rounded-r-sm opacity-85", toneBg("up"))} style={{ width: `${width}%` }} />}
      </span>
    </span>
  );
}

const Pct = ({ v, className }: { v: number | null; className?: string }) => (
  <span className={cn("text-right tabular-nums", toneText(toneOf(v)), className)}>{fmtPct(v)}</span>
);

function Members({ id, members, missing, metric }: { id: string; members: MemberQuote[]; missing: string[]; metric: ThemeMetric }) {
  const { t } = themesI18n.useT();
  return (
    <div id={id} className="tile mx-1 mb-2 mt-0.5 flex flex-col gap-1 p-2 text-xs">
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="w-14 shrink-0">{t("cols.ticker")}</span>
        <span className="min-w-0 flex-1" />
        <span className="w-16 text-right">{t("cols.today")}</span>
        <span className="w-16 text-right">{t("cols.fromOpen")}</span>
      </div>
      <ul className="flex flex-col divide-y divide-border/50">
        {sortMembers(members, metric).map((m) => (
          <li key={m.ticker} className="flex min-w-0 items-center gap-2 py-1">
            <span className="w-14 shrink-0 font-semibold">{m.ticker}</span>
            <span className="min-w-0 flex-1">
              <TickerContext ticker={m.ticker} max={2} className="hidden sm:flex" />
            </span>
            <Pct v={m.today} className="w-16" />
            <Pct v={m.fromOpen} className="w-16" />
          </li>
        ))}
      </ul>
      {missing.length > 0 && <p className="text-2xs text-muted-foreground">{t("missing", { list: missing.join(", ") })}</p>}
    </div>
  );
}

function Row({ theme, metric, scale, open, onToggle }: { theme: ThemeOut; metric: ThemeMetric; scale: number; open: boolean; onToggle: () => void }) {
  const { t } = themesI18n.useT();
  const v = theme[metric];
  const panelId = `theme-${metric}-${theme.id}`;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("rowAria", { name: theme.name, value: fmtPct(v) })}
        className="press grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_4rem] items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.25rem]"
      >
        <span className="flex min-w-0 items-center gap-1">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true" />
          <span className="truncate text-sm" title={theme.name}>{theme.name}</span>
        </span>
        <Bar value={v} scale={scale} />
        <Pct v={v} className="text-sm font-medium" />
      </button>
      {open && <Members id={panelId} members={theme.members} missing={theme.missing} metric={metric} />}
    </li>
  );
}

export function ThemePanel({
  metric, themes, session, className,
}: { metric: ThemeMetric; themes: readonly ThemeOut[]; session: ThemeSession; className?: string }) {
  const { t } = themesI18n.useT();
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const rows = sortThemes(themes, metric);
  const scale = panelScale(themes, metric);
  const empty = scale === 0 && themes.every((th) => th[metric] == null);
  const toggle = (id: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <Panel title={t(`panels.${metric}`)} description={t(`panelHints.${metric}`)} className={className}>
      {empty ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {metric === "fromOpen" && session === "pre" ? t("noOpenYet") : t("noData.desc")}
        </p>
      ) : (
        <ul className="-mx-1.5 flex flex-col">
          {rows.map((th) => (
            <Row key={th.id} theme={th} metric={metric} scale={scale} open={open.has(th.id)} onToggle={() => toggle(th.id)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
