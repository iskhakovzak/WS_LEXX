/**
 * Auto-hints for the journal day view. All money / leak math comes pre-computed from GET /api/day-report
 * (leaks, timeline with ET entry times, summary) — this file only selects and phrases it, plus one thing the
 * report does not flag on its own: trades in the first minutes after the open.
 */
import { fmtUsd, pluralRu } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";

export type HintTone = "down" | "warn" | "up" | "accent";
export type DayHint = { id: string; tone: HintTone; text: string; detail?: string; tradeIds?: number[] };

/** Minimal shape of the day report this file reads (mirror of components/day-report/api DayReport). */
export type HintSource = {
  summary: { closed: number; net: number; winRate: number | null; feeShareOfGross: number | null; best: { ticker: string; net: number | null } | null };
  timeline: Array<{ id: number; entryTime: string | null; net: number | null }>;
  leaks: Array<{ kind: string; title: string; detail: string; tradeIds: number[]; netUsd: number; costUsd: number; severity: "high" | "medium" | "low" }>;
};

const OPEN_MIN = 9 * 60 + 30;

function minutesOf(hhmmss: string | null): number | null {
  if (!hhmmss) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmmss);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Trades entered within `minutes` after the 09:30 ET open (premarket entries excluded). */
export function openingWindow(timeline: HintSource["timeline"], minutes = 15): { count: number; net: number; ids: number[] } {
  let count = 0, net = 0;
  const ids: number[] = [];
  for (const t of timeline) {
    const m = minutesOf(t.entryTime);
    if (m == null || m < OPEN_MIN || m >= OPEN_MIN + minutes) continue;
    count++;
    net += t.net ?? 0;
    ids.push(t.id);
  }
  return { count, net: Math.round(net * 100) / 100, ids };
}

const SEVERITY_TONE: Record<string, HintTone> = { high: "down", medium: "warn", low: "warn" };

export function dayHints(
  src: HintSource | null | undefined,
  extra: { untagged?: number; violations?: number } = {},
  max = 5,
): DayHint[] {
  const out: DayHint[] = [];
  if (src && src.summary.closed > 0) {
    const open = openingWindow(src.timeline);
    if (open.count >= 3 || (open.count >= 2 && open.net < 0)) {
      out.push({
        id: "opening",
        tone: open.net < 0 ? "down" : "warn",
        text: `${commonI18n.t("units.trades", { count: open.count })} в первые 15 минут, ${fmtUsd(open.net, { signed: true, decimals: "auto" })}`,
        detail: open.net < 0 ? "Открытие стоило денег — подождите формирования уровней." : "Много входов на открытии — проверьте, все ли по плану.",
        tradeIds: open.ids,
      });
    }
    const leaks = [...src.leaks].sort((a, b) => b.costUsd - a.costUsd).slice(0, 3);
    for (const l of leaks) {
      out.push({ id: `leak-${l.kind}`, tone: SEVERITY_TONE[l.severity] ?? "warn", text: `${l.title}: ${fmtUsd(l.netUsd, { signed: true, decimals: "auto" })}`, detail: l.detail, tradeIds: l.tradeIds });
    }
    const fee = src.summary.feeShareOfGross;
    if (fee != null && fee >= 0.3 && !src.leaks.some((l) => l.kind === "fee_over_gross")) {
      out.push({ id: "fees", tone: "warn", text: `Комиссии — ${Math.round(fee * 100)}% брутто`, detail: "Меньше мелких сделок или крупнее цель." });
    }
    if (out.length === 0 && src.summary.net > 0 && src.summary.best?.net != null) {
      out.push({
        id: "best",
        tone: "up",
        text: `Чистый день: лучшая сделка ${src.summary.best.ticker} ${fmtUsd(src.summary.best.net, { signed: true, decimals: "auto" })}`,
        detail: src.summary.winRate != null ? `Винрейт ${Math.round(src.summary.winRate * 100)}% — запишите, что повторять.` : undefined,
      });
    }
  }
  if (extra.violations) {
    out.push({ id: "violations", tone: "warn", text: `${extra.violations} ${pluralRu(extra.violations, "нарушение", "нарушения", "нарушений")} правил`, detail: "Отмечено автоматически по сделкам дня." });
  }
  if (extra.untagged) {
    out.push({
      id: "untagged",
      tone: "accent",
      text: `У ${extra.untagged} ${pluralRu(extra.untagged, "сделки", "сделок", "сделок")} нет сетапа`,
      detail: "Не обязательно для закрытия дня, но без сетапа статистика по сетапам неполная.",
    });
  }
  return out.slice(0, max);
}
