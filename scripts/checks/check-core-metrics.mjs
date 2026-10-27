#!/usr/bin/env node
/**
 * «One truth» guard (docs/one-truth/INVENTORY.md): the five core numbers — net P&L, win rate, drawdown, breakeven win
 * rate / payoff, profit factor — are computed only by their shared module:
 *
 *   server  artifacts/api-server/src/lib/coreMetrics/** (+ the SQL / JS primitives it re-exports from lib/tradeMath.ts
 *           and the risk desk's state machine lib/riskMetrics.ts)
 *   web     artifacts/edge-tracker/src/lib/trade-math.ts (the client mirror)
 *
 * Anywhere else a known formula shape fails the check: the inline win rate `wins / (wins + losses)`, the breakeven
 * win rate `1 / (1 + avgWin / |avgLoss|)`, the peak-tracking drawdown loop, the net P&L SQL `pnl - ABS(fees)`.
 * Not a ratchet — there is no baseline: a hit is fixed by calling the shared function. A place that honestly computes
 * something else with the same shape (an intraday giveback, a slice of a book …) says so on the line or the line above
 * with `// core-metric-ok: <why>`; the reason is mandatory.
 *
 *   node scripts/checks/check-core-metrics.mjs [--list]
 */
import fs from "node:fs";
import path from "node:path";
import { REPO, isTestFile, rel, walk } from "./lib/ratchet.mjs";

const ROOTS = ["artifacts/api-server/src", "artifacts/edge-tracker/src"].map((r) => path.join(REPO, r));
const CANONICAL = [
  /^artifacts\/api-server\/src\/lib\/coreMetrics\//,
  /^artifacts\/api-server\/src\/lib\/tradeMath\.ts$/,
  /^artifacts\/api-server\/src\/lib\/riskMetrics\.ts$/,
  /^artifacts\/edge-tracker\/src\/lib\/trade-math\.ts$/,
];
const SKIP = [/\/i18n\//, /\.d\.ts$/];

const W = String.raw`[\w.?!\[\]]*?`; // an optional `obj.` / `s.` / `x?.` prefix
const RULES = [
  {
    id: "win-rate",
    re: new RegExp(String.raw`\b${W}wins?\w*(?:\.length)?\s*\/\s*\(\s*${W}wins?\w*(?:\.length)?\s*\+\s*${W}loss(?:es)?\w*(?:\.length)?\s*\)`, "i"),
    fix: "winRateOf(wins, losses) (server lib/coreMetrics, web lib/trade-math)",
  },
  {
    id: "win-rate",
    re: /\b[\w.]*wins\w*\s*\/\s*[\w.]*decided\b/,
    fix: "winRateOf(wins, losses) (server lib/coreMetrics, web lib/trade-math)",
  },
  {
    id: "win-rate-sql",
    re: /'win'\s*\)\s*::\s*(?:float8?|numeric|real)\s*\/\s*NULLIF\s*\(/i,
    fix: "count wins / losses in SQL, divide with winRateOf(wins, losses)",
  },
  {
    id: "win-rate-sql",
    re: /\bwins?\w*\s*(?:::\s*(?:float8?|numeric|real))?\s*\/\s*NULLIF\s*\(\s*\w*wins?\w*\s*\+\s*\w*loss/i,
    fix: "count wins / losses in SQL, divide with winRateOf(wins, losses)",
  },
  {
    id: "breakeven-wr",
    re: /\b1\s*\/\s*\(\s*1\s*\+\s*[\w.]+\s*\/\s*Math\.abs\(/,
    fix: "breakevenWinRate(avgWin, avgLoss) / edgeMargin(nets)",
  },
  {
    id: "breakeven-wr",
    re: /Math\.abs\(\s*[\w.]+\s*\)\s*\/\s*\(\s*[\w.]+\s*\+\s*Math\.abs\(\s*[\w.]+\s*\)\s*\)/,
    fix: "breakevenWinRate(avgWin, avgLoss) / edgeMargin(nets)",
  },
  {
    id: "breakeven-wr",
    re: /-\s*avgLoss\w*\s*\/\s*\(\s*avgWin\w*\s*-\s*avgLoss|\b1\s*\/\s*\(\s*1\s*\+\s*[\w.]*payoff\w*\s*\)/i,
    fix: "breakevenWinRate(avgWin, avgLoss) / breakevenOfPayoff(payoff)",
  },
  {
    id: "drawdown-loop",
    re: /\bif\s*\(\s*[\w.]*cum\w*\s*>\s*[\w.]*peak\w*\s*\)\s*[\w.]*peak\w*\s*=\s*[\w.]*cum\w*|\b[\w.]*peak\w*\s*=\s*Math\.max\(\s*[\w.]*peak\w*\s*,\s*[\w.]*cum\w*\s*\)/,
    fix: "maxDrawdownOfSeries / drawdownOf (lib/coreMetrics) or the risk desk's riskStateOf (drawdown from peak now)",
  },
  {
    id: "net-pnl-sql",
    re: /\bpnl\s*-\s*ABS\s*\(\s*COALESCE\s*\(\s*\w*\.?fees/i,
    fix: "netPnlSql(alias) (lib/coreMetrics)",
  },
];
const OK = /core-metric-ok:\s*\S/;

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root, /\.(ts|tsx|mts)$/)) {
    const r = rel(file);
    if (isTestFile(file) || CANONICAL.some((c) => c.test(r)) || SKIP.some((s) => s.test(r))) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // a comment that names the formula
      for (const rule of RULES) {
        if (!rule.re.test(line)) continue;
        if (OK.test(line) || OK.test(lines[i - 1] ?? "")) continue;
        hits.push({ file: r, line: i + 1, rule, text: line.trim().slice(0, 140) });
      }
    });
  }
}

if (process.argv.includes("--list") || hits.length) {
  for (const h of hits) console.log(`${h.file}:${h.line}  [${h.rule.id}]  ${h.text}\n    → ${h.rule.fix}`);
}
if (hits.length) {
  console.error(`✗ check-core-metrics: ${hits.length} core-metric formula(s) outside the shared module (docs/one-truth/INVENTORY.md). Call the shared function, or mark an honestly different definition with \`// core-metric-ok: <why>\`.`);
  process.exit(1);
}
console.log("✓ check-core-metrics: net P&L, win rate, drawdown and breakeven are computed only by the shared modules");
