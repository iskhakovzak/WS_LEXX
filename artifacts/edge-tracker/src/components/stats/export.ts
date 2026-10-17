import type { Trade } from "@workspace/api-client-react";
import {
  chrono, dailySeries, dayKey, feesOf, fmtValue, horizonOf, HORIZON_LABEL, sessionKey, sessionLabel, tx, valueOf,
  type FeeStats, type Kpis, type Metric,
} from "./metrics";
import { fmtDate, fmtRate, fmtRatio } from "@/lib/format";

export type ReportMeta = { title: string; periodLabel: string; scopeLabel: string; metric: Metric; generatedAt: Date; fees?: FeeStats };

const METRIC_NAME: Record<Metric, string> = { r: "R-multiple", usd: "P&L gross, $", net: "P&L net (после комиссий), $" };

function kpiRows(k: Kpis, prev: Kpis | null, metric: Metric): [string, string, string][] {
  const p = prev && prev.total > 0 ? prev : null;
  const v = (x: number | null | undefined) => fmtValue(x ?? null, metric);
  return [
    ["Сделок", String(k.total), p ? String(p.total) : ""],
    ["Закрыто / открыто", `${k.closed} / ${k.open}`, p ? `${p.closed} / ${p.open}` : ""],
    ["Win / Loss / BE", `${k.wins} / ${k.losses} / ${k.breakeven}`, p ? `${p.wins} / ${p.losses} / ${p.breakeven}` : ""],
    ["Win rate", fmtRate(k.winRate), p ? fmtRate(p.winRate) : ""],
    ["Результат", v(k.net), p ? v(p.net) : ""],
    ["Матожидание на сделку", v(k.expectancy), p ? v(p.expectancy) : ""],
    ["Profit factor", fmtRatio(k.profitFactor), p ? fmtRatio(p.profitFactor) : ""],
    ["Payoff", fmtRatio(k.payoff), p ? fmtRatio(p.payoff) : ""],
    ["Средняя прибыль", v(k.avgWin), p ? v(p.avgWin) : ""],
    ["Средний убыток", v(k.avgLoss), p ? v(p.avgLoss) : ""],
    ["Лучшая сделка", v(k.bestTrade), p ? v(p.bestTrade) : ""],
    ["Худшая сделка", v(k.worstTrade), p ? v(p.worstTrade) : ""],
    ["Макс. просадка", v(k.maxDrawdown), p ? v(p.maxDrawdown) : ""],
    ["Лучшая серия побед", String(k.longestWin), p ? String(p.longestWin) : ""],
    ["Худшая серия убытков", String(k.longestLoss), p ? String(p.longestLoss) : ""],
    ["Торговых дней (зел./красн.)", `${k.tradingDays} (${k.greenDays}/${k.redDays})`, p ? `${p.tradingDays} (${p.greenDays}/${p.redDays})` : ""],
  ];
}

const csvCell = (x: unknown) => {
  const s = x == null ? "" : String(x);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (semicolon-separated, UTF-8 BOM — opens correctly in Russian Excel). */
export function downloadReportCsv(trades: Trade[], k: Kpis, prev: Kpis | null, meta: ReportMeta) {
  const lines: string[] = [];
  const row = (...cells: unknown[]) => lines.push(cells.map(csvCell).join(";"));
  row(meta.title);
  row("Период", meta.periodLabel);
  row("Трейдер", meta.scopeLabel);
  row("Метрика", METRIC_NAME[meta.metric]);
  if (meta.fees) row("Gross / комиссии / net, $", meta.fees.gross?.toFixed(2) ?? "", meta.fees.fees.toFixed(2), meta.fees.net?.toFixed(2) ?? "");
  row("Сформирован", fmtDate(meta.generatedAt, "shortDateTime"));
  row();
  row("Показатель", "Текущий период", "Предыдущий период");
  kpiRows(k, prev, meta.metric).forEach((r) => row(...r));
  row();
  row("Дата", "Сделок", "Win", "Loss", meta.metric === "r" ? "Итого R" : meta.metric === "net" ? "Итого net $" : "Итого gross $");
  dailySeries(trades, meta.metric).forEach((d) => row(d.key, d.count, d.wins, d.losses, d.value == null ? "" : d.value.toFixed(2)));
  row();
  row("ID", "Дата", "Дата выхода", "Тикер", "Трейдер", "Горизонт", "Сторона", "Сетап", "Сессия", "Результат", "R", "P&L gross", "Комиссии", "P&L net");
  chrono(trades).forEach((t) =>
    row(t.id, dayKey(t), tx(t).exitDate ? String(tx(t).exitDate).substring(0, 10) : "", t.ticker, t.trader ?? "", HORIZON_LABEL[horizonOf(t)],
      t.side ?? "", t.setup || t.eventType || "", sessionLabel(sessionKey(t)), t.result,
      t.rMultiple ?? "", t.pnl ?? "", feesOf(t) || "", valueOf(t, "net") ?? ""),
  );
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ws-lexx-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Opens a clean, print-ready report in a new window (independent of the app shell/sidebar) and triggers print.
 * Returns false if the popup was blocked.
 */
export function openPrintReport(trades: Trade[], k: Kpis, prev: Kpis | null, meta: ReportMeta): boolean {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return false;
  const kpis = kpiRows(k, prev, meta.metric)
    .map(([a, b, c]) => `<tr><td>${esc(a)}</td><td class="n">${esc(b)}</td><td class="n muted">${esc(c)}</td></tr>`)
    .join("");
  const list = chrono(trades)
    .map((t) => {
      const val = valueOf(t, meta.metric);
      return `<tr><td>${esc(dayKey(t))}</td><td><b>${esc(t.ticker)}</b></td><td>${esc(t.trader ?? "")}</td><td>${esc(HORIZON_LABEL[horizonOf(t)])}</td><td>${esc(t.setup || t.eventType || "")}</td><td>${esc(t.result)}</td><td class="n">${esc(val == null ? "—" : fmtValue(val, meta.metric))}</td></tr>`;
    })
    .join("");
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(meta.title)}</title>
<style>
  body{font:13px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:32px;}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#555;margin:0 0 20px}
  h2{font-size:14px;margin:24px 0 8px}
  table{border-collapse:collapse;width:100%} td,th{padding:5px 8px;border-bottom:1px solid #ddd;text-align:left}
  th{font-weight:600;color:#555;font-size:12px} .n{text-align:right;font-variant-numeric:tabular-nums} .muted{color:#777}
  @media print{body{margin:12mm} tr{break-inside:avoid}}
</style></head><body>
<h1>${esc(meta.title)}</h1>
<p class="sub">${esc(meta.periodLabel)} · ${esc(meta.scopeLabel)} · метрика: ${esc(METRIC_NAME[meta.metric])} · ${esc(fmtDate(meta.generatedAt, "shortDateTime"))}</p>
<h2>Показатели</h2>
<table><thead><tr><th>Показатель</th><th class="n">Период</th><th class="n">Пред. период</th></tr></thead><tbody>${kpis}</tbody></table>
${meta.fees && meta.fees.gross != null ? `<h2>Gross / комиссии / net</h2><table><tbody><tr><td>P&amp;L gross</td><td class="n">${esc(fmtValue(meta.fees.gross, "usd"))}</td></tr><tr><td>Комиссии</td><td class="n">${esc(fmtValue(-meta.fees.fees, "usd"))}</td></tr><tr><td><b>P&amp;L net</b></td><td class="n"><b>${esc(fmtValue(meta.fees.net, "usd"))}</b></td></tr></tbody></table>` : ""}
<h2>Сделки (${trades.length})</h2>
<table><thead><tr><th>Дата</th><th>Тикер</th><th>Трейдер</th><th>Горизонт</th><th>Сетап</th><th>Итог</th><th class="n">${meta.metric === "r" ? "R" : meta.metric === "net" ? "Net $" : "Gross $"}</th></tr></thead><tbody>${list}</tbody></table>
</body></html>`);
  w.document.close();
  // Printed from here, not by an inline <script> in the popup: the about:blank popup inherits the app's CSP,
  // which blocks inline scripts (scripts/csp-meta.mjs).
  const go = () => setTimeout(() => { w.focus(); w.print(); }, 200);
  if (w.document.readyState === "complete") go();
  else w.addEventListener("load", go, { once: true });
  return true;
}
