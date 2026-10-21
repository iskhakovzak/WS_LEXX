/**
 * Strike ladder: calls left, puts right, centred on the ATM strike (±10, «more» widens), with a strike search.
 * "Pick" on a side of a row hands that contract over in one tap (B-S form + a builder leg — OptionsSection).
 * Phone: one side at a time (Calls / Puts switch); minor columns (Last, OI) appear from `sm`.
 */
import { useEffect, useMemo, useState } from "react";
import { Calculator, Check, ChevronDown, ChevronUp, Layers, Search, Table2 } from "lucide-react";
import { Panel, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtCompact, fmtNum, fmtUsd } from "@/lib/format";
import { calculatorI18n } from "@/i18n/ns/calculator";
import { fmtStrike } from "./lib";
import { LADDER_RADIUS, ladderWindow, nearestIndex, parseStrikeQuery } from "./chainApi";
import type { ChainData, ChainOption } from "./strategies";

export type OptSide = "call" | "put";
export type PickedContract = { type: OptSide; strike: number; premium: number };

type Props = {
  chain: ChainData;
  /** Expiration label + days, for the panel description. */
  expLabel: string;
  picked: PickedContract | null;
  onPick: (type: OptSide, o: ChainOption) => void;
  builderLegCount: number;
  onShowBs: () => void;
  onShowBuilder: () => void;
};

const dash = "—";
const price = (n: number | undefined) => (n != null && n > 0 ? fmtNum(n, 2) : dash);
const delta = (o: ChainOption | undefined) => (o?.greeks ? fmtNum(o.greeks.delta, 2) : dash);
const ivTxt = (o: ChainOption | undefined) => (o?.iv != null ? `${fmtNum(o.iv, 0)}%` : dash);
const oiTxt = (o: ChainOption | undefined) => (o ? fmtCompact(o.openInterest) : dash);

export default function StrikeLadder({ chain, expLabel, picked, onPick, builderLegCount, onShowBs, onShowBuilder }: Props) {
  const { t } = calculatorI18n.useT();
  const [side, setSide] = useState<"calls" | "puts">("calls");
  const [radius, setRadius] = useState(LADDER_RADIUS);
  const [query, setQuery] = useState("");
  // A new chain (ticker / date) starts again around the ATM strike.
  useEffect(() => { setRadius(LADDER_RADIUS); }, [chain.symbol, chain.expirationDate]);

  const target = parseStrikeQuery(query);
  const center = target ?? chain.spot;
  const win = useMemo(() => ladderWindow(chain.strikes, center, radius), [chain.strikes, center, radius]);
  const found = target != null ? chain.strikes[nearestIndex(chain.strikes, target)] : null;
  const callBy = useMemo(() => new Map(chain.calls.map((c) => [c.strike, c])), [chain.calls]);
  const putBy = useMemo(() => new Map(chain.puts.map((p) => [p.strike, p])), [chain.puts]);
  const spotAt = win.rows.findIndex((k) => k >= chain.spot);
  const hidden = win.hiddenBelow + win.hiddenAbove;

  /** Class for a side cell: the inactive side is hidden below `md`; minor columns wait for `sm`. */
  const cell = (s: "calls" | "puts", minor = false) => cn(side !== s ? "hidden md:table-cell" : minor && "hidden sm:table-cell");
  const pickedHere = (type: OptSide, k: number) => picked?.type === type && picked.strike === k;
  const pickBtn = (type: OptSide, o: ChainOption | undefined) => <PickBtn type={type} o={o} on={!!o && pickedHere(type, o.strike)} onPick={onPick} />;

  const th = "px-2 py-2 font-normal";
  return (
    <Panel
      title={t("ladder.title")}
      icon={Table2}
      description={t("ladder.description", { expiration: expLabel })}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} inputMode="decimal" autoComplete="off"
              aria-label={t("ladder.searchAria")} placeholder={t("shared.strike")} className="h-8 w-28 pl-8 text-sm" />
          </div>
          <Segmented<"calls" | "puts"> ariaLabel={t("ladder.sideAria")} size="sm" value={side} onChange={setSide} className="md:hidden"
            options={[{ value: "calls", label: "Calls" }, { value: "puts", label: "Puts" }]} />
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {picked && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm">
            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {t("ladder.pickedLine", { contract: `${picked.type === "call" ? "Call" : "Put"} ${fmtStrike(picked.strike)}`, price: fmtUsd(picked.premium) })}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onShowBs}><Calculator aria-hidden="true" /> {t("ladder.openBs")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={onShowBuilder}><Layers aria-hidden="true" /> {t("modes.builderCount", { count: builderLegCount })}</Button>
          </div>
        )}
        <div className="-mx-1 max-h-[70dvh] overflow-auto px-1">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">{t("ladder.caption", { symbol: chain.symbol })}</caption>
            <thead className="sticky top-0 z-sticky bg-[hsl(var(--popover))] text-muted-foreground">
              <tr className="border-b border-border/60">
                <th scope="col" className={cn(th, "text-left", cell("calls"))}><span className="sr-only">{t("ladder.pick")}</span>Calls</th>
                <th scope="col" className={cn(th, "text-right", cell("calls", true))}>OI</th>
                <th scope="col" className={cn(th, "text-right", cell("calls"))}>IV</th>
                <th scope="col" className={cn(th, "text-right", cell("calls"))}>Δ</th>
                <th scope="col" className={cn(th, "text-right", cell("calls", true))}>Last</th>
                <th scope="col" className={cn(th, "text-right", cell("calls"))}>Bid</th>
                <th scope="col" className={cn(th, "text-right", cell("calls"))}>Ask</th>
                <th scope="col" className="px-2 py-2 text-center font-medium text-foreground">{t("shared.strike")}</th>
                <th scope="col" className={cn(th, "text-left", cell("puts"))}>Bid</th>
                <th scope="col" className={cn(th, "text-left", cell("puts"))}>Ask</th>
                <th scope="col" className={cn(th, "text-left", cell("puts", true))}>Last</th>
                <th scope="col" className={cn(th, "text-left", cell("puts"))}>Δ</th>
                <th scope="col" className={cn(th, "text-left", cell("puts"))}>IV</th>
                <th scope="col" className={cn(th, "text-left", cell("puts", true))}>OI</th>
                <th scope="col" className={cn(th, "text-right", cell("puts"))}>Puts<span className="sr-only"> {t("ladder.pick")}</span></th>
              </tr>
            </thead>
            <tbody>
              {win.rows.map((k, i) => {
                const c = callBy.get(k);
                const p = putBy.get(k);
                const cItm = c?.inTheMoney ?? k < chain.spot;
                const pItm = p?.inTheMoney ?? k > chain.spot;
                const isFound = found === k;
                return [
                  i === spotAt && (
                    <tr key={`spot-${k}`} aria-hidden="true">
                      <td colSpan={15} className="py-0.5">
                        <div className="flex items-center gap-2 text-2xs font-medium text-primary">
                          <span className="h-px flex-1 bg-primary/50" />{t("ladder.spotRow", { symbol: chain.symbol, price: fmtUsd(chain.spot) })}<span className="h-px flex-1 bg-primary/50" />
                        </div>
                      </td>
                    </tr>
                  ),
                  <tr key={k} className={cn("border-b border-border/30", isFound && "outline outline-1 -outline-offset-1 outline-primary")}>
                    <td className={cn("px-1 py-1 text-left", cell("calls"), cItm && "bg-up/5")}>{pickBtn("call", c)}</td>
                    <td className={cn("px-2 py-1 text-right text-muted-foreground", cell("calls", true), cItm && "bg-up/5")}>{oiTxt(c)}</td>
                    <td className={cn("px-2 py-1 text-right text-[hsl(var(--chart-5))]", cell("calls"), cItm && "bg-up/5")}>{ivTxt(c)}</td>
                    <td className={cn("px-2 py-1 text-right", cell("calls"), cItm && "bg-up/5")}>{delta(c)}</td>
                    <td className={cn("px-2 py-1 text-right text-muted-foreground", cell("calls", true), cItm && "bg-up/5")}>{price(c?.last)}</td>
                    <td className={cn("px-2 py-1 text-right", cell("calls"), cItm && "bg-up/5")}>{price(c?.bid)}</td>
                    <td className={cn("px-2 py-1 text-right", cell("calls"), cItm && "bg-up/5")}>{price(c?.ask)}</td>
                    <th scope="row" className={cn("px-2 py-1 text-center font-semibold", isFound ? "text-primary" : "text-foreground")}>{fmtStrike(k)}</th>
                    <td className={cn("px-2 py-1 text-left", cell("puts"), pItm && "bg-down/5")}>{price(p?.bid)}</td>
                    <td className={cn("px-2 py-1 text-left", cell("puts"), pItm && "bg-down/5")}>{price(p?.ask)}</td>
                    <td className={cn("px-2 py-1 text-left text-muted-foreground", cell("puts", true), pItm && "bg-down/5")}>{price(p?.last)}</td>
                    <td className={cn("px-2 py-1 text-left", cell("puts"), pItm && "bg-down/5")}>{delta(p)}</td>
                    <td className={cn("px-2 py-1 text-left text-[hsl(var(--chart-5))]", cell("puts"), pItm && "bg-down/5")}>{ivTxt(p)}</td>
                    <td className={cn("px-2 py-1 text-left text-muted-foreground", cell("puts", true), pItm && "bg-down/5")}>{oiTxt(p)}</td>
                    <td className={cn("px-1 py-1 text-right", cell("puts"), pItm && "bg-down/5")}>{pickBtn("put", p)}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        {(hidden > 0 || radius > LADDER_RADIUS) && (
          <div className="flex flex-wrap gap-2">
            {hidden > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRadius((r) => r + LADDER_RADIUS)}>
                <ChevronDown aria-hidden="true" /> {t("ladder.more", { count: hidden })}
              </Button>
            )}
            {radius > LADDER_RADIUS && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRadius(LADDER_RADIUS)}>
                <ChevronUp aria-hidden="true" /> {t("ladder.less")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function PickBtn({ type, o, on, onPick }: { type: OptSide; o: ChainOption | undefined; on: boolean; onPick: (type: OptSide, o: ChainOption) => void }) {
  const { t } = calculatorI18n.useT();
  if (!o || !(o.mid > 0)) return <span className="px-1.5 text-muted-foreground">{dash}</span>;
  const contract = `${type === "call" ? "Call" : "Put"} ${fmtStrike(o.strike)}`;
  return (
    <button type="button" aria-pressed={on} onClick={() => onPick(type, o)} aria-label={t("ladder.pickAria", { contract })}
      className="chip inline-flex min-h-8 items-center gap-1 px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{on ? t("ladder.picked") : t("ladder.pick")}
    </button>
  );
}
