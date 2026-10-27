# One truth — inventory of the core numbers

Five numbers drive what a trader does next: **net P&L**, **win rate**, **drawdown**, **trading days**, and **breakeven win rate / edge / average trade**. The owner walked the live dashboard and found that the same names showed different values. The worst case was the AI mentor: it advised trading to a trader whom the risk desk had stopped.

This file lists where each number is computed, what it means, and why two places disagreed. It also gives the rule that keeps them consistent:

* **Server.** Every formula lives in `artifacts/api-server/src/lib/coreMetrics/`. The pure primitives are in `kpi.ts`, `breakeven.ts`, `lib/tradeMath.ts` and `lib/riskMetrics.ts`. `risk.ts` is the risk desk's loader.
* **Web.** The mirror is `artifacts/edge-tracker/src/lib/trade-math.ts`.
* **Guard.** `scripts/checks/check-core-metrics.mjs` runs as part of `pnpm run checks`. It fails when anyone else writes `wins / (wins + losses)`, `wins / decided`, a breakeven formula, a peak-tracking drawdown loop or `pnl - ABS(fees)` in SQL. A line that honestly computes something else must say so with `// core-metric-ok: <why>`.

## 1. What disagreed and why

| Seen on screen | Where | Formula · window · source | Why it differed | Verdict |
|---|---|---|---|---|
| Hero «Просадка от пика $X / лимит $Y · торговля остановлена» | `today-hero.tsx` ← `GET /risk/me` | Drawdown from the **lifetime equity peak**; a curator review resets the peak; live unrealized is added. Day rows come from `loadDaily`, where broker rows win per day. Limits come from `loadEffectiveLimits`. | — (the reference) | Canonical: `coreMetrics/risk.riskStateOf` |
| Mentor «текущая просадка $0», «дневной лимит $150», rule «стоп после −$150» | `lib/mentor/facts.ts`, `escalation.ts` | Own `currentDrawdown` over **35 days of behaviour rows**, with the peak starting at 0. Used `loadLimits` (base limits, no regime multiplier). Had **no stop state**. | Wrong window and wrong baseline. The stop was invisible to the model. | **Bug, fixed.** Now reads `riskStateOf`, the same loader as the hero. |
| Equity card «Win rate 62% 23W/14L» | `equity-panel.tsx` ← `GET /dashboard/equity` | `wins/(wins+losses)` by stored **result**, BE excluded. Window = card period (week; an empty week widens to 30 days). | — | Kept. Labelled «Винрейт · 30 дн.» |
| «Винрейт 50.2% · безубыточный 50.9%» | `OwnBreakevenLine` in the equity card ← `GET /edge/breakeven` | Win rate by **net sign**. Breakeven = `1/(1+avgWin/abs(avgLoss))`. Window = **last 60 trading days with P&L**. | Second winrate definition (net sign) and a third window inside a 30-day card. Duplicates the «Комиссии» tile. | **Removed from the dashboard.** Replaced by a link to the weekly review, which keeps this line, now labelled «Винрейт нетто … · N торг. дн.». |
| «Ваш edge» → «Винрейт 53%», «На сделку −$14.41», «Ваша средняя сделка −$3.36» | `tile-leaks.tsx` ← client `clientEdgeMap` over `/api/trades`, 90 days | Win rate and $ per trade of the **leak slice**, by net sign. «Ваша средняя сделка» = all trades in the 90-day window. | A slice's numbers shown under the book's labels. A 90-day average next to a 30-day curve with no window shown. | Honestly different. Renamed «Винрейт нетто», «На сделку в срезе», «Ваша средняя сделка · 90 дн.». |
| «Комиссии … безубыточный 58%, ваш 55%» | `tiles-money.tsx` ← `feesInsight`, 90 days, client | The same breakeven formula as the server, but over 90 calendar days and ≥ 15 trades. | The same metric as the equity-card line with another window. | Kept as **the** dashboard breakeven: «… ваш нетто — 55% · 90 дн.». Formula = shared `breakevenWinRate`. |
| «Кривая капитала +$383.97» vs «−$3.36 на сделку» | equity card (30 d) vs leaks tile (90 d) | Σ net over 30 days vs the average net over 90 days | Different windows, no label | Labels: «30 дн. · N сделок · N торговых дней» and «… · 90 дн.» |
| Trading days 35 / 67 / 10 | Equity card (window days), breakeven tooltip (≤ 60), mentor (last 10 traded days / 35 calendar days), TodayEdgeLine (regime days over 365 days) | Distinct close days, each in its own window | Counts without windows | Each count now names its window («… · 30 дн.», «N торг. дн.»). The mentor gets `tradedDaysLast35` / `last10TradedDays`. |

## 2. Inventory by metric

The status codes used in the tables:

* **dup→shared:** a true duplicate. It now calls the shared function.
* **honest:** a different definition or window. It is named apart in the UI.
* **ok-marked:** the same shape for another purpose, marked `core-metric-ok`.

### Net P&L

| Place | Definition | Status |
|---|---|---|
| `tradeMath.netPnlSql / netPnl / closeDateSql` (web `trade-math.netPnl`) | `pnl − abs(fees)`, booked on the close date | canonical |
| `riskData.loadDaily` → hero, risk desk, mentor, escalations, scaling drawdown basis | Per trader-day, broker rows win over journal rows | canonical for the stop |
| `routes/dashboard.ts` (today / week / equity), `stats/aggregate`, `benchmark`, `myEdge`, `leaderboard`, `officeStats`, `tradesPageQuery`, `weekly-review` | `netPnlSql`; journal and broker rows summed | shared formula; see open issue O1 |
| `curatorPriority.ts`, `plateauStore.ts` | wrote `pnl - ABS(COALESCE(fees,0))` inline | dup→shared (`netPnlSql`, `closeDateSql`) |
| `weeklyPsychologyReport.ts` | Summed **gross** `t.pnl`; win rate = wins/**all** trades | **fixed:** net P&L and canonical win rate |
| `scalingEngine` / `promotionEngine` / `capital/load` | Broker rows for the whole window when the trader has any | honest but different source rule (O1) |

### Win rate

| Place | Definition | Status |
|---|---|---|
| `winRateOf(wins, losses)` (server `tradeMath` → `coreMetrics/kpi`, web `trade-math`) | `wins/(wins+losses)`, BE and open excluded | canonical |
| About 45 inline copies: dashboard, dashboardModel, benchmark, officeStats, scaling, leaderboard, trades, weekly-review, myReview, events, research, ratings, tradeideas, setups-auto, playbook(Edge/Today), profile, dayReport, myEdge, feedStream, dailyfeed, big7, analyst-actions, emotionalstate, academyCohorts, offeringReaction, propreports parser; web stats, analytics, analytics-pro, equity-chart, equity-candles, insight tiles, journal, ratings, team, watchlist, events, offerings, playbook, trades | the same formula written inline | dup→shared |
| Insight tiles (`model.ts resultKeyOf`), `edgeMargin`, `myEdge` | win / loss by the **sign of net** (after fees) | honest; labelled «Винрейт нетто» |
| `routes/dashboard.ts` top setup (SQL `ORDER BY`) | ranking only, value not shown | ok-marked |

### Drawdown

| Place | Definition | Status |
|---|---|---|
| `coreMetrics/risk.riskStateOf` / `riskSummary.drawdownFromPeakUsd` / `drawdownsFromPeak` | **Now** below the lifetime peak; curator review resets it; live P&L included | canonical for stops (hero, mentor, escalation, scaling basis) |
| `maxDrawdownOfSeries` / `drawdownOf` / `maxDrawdownByDay` (web `maxDrawdown`) | **Max** fall of the end-of-day curve inside a window, peak starts at 0 | canonical for window stats |
| `dashboard.ts` equity loop, `scalingEngine.maxDrawdownAbs`, `whatIf.maxDrawdownOf`, `leaderboard.maxDrawdown`, `profile/analytics`, `profile/attributes.maxDrawdownOf`, `playbookEdge`; web `edge-stats.maxDrawdownOf`, `what-if/month-view`, `analytics-pro` | inline loops | dup→shared |
| `scalingRiskBasis.ts` | Own lifetime equity loop (no broker rule, no review reset) that claimed to match the risk desk | **fixed:** `drawdownsFromPeak` |
| `mentor/escalation.currentDrawdown` | 35-day window, peak from 0 | **removed**; uses the risk desk's number |
| Underwater chart series (`stats/aggregate`, `stats/metrics`, `analytics-page/metrics`, `equity-candles`, `office-stats/time-risk`), Monte-Carlo path, intraday timeline (`behaviorEngine`), session high (`profile/attributes`) | point-by-point series, not the metric | ok-marked |
| Daily loss vs `dailyLossLimit` (`riskMetrics.computeStop`) | **Not a drawdown.** It is today's loss against the daily limit. | canonical. Named «Дневной лимит», never «просадка» |

### Breakeven win rate / edge / average trade

| Place | Definition | Status |
|---|---|---|
| `coreMetrics/breakeven` (`breakevenWinRate`, `edgeMargin`, `edgeMarginOf`); web `trade-math.breakevenWinRate / breakevenOfPayoff` | `1/(1+avgWin/abs(avgLoss))` on net, ≥ 5 wins and 5 losses (server) | canonical |
| web `insight-tiles/insights.breakEvenRate` (`-L/(W-L)`), `stats/insights.tsx` (`1/(1+payoff)`) | the same formula, written again | dup→shared |
| `$ per trade`: dashboard `avgPnl`, benchmark, profile, leaderboard, web metrics / analytics-pro | net ÷ trades with $ | shared definition (`perTrade` available) |
| «Ваша средняя сделка» (leaks tile baseline) | total net ÷ closed rows in the window | honest; labelled with its window |
| `leaderboard.profitFactorUsd` | With no loss it returns the **count of winning trades** (ranking choice, documented) | honest (ranking only); see O3 |

### Trading days

Each count is a distinct-close-day count in its own window. They are honestly different, so each label now carries its window. Two counts are suspect (O2): `tradesPageQuery` counts **entry** dates, and `ratings` also counts days that only have open trades.

## 3. Open issues (not changed in this pass)

* **O1 · Which rows count (broker vs journal).** There are three rules today:
  * The risk desk: per trader-day, broker rows win.
  * Scaling, promotion and capital: broker-only for the whole window if the trader has any broker row.
  * Everything else (dashboard, stats, leaderboard): both sources summed.

  With today's flow (trades come from PropReports; manual entry lives only in playbook and plans), all three give the same totals. On old mixed days they can differ. Unifying means one SQL row filter, `coreMetrics.bookRowSql`, in every aggregate, and it should be measured on the live DB first.
* **O2 · Day keys.** `tradesPageQuery` counts `COUNT(DISTINCT date)` on the entry date. `ratings` counts days with open trades. The dashboard groups by the close date without `LEFT(…,10)`. These should all use `LEFT(closeDateSql, 10)`.
* **O3 · Leaderboard profit factor.** It counts the wins when there are no losses. That is deliberate for ranking. If PF is ever shown as a number, use `profitFactorOf` (null without a loss).
* **O4 · The «closed» set.** `closedSql` (result win/loss/be), `loadDaily` (pnl and result ≠ open, including an empty result) and the web `isClosed` disagree on rows with an empty result. These rows are rare after the PropReports import.
