/**
 * The sections of «Отчёт за сезон» (pages/season-report.tsx) — the shape of the weekly review one level up: the totals,
 * setup × timing, best / worst trades, where the money was (families + «лёгкие деньги» of the season), re-entries and
 * give-back, idea tiers, then the trader's own conclusions (the only input; saved into the Playbook). Every number is
 * the api's; nothing is computed here except which row is shown grey (the api's `judged`).
 */
import * as React from "react";
import { Link } from "wouter";
import { BookOpen, Coins, Layers, NotebookPen, Repeat, Trophy } from "lucide-react";
import { Panel, Pill, StatCard, StatGrid, TableScroll, toneText, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { fmtDate, fmtRate, fmtUsd } from "@/lib/format";
import { timingLabel } from "@/components/shared/session-flow/timing";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import { familyLabel } from "./api";
import { moveText, setupText } from "./easy-api";
import { useSaveConclusions, type ReportPeriod, type SeasonReport, type TradeLine } from "./report-api";

const tone = (v: number | null | undefined): Tone => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");
const usd = (v: number | null | undefined) => fmtUsd(v, { signed: true, decimals: 0 });

export function Totals({ r }: { r: SeasonReport }) {
  const { t } = deskPulseI18n.useT();
  const s = r.totals;
  return (
    <StatGrid>
      <StatCard label={t("report.totals.trades")} value={s.n} />
      <StatCard label={t("report.totals.days")} value={s.days} />
      <StatCard label={t("report.totals.winRate")} value={fmtRate(s.winrate)} />
      <StatCard label={t("report.totals.net")} value={usd(s.net)} tone={tone(s.net)} />
      <StatCard label={t("report.totals.exTop3")} value={usd(s.netExTop3)} tone={tone(s.netExTop3)} hint={s.outliers ? t("report.outliers") : undefined} />
      <StatCard label={t("report.totals.pf")} value={s.profitFactor == null ? "—" : s.profitFactor.toFixed(2)} />
    </StatGrid>
  );
}

function StatsCells({ x }: { x: { n: number; winrate: number | null; net: number | null; netExTop3: number | null; outliers: boolean } }) {
  const { t } = deskPulseI18n.useT();
  return (
    <>
      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{x.n}</td>
      <td className="py-1.5 text-right tabular-nums">{fmtRate(x.winrate)}</td>
      <td className={cn("py-1.5 text-right font-medium tabular-nums", toneText(tone(x.net)))}>{usd(x.net)}</td>
      <td className="py-1.5 text-right tabular-nums">
        <span className="inline-flex items-center justify-end gap-1.5">
          {x.outliers && <Pill tone="warn">{t("report.outliers")}</Pill>}
          <span className={toneText(tone(x.netExTop3))}>{usd(x.netExTop3)}</span>
        </span>
      </td>
    </>
  );
}

function Head({ first, second }: { first: string; second?: string }) {
  const { t } = deskPulseI18n.useT();
  return (
    <thead>
      <tr className="text-xs text-muted-foreground [&_th]:py-1 [&_th]:font-medium">
        <th className="text-left">{first}</th>
        {second && <th className="text-left">{second}</th>}
        <th className="text-right">{t("report.rows.trades")}</th>
        <th className="text-right">{t("report.rows.winRate")}</th>
        <th className="text-right">{t("report.rows.net")}</th>
        <th className="text-right">{t("report.rows.exTop3")}</th>
      </tr>
    </thead>
  );
}

export function SetupTiming({ r }: { r: SeasonReport }) {
  const { t } = deskPulseI18n.useT();
  return (
    <Panel title={t("report.rows.title")} icon={Layers} description={t("report.rows.hint", { min: r.minTrades })}>
      <div className="flex flex-col gap-4">
        <TableScroll>
          <table className="w-full text-sm">
            <Head first={t("report.rows.setup")} second={t("report.rows.timing")} />
            <tbody>
              {r.rows.map((x) => (
                <tr key={`${x.setupId}|${x.timing}`} className={cn("border-t border-border/40", !x.judged && "opacity-50")}>
                  <td className="py-1.5 font-medium">
                    {x.setupId != null ? <Link href={`/playbook?id=${x.setupId}`} className="hover:underline">{x.setup}</Link> : t("report.rows.noSetup")}
                  </td>
                  <td className="py-1.5 text-muted-foreground">{x.timing ? timingLabel(x.timing) : timingLabel("none")}</td>
                  <StatsCells x={x} />
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <TableScroll>
          <table className="w-full text-sm">
            <Head first={t("report.rows.byTiming")} />
            <tbody>
              {r.timings.map((x) => (
                <tr key={x.timing ?? "none"} className={cn("border-t border-border/40", !x.judged && "opacity-50")}>
                  <td className="py-1.5 font-medium">{timingLabel(x.timing ?? "none")}</td>
                  <StatsCells x={x} />
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </Panel>
  );
}

function TradeList({ title, list }: { title: string; list: TradeLine[] }) {
  const { t } = deskPulseI18n.useT();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {list.length ? (
        <ul className="flex flex-col gap-1">
          {list.map((x) => (
            <li key={x.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <Link href={links.trade(x.id)} className="font-semibold hover:underline">{x.ticker}</Link>
              <span className={cn("tabular-nums font-medium", toneText(tone(x.net)))}>{usd(x.net)}</span>
              <span className="text-xs text-muted-foreground">{fmtDate(x.day, "dayMonth")} · {x.setup ?? t("report.rows.noSetup")} · {timingLabel(x.timing ?? "none")}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{t("report.trades.none")}</p>}
    </div>
  );
}

export function BestWorst({ r }: { r: SeasonReport }) {
  const { t } = deskPulseI18n.useT();
  return (
    <Panel title={t("report.trades.title")} icon={Trophy}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TradeList title={t("report.trades.best")} list={r.best} />
        <TradeList title={t("report.trades.worst")} list={r.worst} />
      </div>
    </Panel>
  );
}

export function WhereMoney({ r }: { r: SeasonReport }) {
  const { t } = deskPulseI18n.useT();
  const e = r.easy;
  return (
    <Panel title={t("report.money.title")} icon={Coins} description={t("report.money.hint")}>
      <div className="flex flex-col gap-4">
        {r.families.length > 0 && (
          <TableScroll>
            <table className="w-full text-sm">
              <Head first={t("report.money.families")} />
              <tbody>
                {r.families.map((x) => (
                  <tr key={x.family} className={cn("border-t border-border/40", !x.judged && "opacity-50")}>
                    <td className="py-1.5 font-medium">{familyLabel(x.family)}</td>
                    <StatsCells x={x} />
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        {!e || !e.moves ? (
          <p className="text-sm text-muted-foreground">{t("report.money.none")}</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-foreground">
              {t("report.money.easy", { moves: e.moves, days: e.days })}
              {e.capped && <span className="text-xs text-muted-foreground"> · {t("report.money.easyCapped", { days: e.days })}</span>}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              <li className={toneText(tone(e.took.net))}>{t("report.money.took", { n: e.took.n, net: usd(e.took.net) })}</li>
              {e.against.n > 0 && <li className={toneText(tone(e.against.net))}>{t("report.money.against", { n: e.against.n, net: usd(e.against.net) })}</li>}
              <li className="text-muted-foreground">{t("report.money.skipped", { n: e.skipped })}</li>
              <li className="text-muted-foreground">{t("report.money.missed", { n: e.missed })}</li>
            </ul>
            {e.top.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">{t("report.money.top")}</p>
                <ul className="flex flex-col gap-0.5">
                  {e.top.map((m) => (
                    <li key={`${m.day}|${m.ticker}`} className="flex flex-wrap items-baseline gap-2">
                      <span>{m.days > 1 ? t("report.money.topLineDays", { days: m.days, ticker: m.ticker, move: moveText(m), setup: setupText(m) }) : t("report.money.topLine", { day: fmtDate(m.day, "dayMonth"), ticker: m.ticker, move: moveText(m), setup: setupText(m) })}</span>
                      {m.status === "skipped" && <Pill tone="warn">{t("report.money.skippedTag")}</Pill>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function FlowAndTiers({ r }: { r: SeasonReport }) {
  const { t } = deskPulseI18n.useT();
  const re = r.flow.reentry;
  return (
    <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-2">
      <Panel title={t("report.flow.title")} icon={Repeat}>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li className={re.n ? toneText(tone(re.net)) : "text-muted-foreground"}>
            {re.n ? t("report.flow.reentry", { n: re.n, net: usd(re.net), wr: fmtRate(re.winrate) }) : t("report.flow.noReentry")}
          </li>
          <li className={r.flow.giveback.days ? "text-foreground" : "text-muted-foreground"}>
            {r.flow.giveback.days ? t("report.flow.giveback", { days: r.flow.giveback.days, total: fmtUsd(r.flow.giveback.total, { decimals: 0 }) }) : t("report.flow.noGiveback")}
          </li>
          <li className="text-muted-foreground">{t("report.flow.g2r", { days: r.flow.greenToRedDays })}</li>
        </ul>
      </Panel>
      <Panel title={t("report.tiers.title")} icon={BookOpen} description={t("report.tiers.hint", { marked: r.tiers.marked })}>
        {!r.tiers.marked ? (
          <p className="text-sm text-muted-foreground">{t("report.tiers.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {r.tiers.tiers.map((x) => (
              <li key={x.tier} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-20 font-medium">{t(`report.tiers.tier.${x.tier}`)}</span>
                <span className="text-muted-foreground tabular-nums">{x.n} · {fmtRate(x.winrate)}</span>
                <span className={cn("tabular-nums", toneText(tone(x.net)))}>{usd(x.net)}</span>
              </li>
            ))}
            {r.tiers.authored.n > 0 && <li className="text-muted-foreground">{t("report.tiers.authored", { n: r.tiers.authored.n, net: usd(r.tiers.authored.net) })}</li>}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** A prefilled draft (law of prefill): the best and the worst judged setup × timing rows, then the rule to write. */
function draftOf(r: SeasonReport): string {
  const t = deskPulseI18n.t;
  const judged = r.rows.filter((x) => x.judged && x.netExTop3 != null);
  const name = (x: (typeof judged)[number]) => `${x.setup ?? t("report.rows.noSetup")} · ${timingLabel(x.timing ?? "none")}`;
  const works = judged.filter((x) => (x.netExTop3 ?? 0) > 0).sort((a, b) => (b.netExTop3 ?? 0) - (a.netExTop3 ?? 0))[0];
  const fails = judged.filter((x) => (x.net ?? 0) < 0).sort((a, b) => (a.net ?? 0) - (b.net ?? 0))[0];
  return t("report.conclusions.draft", { works: works ? name(works) : t("report.conclusions.draftNone"), fails: fails ? name(fails) : t("report.conclusions.draftNone") });
}

export function Conclusions({ r, own, period }: { r: SeasonReport; own: boolean; period: ReportPeriod }) {
  const { t } = deskPulseI18n.useT();
  const save = useSaveConclusions(own ? null : r.trader, period);
  const saved = r.conclusions?.text ?? "";
  const [text, setText] = React.useState(() => saved || (own ? draftOf(r) : ""));
  React.useEffect(() => { if (saved) setText(saved); }, [saved]);
  const label = r.season ? t("report.seasonKey", { key: r.season.key }) : t("report.periodLine", { from: fmtDate(r.from, "short"), to: fmtDate(r.to, "short") });
  return (
    <Panel title={t("report.conclusions.title")} icon={NotebookPen} description={own ? t("report.conclusions.hint") : t("report.conclusions.readOnly")} className="ring-1 ring-primary/25">
      {own ? (
        <div className="flex flex-col gap-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={5000} aria-label={t("report.conclusions.title")} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!text.trim() || text.trim() === saved.trim() || save.isPending}
              onClick={() => save.mutate({ from: r.from, to: r.to, title: t("report.conclusions.entryTitle", { period: label }), folder: t("report.conclusions.folder"), text: text.trim() })}
            >
              {t("report.conclusions.save")}
            </Button>
            {r.conclusions && (
              <>
                <span className="text-xs text-muted-foreground" role="status">{t("report.conclusions.saved")}</span>
                <Link href={`/playbook?id=${r.conclusions.playbookId}`} className="text-xs text-primary hover:underline">{t("report.conclusions.open")}</Link>
              </>
            )}
          </div>
        </div>
      ) : saved ? (
        <p className="whitespace-pre-wrap text-sm text-foreground">{saved}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("report.conclusions.none")}</p>
      )}
    </Panel>
  );
}
