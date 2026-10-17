/**
 * Local risk-desk primitives: LimitBar, ProgressRing, Sparkline, StatusPill, TierPill + formatters.
 * (ds.tsx has no LimitBar/ProgressRing yet — the shell agent may promote these later.)
 */
import * as React from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Pill, type Tone } from "@/components/ds";
import { AlertTriangle, CheckCircle2, CircleDashed, OctagonX, type LucideIcon } from "lucide-react";
import type { Horizon, RiskStatus, StopState } from "./use-risk";
import type { RankLevel } from "./risk-math";

// ─── desk level: ok / near / stop (colour + icon + text) ────────────────────

export const LEVEL_META: Record<RankLevel, { label: string; tone: Tone; icon: LucideIcon; text: string }> = {
  stop: { label: "Стоп", tone: "down", icon: OctagonX, text: "text-down" },
  near: { label: "У лимита", tone: "warn", icon: AlertTriangle, text: "text-warn" },
  ok: { label: "В норме", tone: "up", icon: CheckCircle2, text: "text-up" },
  none: { label: "Нет лимитов", tone: "neutral", icon: CircleDashed, text: "text-muted-foreground" },
};

/** Status chip that never relies on colour alone: icon + word (+ optional detail line). */
export function LevelBadge({ level, label, className }: { level: RankLevel; label?: string; className?: string }) {
  const m = LEVEL_META[level];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", m.text, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label ?? m.label}
    </span>
  );
}

/** Compact usage meter for table cells: «64%» + thin bar; tooltip with $ used / limit. «—» when no limit. */
export function UsageCell({ pct, used, limit, label }: { pct: number | null; used: number; limit: number | null | undefined; label: string }) {
  if (limit == null || pct == null) {
    return <span className="text-xs text-muted-foreground" title={`${label}: лимит не задан`}>—</span>;
  }
  const w = Math.min(100, Math.max(used > 0 ? 3 : 0, pct));
  const title = `${label}: ${fmtUsd(used)} из ${fmtUsd(limit)} (${fmtPct(pct)}), осталось ${fmtUsd(Math.max(0, limit - used))}`;
  return (
    <div className="flex min-w-[84px] flex-col gap-1" title={title}>
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className={cn("font-semibold", usageText(pct))}>{fmtPct(pct)}</span>
        <span className="text-xs text-muted-foreground">ост. {fmtUsd(Math.max(0, limit - used), { compact: true })}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(pct, 999))}
        aria-valuetext={title}
        className="relative h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg)] ring-1 ring-inset ring-[var(--field-border)]"
      >
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: usageColor(pct) }} />
        <span aria-hidden="true" className="absolute inset-y-0 w-px bg-foreground/25" style={{ left: "70%" }} />
      </div>
    </div>
  );
}

// ─── formatters ─────────────────────────────────────────────────────────────

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** $1,234 (no sign). Compact $12.5k for big numbers when compact=true. */
export function fmtUsd(v: number | null | undefined, opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (opts.compact && a >= 10_000) {
    const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M` : `${(a / 1000).toFixed(a >= 100_000 ? 0 : 1)}k`;
    return `${v < 0 ? "−" : ""}$${s}`;
  }
  const s = (opts.cents ? usd2 : usd0).format(a);
  return v < 0 ? `−${s}` : s;
}

/** Signed: +$120 / −$80 / $0. */
export function fmtSignedUsd(v: number | null | undefined, compact = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "$0";
  return `${v > 0 ? "+" : ""}${fmtUsd(v, { compact })}`;
}

export function fmtR(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(Math.abs(v) >= 10 ? 1 : 2).replace(/\.?0+$/, "") || "0";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}R`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)}%`;
}

export const HORIZON_LABEL: Record<Horizon, string> = { intraday: "Интрадей", overnight: "Овернайт", swing: "Свинг" };
export const HORIZON_TONE: Record<Horizon, Tone> = { intraday: "neutral", overnight: "accent", swing: "purple" };

// ─── tiers / scaling plan ───────────────────────────────────────────────────

export const TIERS = [
  { value: "trainee", label: "Стажёр", hint: "симулятор / минимальный размер" },
  { value: "junior", label: "Джун", hint: "интрадей, малый лот" },
  { value: "trader", label: "Трейдер", hint: "интрадей + овернайт" },
  { value: "senior", label: "Сеньор", hint: "полный BP, свинг" },
] as const;

export function tierLabel(tier: string | null | undefined): string | null {
  if (!tier) return null;
  return TIERS.find((t) => t.value === tier)?.label ?? (tier === "lead" ? "Лид" : tier);
}

export function TierPill({ tier, className }: { tier: string | null | undefined; className?: string }) {
  const label = tierLabel(tier);
  if (!label) return <Pill tone="neutral" className={className}>Без тира</Pill>;
  const idx = TIERS.findIndex((t) => t.value === tier);
  return (
    <Pill tone="purple" className={className}>
      {label}
      {idx >= 0 && <span className="opacity-80">· {idx + 1}/{TIERS.length}</span>}
    </Pill>
  );
}

// ─── status ─────────────────────────────────────────────────────────────────

export const STATUS_META: Record<RiskStatus, { label: string; tone: Tone }> = {
  ok: { label: "В норме", tone: "up" },
  warn: { label: "Внимание", tone: "warn" },
  breach: { label: "Нарушение", tone: "down" },
  no_limits: { label: "Нет лимитов", tone: "neutral" },
};

export function StatusPill({ status, className }: { status: RiskStatus; className?: string }) {
  const m = STATUS_META[status];
  return <Pill tone={m.tone} dot className={className}>{m.label}</Pill>;
}

// ─── red-day stop state ─────────────────────────────────────────────────────

export const STOP_META: Record<StopState, { label: string; tone: Tone }> = {
  ok: { label: "В норме", tone: "up" },
  warn: { label: "Близко к стопу", tone: "warn" },
  stop: { label: "Дневной стоп", tone: "down" },
  weekly: { label: "Недельный стоп", tone: "down" },
  drawdown: { label: "Макс. просадка", tone: "down" },
  no_limits: { label: "Нет лимитов", tone: "neutral" },
};

export function StopPill({ state, className }: { state: StopState; className?: string }) {
  const m = STOP_META[state];
  return <Pill tone={m.tone} dot className={className}>{m.label}</Pill>;
}

// ─── usage colour ───────────────────────────────────────────────────────────

/** ≥100 breach (down), ≥70 warn, else ok. */
export function usageTone(pct: number | null | undefined): "up" | "warn" | "down" | "neutral" {
  if (pct == null) return "neutral";
  if (pct >= 100) return "down";
  if (pct >= 70) return "warn";
  return "up";
}

const TONE_COLOR: Record<"up" | "warn" | "down" | "neutral", string> = {
  up: "hsl(var(--up))",
  warn: "hsl(var(--warn))",
  down: "hsl(var(--down))",
  neutral: "hsl(var(--muted-foreground))",
};
const TONE_TEXT: Record<"up" | "warn" | "down" | "neutral", string> = {
  up: "text-up",
  warn: "text-warn",
  down: "text-down",
  neutral: "text-muted-foreground",
};
export const usageText = (pct: number | null | undefined) => TONE_TEXT[usageTone(pct)];
export const usageColor = (pct: number | null | undefined) => TONE_COLOR[usageTone(pct)];

// ─── LimitBar ───────────────────────────────────────────────────────────────

/**
 * Horizontal usage bar: "label ........ used / limit" with a 70% warn tick.
 * Renders a muted "лимит не задан" line when limit is null.
 */
export function LimitBar({
  label,
  used,
  limit,
  format = (v: number) => fmtUsd(v, { compact: true }),
  size = "md",
  className,
  hint,
}: {
  label: React.ReactNode;
  used: number;
  limit: number | null | undefined;
  format?: (v: number) => string;
  size?: "sm" | "md";
  className?: string;
  hint?: React.ReactNode;
}) {
  const has = limit != null && limit >= 0;
  const pct = !has ? null : (limit as number) > 0 ? (used / (limit as number)) * 100 : used > 0 ? 100 : 0;
  const width = pct == null ? 0 : Math.min(100, Math.max(used > 0 ? 2 : 0, pct));
  const labelId = React.useId();
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("flex items-baseline justify-between gap-2", size === "sm" ? "text-xs" : "text-sm")}>
        <span id={labelId} className="truncate text-muted-foreground">{label}</span>
        {has ? (
          <span className="shrink-0 tabular-nums">
            <span className={cn("font-medium", usageText(pct))}>{format(used)}</span>
            <span className="text-muted-foreground"> / {format(limit as number)}</span>
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">лимит не задан</span>
        )}
      </div>
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct == null ? undefined : Math.round(Math.min(pct, 999))}
        aria-valuetext={has ? `${format(used)} из ${format(limit as number)} (${fmtPct(pct)})` : "лимит не задан"}
        className={cn("relative mt-1.5 overflow-hidden rounded-full bg-[var(--glass-bg)] ring-1 ring-inset ring-[var(--field-border)]", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
          style={{ width: `${width}%`, background: usageColor(pct) }}
        />
        {has && <span aria-hidden="true" className="absolute inset-y-0 w-px bg-foreground/25" style={{ left: "70%" }} />}
      </div>
      {(hint || (pct != null && pct >= 70)) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
          <span className="truncate">{hint}</span>
          {pct != null && <span className={cn("tabular-nums font-medium", usageText(pct))}>{fmtPct(pct)}</span>}
        </div>
      )}
    </div>
  );
}

// ─── ProgressRing ───────────────────────────────────────────────────────────

export function ProgressRing({
  pct,
  size = 120,
  stroke = 10,
  children,
  label,
  className,
}: {
  /** 0..100+ ; null = no limit (empty track). */
  pct: number | null;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  label: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct == null ? undefined : Math.round(pct)}
      aria-valuetext={pct == null ? "лимит не задан" : `${Math.round(pct)}%`}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
        {[70].map((t) => {
          const a = (t / 100) * 2 * Math.PI;
          const x1 = size / 2 + (r - stroke / 2) * Math.cos(a);
          const y1 = size / 2 + (r - stroke / 2) * Math.sin(a);
          const x2 = size / 2 + (r + stroke / 2) * Math.cos(a);
          const y2 = size / 2 + (r + stroke / 2) * Math.sin(a);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="hsl(var(--foreground) / 0.3)" strokeWidth={1.5} />;
        })}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={usageColor(pct)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  width = 120,
  height = 32,
  className,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  label?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  if (values.length < 2) {
    return (
      <svg width={width} height={height} className={className} role="img" aria-label={label ?? "Нет данных"}>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="hsl(var(--border))" strokeDasharray="3 3" />
      </svg>
    );
  }
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const color = last >= 0 ? "hsl(var(--up))" : "hsl(var(--down))";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={label ?? "Динамика"} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="hsl(var(--border))" strokeDasharray="2 3" />
      <path d={`${d} L${width},${y(0)} L0,${y(0)} Z`} fill={`url(#sg${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── misc ───────────────────────────────────────────────────────────────────

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px rgb(0 0 0 / 0.3)",
  backdropFilter: "blur(24px)",
  fontVariantNumeric: "tabular-nums",
};
export const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;

/** localStorage-backed string state (never throws). */
export function useStoredState<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = React.useState<T>(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      if (s != null && allowed.includes(s)) return s;
    } catch { /* storage unavailable */ }
    return initial;
  });
  const set = React.useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, next); } catch { /* ignore */ }
  }, [key]);
  return [v, set];
}

/** "обновлено N сек назад" — ticks every 10s. */
export function useAgo(ts: number | undefined): string {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const id = window.setInterval(force, 10_000);
    return () => window.clearInterval(id);
  }, []);
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "обновлено только что";
  if (s < 60) return `обновлено ${s} сек назад`;
  return `обновлено ${Math.round(s / 60)} мин назад`;
}
