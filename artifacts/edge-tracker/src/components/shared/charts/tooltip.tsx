/**
 * The one chart tooltip: a glass card with the date / label, the value(s) and an optional delta, tabular numbers,
 * profit / loss tones for P&L. Two entry points:
 *
 *   // recharts — keeps the Tooltip's own formatter / labelFormatter (recharts passes them to `content`)
 *   <Tooltip {...tooltipProps("line")} content={<GlassTooltip tone="pnl" delta={(row) => row.day} />} formatter={…} labelFormatter={…} />
 *
 *   // hand-drawn SVG / canvas charts
 *   <TooltipCard title="Fri, Oct 15" rows={[{ name: "Net", value: "+$120", raw: 120 }]} style={{ left, top }} />
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { BAR_CURSOR, LINE_CURSOR, pnlTextClass } from "./theme";

/** Glass surface of every chart tooltip / hover card (also used by the canvas equity chart). */
export const TOOLTIP_SURFACE =
  "glass-thick pointer-events-none rounded-xl px-3 py-2 text-xs text-popover-foreground tabular-nums shadow-[var(--glass-shadow-sm)]";

export type TooltipTone = "pnl" | "plain";

export interface TooltipRow {
  key?: string;
  name?: React.ReactNode;
  value: React.ReactNode;
  /** Raw number — picks the profit / loss tone when tone = "pnl". */
  raw?: number | null;
  /** Series colour: drawn as a small swatch next to the name (identity is never colour-only — the name is there). */
  color?: string;
}

/** Presentational card: title, rows, optional delta and footer. */
export function TooltipCard({
  title, rows, tone = "plain", delta, footer, className, style,
}: {
  title?: React.ReactNode;
  rows: TooltipRow[];
  tone?: TooltipTone;
  /** Change against the previous point (signed number + its formatted text and a short label). */
  delta?: { raw: number; text: React.ReactNode; label?: React.ReactNode } | null;
  footer?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const swatches = rows.length > 1;
  return (
    <div className={cn(TOOLTIP_SURFACE, "min-w-[8.5rem] max-w-[18rem]", className)} style={style} role="presentation">
      {title != null && title !== "" && <div className="mb-1 truncate font-medium text-muted-foreground">{title}</div>}
      <dl className="flex flex-col gap-0.5">
        {rows.map((r, i) => (
          <div key={r.key ?? i} className="flex items-baseline justify-between gap-3">
            {r.name != null && r.name !== "" ? (
              <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                {swatches && r.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden="true" />}
                <span className="truncate">{r.name}</span>
              </dt>
            ) : <dt className="sr-only">—</dt>}
            <dd className={cn("whitespace-nowrap text-right font-semibold", rows.length === 1 && "text-sm", tone === "pnl" ? pnlTextClass(r.raw) : "text-foreground")}>
              {r.value}
            </dd>
          </div>
        ))}
        {delta && (
          <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-[var(--glass-border)] pt-1">
            <dt className="text-muted-foreground">{delta.label ?? "Δ"}</dt>
            <dd className={cn("whitespace-nowrap text-right font-medium", pnlTextClass(delta.raw))}>{delta.text}</dd>
          </div>
        )}
      </dl>
      {footer && <div className="mt-1 border-t border-[var(--glass-border)] pt-1 text-2xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

/* ── recharts adapter ─────────────────────────────────────────────────────── */

type Formatted = React.ReactNode | [React.ReactNode, React.ReactNode];
type Entry = {
  name?: string | number;
  value?: unknown;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
  hide?: boolean;
  type?: string;
};

export interface GlassTooltipProps {
  /** "pnl": values are coloured by sign; "plain": values in the text colour. */
  tone?: TooltipTone;
  /** Signed change of the hovered point (e.g. the day's P&L on an equity curve) — shown under the value. */
  delta?: (row: Record<string, unknown>) => number | null | undefined;
  deltaFormat?: (v: number) => React.ReactNode;
  deltaLabel?: React.ReactNode;
  /** Data keys left out of the card. */
  hideKeys?: readonly string[];
  footer?: (row: Record<string, unknown>) => React.ReactNode;
  // Injected by recharts:
  active?: boolean;
  payload?: Entry[];
  label?: unknown;
  formatter?: (value: never, name: never, item: never, index: number, payload: never) => Formatted;
  labelFormatter?: (label: never, payload: never) => React.ReactNode;
}

const swatchOf = (e: Entry) => {
  for (const c of [e.color, e.stroke, e.fill]) if (c && !c.startsWith("url(")) return c;
  return undefined;
};

/** recharts `content` — same formatter / labelFormatter contract as the default tooltip, glass look. */
export function GlassTooltip({
  active, payload, label, formatter, labelFormatter, tone = "plain", delta, deltaFormat, deltaLabel, hideKeys, footer,
}: GlassTooltipProps) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((e) => !e.hide && e.type !== "none" && !(hideKeys && hideKeys.includes(String(e.dataKey))));
  if (!items.length) return null;
  const row = (items[0].payload ?? {}) as Record<string, unknown>;
  const title = labelFormatter ? labelFormatter(label as never, payload as never) : (label as React.ReactNode);
  const rows: TooltipRow[] = items.map((e, i) => {
    let value: React.ReactNode = e.value as React.ReactNode;
    let name: React.ReactNode = e.name;
    if (formatter) {
      const out = formatter(e.value as never, e.name as never, e as never, i, payload as never);
      if (Array.isArray(out)) { value = out[0]; name = out[1]; } else value = out;
    }
    const raw = typeof e.value === "number" ? e.value : null;
    return { key: String(e.dataKey ?? i), name, value, raw, color: swatchOf(e) };
  });
  const d = delta ? delta(row) : null;
  return (
    <TooltipCard
      title={title as React.ReactNode}
      rows={rows}
      tone={tone}
      delta={d != null && Number.isFinite(d) ? { raw: d, text: deltaFormat ? deltaFormat(d) : String(d), label: deltaLabel } : null}
      footer={footer ? footer(row) : undefined}
    />
  );
}

/** Shared Tooltip props: crosshair (line) or column highlight (bar), no slide animation, above the plot. */
export function tooltipProps(kind: "line" | "bar" = "line") {
  return {
    cursor: kind === "line" ? LINE_CURSOR : BAR_CURSOR,
    isAnimationActive: false,
    offset: 14,
    wrapperStyle: { outline: "none", zIndex: "var(--z-raised)" as unknown as number },
  } as const;
}
