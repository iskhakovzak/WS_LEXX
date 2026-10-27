/**
 * Ф7 calibration harness of the honest «Что если» path (lib/whatIfHonesty; WHATIF_HONESTY_SPEC.md §15). LOCAL and
 * READ-ONLY; not part of CI. Run from artifacts/api-server:
 *
 *   pnpm whatif:calibrate [--schema cleanup_backup_20261019 | public] [--traders 8 | all] [--only T01,T05]
 *                         [--seeds 3] [--strengths 0.2,0.4] [--runs N1,N2,E1,…,E7,ASIS] [--quick] [--workers N]
 *                         [--mde] [--centre] [--time] [--json out.json] [--reeval out.json [--group losing|winning]]
 *
 *   --quick   600 → 300 bootstrap replicates and 200 → 100 permutations (the engine default is the real thing)
 *   --mde     also re-runs every E1–E5 case truncated to the N* days its MDE predicts (is the predicted N* enough?)
 *   --centre  N1 / E-runs on a zero-mean base (each trade −= the trader's mean net): the pure null. Without it a losing
 *             trader's shuffled data still rewards any rule that removes trades («trade less» is real there)
 *   --time    serial timing per trader of load + signature + computeHonesty at the engine defaults (no perturbation)
 *   --reeval  re-decides a saved --json under the threshold profiles without recomputing anything; --group keeps only
 *             the traders whose real net is < 0 (losing) or ≥ 0 (winning)
 * The full desk (20 traders × 3 seeds, 920 runs + the MDE truncations) takes ≈ 4 min on 12 workers.
 *
 * Safety: refuses a non-local host; every connection runs with default_transaction_read_only = on and only SELECTs
 * <schema>.trades and <schema>.trade_executions__by_trade (public: the app's own loader query). Traders are printed
 * as T01 … (by trade count), never by name.
 * Synthetic schema adapter (it has no is_imx / size_rel / has_stop): first entry / last exit from the executions;
 * IMX = entered inside the default 15:50–16:00 window; size_rel = notional / median notional of the trader's previous
 * 60 calendar days (≥ 10 trades, else null); has_stop = stop or structure.stopPrice.
 */
import { CALIBRATE_DB_URL as DB_URL } from "./whatif-calibrate-env";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { DEFAULT_IMX_WINDOW } from "../src/lib/tradeStrategy";
import { computeHonesty } from "../src/lib/whatIfHonesty";
import { tradesSignature } from "../src/lib/whatIfSignature";
import { slotLegs } from "../src/lib/whatIfWalkForward";
import type { SimTrade } from "../src/lib/whatIfTypes";
import {
  computeRun, DEFAULT_PROFILE, EFFECTS, hashSeed, isTarget, pct, type Profile, type RunKind, type RunResult, selfCheck, summarize, type Task,
} from "./whatif-calibrate-lib";

type Row = Record<string, unknown>;

/* ───────────────────────── arguments ───────────────────────── */

function args() {
  const a = process.argv.slice(2);
  const opt = (name: string) => { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : undefined; };
  const flag = (name: string) => a.includes(name);
  const quick = flag("--quick");
  return {
    schema: opt("--schema") ?? "cleanup_backup_20261019",
    traders: opt("--traders") ?? "8",
    only: opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    seeds: Number(opt("--seeds") ?? 3),
    strengths: (opt("--strengths") ?? "0.2,0.4").split(",").map(Number),
    runs: (opt("--runs") ?? "N1,N2,E1,E2,E3,E4,E5,E6,E7,ASIS").split(",").map((s) => s.trim()) as RunKind[],
    iters: Number(opt("--iters") ?? (quick ? 300 : 600)),
    perms: Number(opt("--perms") ?? (quick ? 100 : 200)),
    workers: Number(opt("--workers") ?? Math.max(1, Math.min(12, cpus().length - 4))),
    mde: flag("--mde"),
    centre: flag("--centre"),
    group: opt("--group") as "losing" | "winning" | undefined,
    time: flag("--time"),
    json: opt("--json"),
    reeval: opt("--reeval"),
  };
}

/* ───────────────────────── loading (read-only) ───────────────────────── */

interface Db { query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; end(): Promise<void> }

async function connect(): Promise<Db> {
  const host = new URL(DB_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    console.error(`whatif-calibrate: refusing non-local database host "${host}"`);
    process.exit(2);
  }
  const { createPool } = await import("@workspace/db");
  return createPool(DB_URL, { max: 2, options: "-c TimeZone=UTC -c default_transaction_read_only=on" }) as unknown as Db;
}

function syntheticSql(schema: string): string {
  return `
    SELECT t.id, t.ticker, t.date, t.exit_date, t.side, t.qty, t.entry, t.exit, t.stop, t.result, t.pnl, t.fees, t.r_multiple,
           t.risk_usd, t.hold_time, t.setup, t.confidence_grade, t.tags, t.horizon, t.context_snapshot, e.first_entry, e.last_exit,
           t.trader, TRUE AS is_imx, t.reentry_of, (t.stop IS NOT NULL OR COALESCE(t.structure ? 'stopPrice', FALSE)) AS has_stop
      FROM ${schema}.trades t
      LEFT JOIN (
        SELECT x.trade_id,
               MIN(x.executed_at) FILTER (WHERE x.kind IN ('entry','add')) AS first_entry,
               MAX(x.executed_at) FILTER (WHERE x.kind IN ('exit','stop','trim')) AS last_exit
          FROM ${schema}.trade_executions__by_trade x
         WHERE x.executed_at IS NOT NULL AND x.trade_id IN (SELECT id FROM ${schema}.trades WHERE trader = $1)
         GROUP BY x.trade_id
      ) e ON e.trade_id = t.id
     WHERE t.deleted_at IS NULL AND t.pnl IS NOT NULL AND LOWER(TRIM(t.result)) <> 'open' AND t.trader = $1
     ORDER BY substring(t.date from 1 for 10), e.first_entry NULLS LAST, t.id`;
}

/** size_rel = |qty|·entry / median of the trader's notionals over the previous 60 calendar days (≥ 10 trades). */
function withSizeRel(rows: Row[]): Row[] {
  const notional = rows.map((r) => Math.abs(Number(r.qty)) * Number(r.entry));
  const dayMs = rows.map((r) => Date.parse(`${String(r.date).slice(0, 10)}T00:00:00Z`));
  const order = rows.map((_, i) => i).sort((a, b) => dayMs[a] - dayMs[b] || a - b);
  const medianByDay = new Map<number, number | null>();
  let lo = 0;
  for (let k = 0; k < order.length; k++) {
    const d = dayMs[order[k]];
    if (medianByDay.has(d)) continue;
    while (lo < k && dayMs[order[lo]] < d - 60 * 86_400_000) lo++;
    const win = order.slice(lo, k).filter((i) => dayMs[i] < d).map((i) => notional[i]).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    medianByDay.set(d, win.length >= 10 ? (win[(win.length - 1) >> 1] + win[win.length >> 1]) / 2 : null);
  }
  return rows.map((r, i) => {
    const m = medianByDay.get(dayMs[i]);
    return { ...r, size_rel: m != null && Number.isFinite(notional[i]) && notional[i] > 0 ? notional[i] / m : null };
  });
}

async function loadTrader(db: Db, schema: string, name: string): Promise<SimTrade[]> {
  const { rowToSim, simTradesQuery } = await import("../src/lib/whatIfLoader");
  if (schema === "public") {
    const { sql, params } = simTradesQuery(name);
    const { rows } = await db.query(sql, params);
    const { currentImxWindow } = await import("../src/lib/imx");
    const win = currentImxWindow();
    return rows.map((r, i) => rowToSim(r as never, i, win));
  }
  const { rows } = await db.query(syntheticSql(schema), [name]);
  return withSizeRel(rows).map((r, i) => rowToSim(r as never, i, DEFAULT_IMX_WINDOW));
}

async function traderList(db: Db, schema: string): Promise<{ name: string; n: number; net: number }[]> {
  const { rows } = await db.query<{ trader: string; n: number; net: number }>(`
    SELECT trader, COUNT(*)::int AS n, SUM(pnl - ABS(COALESCE(fees, 0)))::float AS net FROM ${schema}.trades
     WHERE deleted_at IS NULL AND pnl IS NOT NULL AND LOWER(TRIM(result)) <> 'open' AND trader IS NOT NULL
     GROUP BY trader HAVING COUNT(*) >= 30 ORDER BY n DESC, trader`);
  return rows.map((r) => ({ name: r.trader, n: Number(r.n), net: Number(r.net) }));
}

/* ───────────────────────── worker pool ───────────────────────── */

async function runPool(tasks: Task[], workers: number): Promise<RunResult[]> {
  const out: RunResult[] = [];
  if (!tasks.length) return out;
  const file = fileURLToPath(import.meta.url);
  let next = 0, done = 0;
  const t0 = Date.now();
  await new Promise<void>((resolve, reject) => {
    const feed = (w: Worker) => {
      if (next < tasks.length) w.postMessage(tasks[next++]);
      else void w.terminate();
    };
    for (let i = 0; i < Math.min(workers, tasks.length); i++) {
      const w = new Worker(file);
      w.on("message", (m: { ok: boolean; r?: RunResult; key?: string; error?: string }) => {
        if (!m.ok || !m.r) { reject(new Error(`${m.key}: ${m.error}`)); return; }
        out.push(m.r);
        done++;
        if (done % 10 === 0 || done === tasks.length) {
          process.stderr.write(`  ${done}/${tasks.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
        }
        if (done === tasks.length) resolve();
        feed(w);
      });
      w.on("error", reject);
      feed(w);
    }
  });
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/* ───────────────────────── profiles (the documented knobs only) ───────────────────────── */

const PROFILES: Profile[] = [
  DEFAULT_PROFILE,
  // The pre-calibration constants (HONESTY version 1): the before / after comparison on the same runs.
  { ...DEFAULT_PROFILE, name: "v1 (pos .6, z 2.8)", posShare: 0.6, mdeZ: 2.8 },
  { ...DEFAULT_PROFILE, name: "alpha .05", alpha: 0.05 },
  { ...DEFAULT_PROFILE, name: "q .10", q: 0.1 },
  { ...DEFAULT_PROFILE, name: "BY", fdr: "by" },
  { ...DEFAULT_PROFILE, name: "days 15", confirmDays: 15 },
  { ...DEFAULT_PROFILE, name: "frag 20", fragileDays: 20 },
  { ...DEFAULT_PROFILE, name: "alpha .05 + BY", alpha: 0.05, fdr: "by" },
  { ...DEFAULT_PROFILE, name: "pos .6", posShare: 0.6 },
  { ...DEFAULT_PROFILE, name: "pos .67", posShare: 0.67 },
  { ...DEFAULT_PROFILE, name: "z 2.8", mdeZ: 2.8 },
];

/* ───────────────────────── printing ───────────────────────── */

function printSummary(runs: RunResult[], losing: ReadonlySet<string>, profiles: Profile[]): ReturnType<typeof summarize>[] {
  const sums = profiles.map((p) => summarize(runs, p, losing));
  console.info("\n== Nulls (verdict level: any slot with that status) ==");
  console.info(["profile", "N1 any confirmed", "  losing", "  winning", "N1 any hypothesis", "N2 ordering confirmed"].join(" | "));
  for (const s of sums) {
    console.info([s.profile, pct(s.n1Confirmed), pct(s.n1ConfirmedLosing), pct(s.n1ConfirmedWinning), pct(s.n1Hyp), pct(s.n2OrderingConfirmed)].join(" | "));
  }
  const d = sums[0];
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(", ") || "—";
  console.info(`N1 confirmed slots (default): ${top(d.n1Ids)}`);
  console.info(`N2 confirmed ordering slots (default): ${top(d.n2Ids)}`);
  console.info("\n== Planted effects: target slot confirmed / ≥ hypothesis (null = same target already confirmed on the N1 base) ==");
  for (const s of sums) {
    console.info(`-- profile ${s.profile}`);
    console.info(["run", "k", "confirmed", "≥ hypothesis", "null", "≥1500 trades", "<1500", "shown fragile", "n/a"].join(" | "));
    for (const e of s.effects) {
      console.info([e.kind, e.k, pct(e.confirmed), pct(e.atLeastHyp), pct(e.nullConfirmed), pct(e.bigConfirmed), pct(e.smallConfirmed), pct(e.fragileShown), e.skipped].join(" | "));
    }
  }
  console.info("\n== AS-IS (default profile) ==");
  for (const a of d.asis) {
    console.info(`${a.trader} n=${a.n}: confirmed [${a.confirmed.join(", ") || "—"}], hypotheses ${a.hypotheses}, shown ${a.shown} (fragile ${a.fragileShown})`);
  }
  return sums;
}

function printAsisDetail(runs: RunResult[]): void {
  console.info("\n== AS-IS detail (engine cards) ==");
  for (const r of runs.filter((x) => x.kind === "ASIS" && !x.skip)) {
    console.info(`${r.trader}: n=${r.n} days=${r.days} months=${r.months} wf=${r.wfAvailable} tested=${r.tested} (ordering ${r.testedOrdering})`);
    for (const c of r.cards) {
      const v = r.verdicts.find((x) => x.id === c.id);
      const top3 = v ? v.top.slice(0, 3).reduce((s, x) => s + x, 0) : 0;
      console.info(`   ${c.status.padEnd(10)} ${c.id.padEnd(18)} Δ=${v?.delta} oos=${v?.wf.sum} (+${v?.wf.positive}/${r.folds}) pAdj=${v?.pAdj} q≈ pRaw=${v?.pRaw} days=${v?.affectedDays} top3=${top3.toFixed(0)} ${c.fragile ?? ""}`);
    }
  }
}

/** The first-step critical value under the null (N1) and on the data as it is (spec §7.2 / §15.4 MDE knob). */
function printFirstStep(runs: RunResult[]): void {
  for (const kind of ["N1", "ASIS"] as const) {
    const d = runs.filter((r) => r.kind === kind && r.diag && r.prefixDays == null).map((r) => r.diag as NonNullable<RunResult["diag"]>);
    if (!d.length) continue;
    const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const ids = new Map<string, number>();
    for (const x of d) for (const id of x.shifted) ids.set(id, (ids.get(id) ?? 0) + 1);
    console.info(`
== First Romano–Wolf step, ${kind} (${d.length} runs) ==`);
    console.info(`family m median ${med(d.map((x) => x.m))}; c1 (t needed for pAdj ≤ .10) median ${med(d.map((x) => x.c1))}, range ${Math.min(...d.map((x) => x.c1))}–${Math.max(...d.map((x) => x.c1))}`);
    console.info(`c1 with every slot's null centred at 0: median ${med(d.map((x) => x.c1Centred))}`);
    console.info(`mean null T: refit slots ${med(d.map((x) => x.meanTRefit))}, fixed slots ${med(d.map((x) => x.meanTFixed))} (medians)`);
    console.info(`slots with null mean T > 1: ${[...ids.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ") || "—"}`);
    console.info(`spec §15.4 MDE knob: c1 + 0.84 = ${(med(d.map((x) => x.c1)) + 0.84).toFixed(2)} (current mde.z ${DEFAULT_PROFILE.mdeZ})`);
  }
}

function timingTable(runs: RunResult[]): void {
  const ms = runs.filter((r) => !r.skip && r.prefixDays == null).map((r) => r.ms).sort((a, b) => a - b);
  if (!ms.length) return;
  const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  console.info(`\nrun time inside the parallel pool (contended): p50 ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${ms[ms.length - 1]} ms over ${ms.length} runs`);
}

/* ───────────────────────── modes ───────────────────────── */

async function timeMode(db: Db, schema: string, list: { name: string; n: number; code: string }[]): Promise<Row[]> {
  console.info("\n== TIME: serial, engine defaults (600 replicates, 200 permutations) ==");
  console.info("trader | trades | days | load ms | sig ms | honesty ms | ms per 1k trades | confirmed | hypotheses (cards)");
  const out: Row[] = [];
  let total = 0;
  for (const t of list) {
    const a = performance.now();
    const trades = await loadTrader(db, schema, t.name);
    const b = performance.now();
    tradesSignature(trades);
    const c = performance.now();
    const res = computeHonesty(trades);
    const d = performance.now();
    const row = { trader: t.code, trades: trades.length, days: res.days, loadMs: Math.round(b - a), sigMs: Math.round(c - b), honestyMs: Math.round(d - c), confirmed: res.confirmed, hypotheses: res.hypotheses };
    total += d - a;
    out.push(row);
    console.info([row.trader, row.trades, row.days, row.loadMs, row.sigMs, row.honestyMs, ((1000 * row.honestyMs) / Math.max(1, row.trades)).toFixed(0), row.confirmed, row.hypotheses].join(" | "));
  }
  const hs = out.map((r) => Number(r.honestyMs)).sort((x, y) => x - y);
  console.info(`all ${out.length} traders: ${(total / 1000).toFixed(1)} s in total; honesty p50 ${hs[Math.floor(hs.length / 2)]} ms, p95 ${hs[Math.min(hs.length - 1, Math.floor(0.95 * hs.length))]} ms, max ${hs[hs.length - 1]} ms`);
  return out;
}

/** --mde: every E1–E5 run whose target has a positive per-day μ on every leg, truncated to the N* = max ⌈(z·sd/μ)²⌉ days it predicts. */
function mdeTasks(runs: RunResult[], bases: Map<string, SimTrade[]>, o: ReturnType<typeof args>): Task[] {
  const out: Task[] = [];
  for (const r of runs) {
    if (r.skip || !["E1", "E2", "E3", "E4", "E5"].includes(r.kind)) continue;
    const tg = r.verdicts.filter((v) => isTarget(r.kind, r.plant, v)).sort((a, b) => b.t - a.t)[0];
    if (!tg) continue;
    // N* over every leg the status needs (lib/whatIfWalkForward slotLegs: the dollar effect and its guard).
    const legs = slotLegs(tg.facts, { avail: r.wfAvailable, testDays: r.testDays, D: r.days });
    if (legs.some((l) => !(l.mu > 0))) continue;
    const nStar = Math.max(...legs.map((l) => Math.ceil(((DEFAULT_PROFILE.mdeZ * l.sd) / l.mu) ** 2)));
    // The walk-forward needs 6 months: never truncate below the first 6 months of the trader's days.
    const trades = bases.get(r.trader) as SimTrade[];
    const days = [...new Set(trades.map((t) => t.day))].sort();
    const months = [...new Set(days.map((d) => d.slice(0, 7)))].sort();
    const sixMonths = months.length > 6 ? days.findIndex((d) => d.slice(0, 7) === months[6]) : days.length;
    const prefix = Math.max(nStar, sixMonths);
    if (prefix >= days.length) continue;
    out.push({
      key: `${r.key}|mde${prefix}`, trader: r.trader, kind: r.kind, seed: r.seed, k: r.k, trades, iters: o.iters, perms: o.perms,
      prefixDays: prefix, centre: r.key.endsWith("|c"),
    });
  }
  return out;
}

function printMde(runs: RunResult[]): void {
  const m = runs.filter((r) => r.prefixDays != null && !r.skip);
  if (!m.length) return;
  console.info("\n== MDE check: truncated to the predicted N* days (≥ 6 months) — target confirmed share ==");
  const by = new Map<string, { hit: number; of: number }>();
  for (const r of m) {
    const k = `${r.kind}|${r.k}`;
    const e = by.get(k) ?? { hit: 0, of: 0 };
    e.of++;
    if (r.verdicts.some((v) => isTarget(r.kind, r.plant, v) && v.status === "confirmed")) e.hit++;
    by.set(k, e);
  }
  for (const [k, e] of [...by.entries()].sort()) console.info(`${k}: ${pct(e)}`);
  const all = [...by.values()].reduce((s, e) => ({ hit: s.hit + e.hit, of: s.of + e.of }), { hit: 0, of: 0 });
  console.info(`all: ${pct(all)} (spec §15.4: < 50% → mde.z = c₁ + 0.84)`);
}

async function main(): Promise<void> {
  const o = args();
  if (o.reeval) {
    const saved = JSON.parse(readFileSync(o.reeval, "utf8")) as { runs: RunResult[]; losing: string[] };
    const check = selfCheck(saved.runs);
    console.info(`self-check: ${check.mismatches.length} mismatches over ${check.verdicts} verdicts`);
    const losing = new Set(saved.losing);
    // --group: only the losing (real net < 0) or only the winning traders.
    const runs = o.group ? saved.runs.filter((r) => losing.has(r.trader) === (o.group === "losing")) : saved.runs;
    if (o.group) console.info(`group ${o.group}: ${new Set(runs.map((r) => r.trader)).size} traders, ${runs.length} runs`);
    printSummary(runs, losing, PROFILES);
    printMde(runs);
    printFirstStep(runs);
    return;
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(o.schema)) { console.error(`bad schema name ${o.schema}`); process.exit(2); }
  const db = await connect();
  try {
    const all = (await traderList(db, o.schema)).map((t, i) => ({ ...t, code: `T${String(i + 1).padStart(2, "0")}` }));
    if (!all.length) { console.error(`no traders with ≥ 30 trades in ${o.schema}.trades`); process.exit(1); }
    let pick = all;
    if (o.only) pick = all.filter((t) => o.only?.includes(t.code));
    else if (o.traders !== "all") {
      const want = Math.min(all.length, Number(o.traders));
      const idx = new Set(Array.from({ length: want }, (_, i) => (want === 1 ? 0 : Math.round((i * (all.length - 1)) / (want - 1)))));
      pick = all.filter((_, i) => idx.has(i));
    }
    console.info(`schema ${o.schema}: ${all.length} traders; running ${pick.map((t) => `${t.code}(${t.n})`).join(" ")}; B=${o.iters} P=${o.perms} workers=${o.workers}`);
    if (o.time) {
      const rows = await timeMode(db, o.schema, pick);
      if (o.json) writeFileSync(o.json, JSON.stringify({ schema: o.schema, time: rows }, null, 1));
      return;
    }
    const bases = new Map<string, SimTrade[]>();
    for (const t of pick) bases.set(t.code, await loadTrader(db, o.schema, t.name));
    const tasks: Task[] = [];
    const add = (code: string, kind: RunKind, seed: number, k: number) => {
      const centre = o.centre && kind !== "ASIS" && kind !== "N2";
      tasks.push({
        key: `${code}|${kind}|${seed}|${k}${centre ? "|c" : ""}`, trader: code, kind, seed, k, trades: bases.get(code) as SimTrade[],
        iters: o.iters, perms: o.perms, centre,
      });
    };
    for (const t of pick) {
      if (o.runs.includes("ASIS")) add(t.code, "ASIS", 0, 0);
      for (let s = 1; s <= o.seeds; s++) {
        for (const kind of o.runs) {
          if (kind === "N1" || kind === "N2") add(t.code, kind, s, 0);
          else if (kind === "E6") add(t.code, kind, s, 15);
          else if (EFFECTS.includes(kind)) for (const k of o.strengths) add(t.code, kind, s, k);
        }
      }
    }
    // Longest first: the big traders' runs do not end up alone at the tail.
    tasks.sort((a, b) => b.trades.length - a.trades.length || a.key.localeCompare(b.key));
    console.info(`${tasks.length} runs (seed hash ${hashSeed(tasks.map((t) => t.key).join())})`);
    const runs = await runPool(tasks, o.workers);
    const check = selfCheck(runs);
    console.info(`self-check (offline re-decision = engine status at the default profile): ${check.mismatches.length} mismatches over ${check.verdicts} verdicts`);
    for (const m of check.mismatches.slice(0, 10)) console.info(`  ${m}`);
    if (o.mde) runs.push(...(await runPool(mdeTasks(runs, bases, o), o.workers)));
    const losing = new Set(pick.filter((t) => t.net < 0).map((t) => t.code));
    const sums = printSummary(runs, losing, PROFILES);
    printMde(runs);
    printFirstStep(runs);
    printAsisDetail(runs);
    timingTable(runs);
    if (o.json) {
      const traders = pick.map((t) => ({ code: t.code, trades: t.n, losing: t.net < 0 }));
      writeFileSync(o.json, JSON.stringify({ schema: o.schema, iters: o.iters, perms: o.perms, traders, losing: [...losing], runs, summaries: sums }));
      console.info(`\nsaved ${o.json}`);
    }
  } finally {
    await db.end();
  }
}

// The same bundle is the worker: a worker computes the runs it is sent, the main thread does everything else.
if (!isMainThread) {
  parentPort?.on("message", (task: Task) => {
    try {
      parentPort?.postMessage({ ok: true, r: computeRun(task) });
    } catch (e) {
      parentPort?.postMessage({ ok: false, key: task.key, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  });
} else {
  await main();
}
