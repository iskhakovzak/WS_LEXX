/**
 * The real example on a cheat sheet: the setup's Tier 1 example (else the best Tier 2) as 5-minute candles of the
 * pattern's part of the day, with VWAP, the bell, the entry ▲/▼ and the exit ● marked. Caption «Пример: AMD · 16 окт ·
 * Short · вход 9:41» — never a trader name or someone else's $ (the examples API redacts; the chart only needs prices
 * and times). Click → the desk day of that ticker (every desk entry / exit on one chart). The canvas follows the
 * container width (full width on phones) and the theme.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { readChartTheme, type Candle } from "@/components/chart-engine";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { fmtDate } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { useSetupExamples } from "../api";
import type { SetupExample } from "../model";
import { buildExampleView, clockText, nyMinuteOf, pickExample, type ExampleView } from "./example-model";

const dayOf = (ex: SetupExample) => (ex.closeDate ?? ex.date).slice(0, 10);

/** The example of a setup and its chart view: "loading" while either request runs, "none" = draw the schematic. */
export function useExampleChart(setupId: number, enabled = true): { state: "loading" | "none" | "ready"; ex: SetupExample | null; view: ExampleView | null } {
  const examples = useSetupExamples(setupId, enabled);
  const ex = useMemo(() => pickExample(examples.data), [examples.data]);
  const day = ex ? dayOf(ex) : null;
  const candles = useQuery({
    queryKey: ["playbook-example-candles", ex?.ticker ?? null, day],
    queryFn: ({ signal }) =>
      http.get<{ candles: Candle[] }>(`/api/candles/${encodeURIComponent(ex?.ticker ?? "")}/range`, { query: { from: day, to: day, interval: "5m", extended: 1 }, signal }),
    enabled: enabled && !!ex && !!day,
    staleTime: STALE.long,
    retry: false,
  });
  const view = useMemo(() => (ex && candles.data ? buildExampleView(candles.data.candles ?? [], ex) : null), [ex, candles.data]);
  if (!enabled) return { state: "none", ex: null, view: null };
  if (examples.isLoading || (ex && candles.isLoading)) return { state: "loading", ex, view: null };
  return view && ex ? { state: "ready", ex, view } : { state: "none", ex: null, view: null };
}

/** Redraw on theme switches (the html class changes). */
function useThemeTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setN((v) => v + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return n;
}

function draw(canvas: HTMLCanvasElement, view: ExampleView, width: number, height: number) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const th = readChartTheme();
  const padT = 10, padB = 20, padX = 6;
  const n = view.bars.length;
  const slot = (width - padX * 2) / n;
  const x = (i: number) => padX + slot * (i + 0.5);
  const span = view.hi - view.lo || 1;
  const y = (p: number) => padT + (1 - (p - view.lo) / span) * (height - padT - padB);
  const body = Math.max(1, Math.min(10, slot * 0.64));

  // The trade's time: a faint band from the entry bar to the exit bar.
  if (view.entryIdx != null) {
    const a = view.entryIdx, b = view.exitIdx ?? view.entryIdx;
    ctx.fillStyle = th.primary(0.1);
    ctx.fillRect(x(a) - slot / 2, padT - 4, (b - a + 1) * slot, height - padT - padB + 8);
  }
  // The bell.
  if (view.bellIdx != null) {
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = th.muted(0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(view.bellIdx) - slot / 2) + 0.5, padT - 6);
    ctx.lineTo(Math.round(x(view.bellIdx) - slot / 2) + 0.5, height - padB + 2);
    ctx.stroke();
    ctx.restore();
  }
  // Candles.
  view.bars.forEach((c, i) => {
    const color = c.c >= c.o ? th.up : th.down;
    const cx = Math.round(x(i)) + 0.5;
    ctx.strokeStyle = color(0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, y(c.h));
    ctx.lineTo(cx, y(c.l));
    ctx.stroke();
    const top = y(Math.max(c.o, c.c));
    const h = Math.max(1, y(Math.min(c.o, c.c)) - top);
    ctx.fillStyle = color(0.85);
    ctx.fillRect(x(i) - body / 2, top, body, h);
  });
  // VWAP.
  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.strokeStyle = th.c5(0.95);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  view.vwap.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    if (pen) ctx.lineTo(x(i), y(v)); else ctx.moveTo(x(i), y(v));
    pen = true;
  });
  ctx.stroke();
  ctx.restore();
  // Entry level to the exit, the entry triangle and the exit dot.
  if (view.entryIdx != null && view.entryPrice != null) {
    const ex = x(view.entryIdx);
    const ey = y(view.entryPrice);
    if (view.exitIdx != null && view.exitPrice != null) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = th.primary(0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(x(view.exitIdx), y(view.exitPrice));
      ctx.stroke();
      ctx.restore();
    }
    const dir = view.side === "short" ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 6, ey + dir * 10);
    ctx.lineTo(ex + 6, ey + dir * 10);
    ctx.closePath();
    ctx.fillStyle = th.primary(1);
    ctx.strokeStyle = th.bg(1);
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  if (view.exitIdx != null && view.exitPrice != null) {
    ctx.beginPath();
    ctx.arc(x(view.exitIdx), y(view.exitPrice), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = (view.win === false ? th.down : th.up)(1);
    ctx.strokeStyle = th.bg(1);
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  // Time ticks.
  ctx.fillStyle = th.muted(1);
  ctx.font = `12px ${th.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const tk of view.ticks) ctx.fillText(tk.label, x(tk.idx) - slot / 2, height - 5);
}

function ChartCanvas({ view, label }: { view: ExampleView; label: string }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const themeTick = useThemeTick();
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(120, Math.floor(el.clientWidth)), h: Math.max(120, Math.floor(el.clientHeight)) });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (canvas.current && size) draw(canvas.current, view, size.w, size.h);
  }, [view, size, themeTick]);
  return (
    <div ref={wrap} className="relative h-[168px] w-full sm:h-[188px]">
      <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 block h-full w-full" />
    </div>
  );
}

/** Chart + caption, the whole block opens the desk day of the example. */
/** `onOpen`: called when the link is followed (the quick sheet closes itself over the desk day). */
export function ExampleChart({ ex, view, className, onOpen }: { ex: SetupExample; view: ExampleView; className?: string; onOpen?: () => void }) {
  const { t } = playbookTodayI18n.useT();
  const day = dayOf(ex);
  const entryMin = nyMinuteOf(ex.entryTime);
  const exitMin = nyMinuteOf(ex.exitTime);
  const params = { ticker: ex.ticker, date: fmtDate(day, "dayMonth"), side: ex.side || "—", time: entryMin != null ? clockText(entryMin) : "" };
  const caption = entryMin != null ? t("example.caption", params) : t("example.captionNoTime", params);
  const label = t("example.aria", { caption, exit: exitMin != null ? clockText(exitMin) : "—" });
  return (
    <Link
      href={links.deskDay(ex.ticker, day)}
      title={t("example.open")}
      onClick={onOpen}
      className={cn("group flex min-w-0 flex-col gap-1.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <ChartCanvas view={view} label={label} />
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 text-sm">
        <span className="font-medium text-foreground">{caption}</span>
        <span className="text-xs text-muted-foreground">{t("example.legend", { arrow: view.side === "short" ? "▼" : "▲" })}</span>
        <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-primary group-hover:underline">
          {t("example.openShort")} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}

/** Placeholder of the chart's size while the example loads. */
export function ExampleChartSkeleton() {
  return <div className="h-[200px] w-full animate-pulse rounded-xl bg-[var(--glass-bg)] motion-reduce:animate-none sm:h-[220px]" aria-hidden="true" />;
}
