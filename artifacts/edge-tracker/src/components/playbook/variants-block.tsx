/**
 * «Варианты входа» on a setup's «Статистика» tab: the setup's trade variants (child setups) side by side — which entry
 * pays and which eats the profit — from the trades already tagged with a variant; the setup's own trades are
 * «вариант не указан». Data: GET /api/playbook/:id/stats → variants (api lib/playbook/variants.ts).
 */
import { Link } from "wouter";
import { GitBranch } from "lucide-react";
import { Pill, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtRate, fmtUsd } from "@/lib/format";
import { strategyI18n } from "@/i18n/ns/strategy";
import { playbookExamplesI18n } from "@/i18n/ns/playbookExamples";
import type { UsdBlock } from "@/components/shared/strategy/model";
import { DocSection } from "./setup-bits";
import { moneyTone, type SetupStats } from "./model";

/** A variant needs this many trades before it is called «pays» / «eats the profit». */
const MIN_VERDICT = 3;

type Row = { key: string; name: string; u: UsdBlock; unspecified?: boolean };

export function VariantsBlock({ v }: { v: NonNullable<SetupStats["variants"]> }) {
  const { t } = strategyI18n.useT();
  const et = playbookExamplesI18n.t;
  const rows: Row[] = [
    ...v.variants.map((x) => ({ key: String(x.id), name: x.name, u: x })),
    ...(v.unspecified.n > 0 ? [{ key: "unspecified", name: t("variants.unspecified"), u: v.unspecified, unspecified: true }] : []),
  ];
  const judged = rows.filter((r) => !r.unspecified && r.u.n >= MIN_VERDICT && r.u.net != null);
  const best = judged.filter((r) => r.u.net! > 0).sort((a, b) => b.u.net! - a.u.net!)[0]?.key;
  const worst = judged.filter((r) => r.u.net! < 0).sort((a, b) => a.u.net! - b.u.net!)[0]?.key;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.u.net ?? 0)));
  const any = rows.some((r) => r.u.n > 0);

  return (
    <DocSection title={t("variants.title")} icon={GitBranch}>
      <p className="mb-3 text-xs text-muted-foreground">{t("variants.hint")}</p>
      {!any ? (
        <p className="text-sm text-muted-foreground">{t("variants.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(64px,120px)_auto] items-center gap-3 rounded-xl px-2 py-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(80px,160px)_64px_72px_88px]">
                <span className="flex min-w-0 items-center gap-2">
                  {!r.unspecified ? (
                    <Link href={`/playbook?id=${r.key}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{r.name}</Link>
                  ) : (
                    <span className={cn("min-w-0 truncate text-sm", r.unspecified ? "text-muted-foreground" : "font-medium text-foreground")}>{r.name}</span>
                  )}
                  {r.key === best && <Pill tone="up">{t("variants.pays")}</Pill>}
                  {r.key === worst && <Pill tone="down">{t("variants.eats")}</Pill>}
                </span>
                <span className="relative h-1.5 overflow-hidden rounded-full bg-[hsl(var(--border))]" aria-hidden="true">
                  <span className={cn("absolute inset-y-0 left-0 rounded-full", (r.u.net ?? 0) >= 0 ? "bg-up" : "bg-down")} style={{ width: `${(Math.abs(r.u.net ?? 0) / maxAbs) * 100}%` }} />
                </span>
                <span className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block" title={et("stats.colTrades")}>{r.u.n} · {fmtRate(r.u.winrate)}</span>
                <span className={cn("hidden text-right text-xs tabular-nums sm:block", toneText(moneyTone(r.u.expectancy)))} title={et("stats.colPerTrade")}>{fmtUsd(r.u.expectancy, { signed: true, decimals: 0 })}</span>
                <span className={cn("text-right text-sm font-semibold tabular-nums", toneText(moneyTone(r.u.net)))}>{fmtUsd(r.u.net, { signed: true, decimals: 0 })}</span>
              </li>
          ))}
        </ul>
      )}
    </DocSection>
  );
}
