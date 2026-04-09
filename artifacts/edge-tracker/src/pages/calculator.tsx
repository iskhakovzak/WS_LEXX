import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, TrendingUp, TrendingDown, Target, DollarSign, Hash } from "lucide-react";

function row(label: string, value: string, color?: string) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
      <span className="text-xs font-mono text-muted-foreground uppercase">{label}</span>
      <span className={`text-sm font-bold font-mono ${color ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

export default function PositionCalculator() {
  const [account, setAccount] = useState("50000");
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [exit, setExit] = useState("");
  const [shares, setShares] = useState("");

  const calc = useMemo(() => {
    const A = parseFloat(account) || 0;
    const R = parseFloat(riskPct) || 1;
    const E = parseFloat(entry) || 0;
    const S = parseFloat(stop) || 0;
    const X = parseFloat(exit) || 0;
    const SH = parseFloat(shares) || 0;

    const maxRiskDollars = A * (R / 100);
    const riskPerShare = Math.abs(E - S);
    const positionShares = riskPerShare > 0 ? Math.floor(maxRiskDollars / riskPerShare) : 0;
    const positionSize = positionShares * E;
    const maxLoss = positionShares * riskPerShare;
    const target1R = E + riskPerShare * (E > S ? 1 : -1);
    const target2R = E + riskPerShare * 2 * (E > S ? 1 : -1);
    const target3R = E + riskPerShare * 3 * (E > S ? 1 : -1);

    const pnlManual = SH > 0 && X > 0 && E > 0 ? (X - E) * SH : null;
    const rMultiple = riskPerShare > 0 && X > 0 ? (X - E) / riskPerShare : null;

    return { maxRiskDollars, riskPerShare, positionShares, positionSize, maxLoss, target1R, target2R, target3R, pnlManual, rMultiple, isLong: E > S };
  }, [account, riskPct, entry, stop, exit, shares]);

  const hasSizingResult = calc.positionShares > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Calculator className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Калькулятор позиции</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Position Sizing */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
              <Hash className="h-3.5 w-3.5" /> Размер позиции
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Депозит ($)</Label>
                <Input type="number" value={account} onChange={(e) => setAccount(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="50000" />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Риск на сделку (%)</Label>
                <Input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="1" />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Цена входа</Label>
                <Input type="number" step="any" value={entry} onChange={(e) => setEntry(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="145.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Стоп-лосс</Label>
                <Input type="number" step="any" value={stop} onChange={(e) => setStop(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="140.00" />
              </div>
            </div>

            <div className="mt-4 space-y-0">
              {row("Макс. риск на сделку", `$${calc.maxRiskDollars.toFixed(2)}`, "text-red-400")}
              {row("Риск на акцию", calc.riskPerShare > 0 ? `$${calc.riskPerShare.toFixed(3)}` : "-")}
              {row("Кол-во акций", hasSizingResult ? `${calc.positionShares.toLocaleString()} шт` : "-", "text-primary")}
              {row("Размер позиции", hasSizingResult ? `$${calc.positionSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "-")}
              {row("Макс. убыток", hasSizingResult ? `-$${calc.maxLoss.toFixed(2)}` : "-", "text-red-400")}
            </div>

            {hasSizingResult && (
              <div className="mt-4 space-y-0">
                <div className="text-[10px] font-mono uppercase text-muted-foreground mb-2 flex items-center gap-1"><Target className="h-3 w-3" /> R-цели ({calc.isLong ? "Long" : "Short"})</div>
                {row("1R цель", `$${calc.target1R.toFixed(3)}`, "text-emerald-400")}
                {row("2R цель", `$${calc.target2R.toFixed(3)}`, "text-emerald-400")}
                {row("3R цель", `$${calc.target3R.toFixed(3)}`, "text-emerald-400")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* P&L Calculator */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5" /> P&L / R-Кратное
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Цена входа</Label>
                <Input type="number" step="any" value={entry} onChange={(e) => setEntry(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="145.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Цена выхода</Label>
                <Input type="number" step="any" value={exit} onChange={(e) => setExit(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="152.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Стоп (для R)</Label>
                <Input type="number" step="any" value={stop} onChange={(e) => setStop(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="140.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs font-mono">Кол-во акций</Label>
                <Input type="number" step="1" value={shares} onChange={(e) => setShares(e.target.value)} className="font-mono bg-background h-8 text-xs" placeholder="100" />
              </div>
            </div>

            <div className="mt-4 space-y-0">
              {calc.pnlManual !== null && (
                <>
                  {row("P&L", `${calc.pnlManual >= 0 ? "+" : ""}$${calc.pnlManual.toFixed(2)}`, calc.pnlManual >= 0 ? "text-emerald-400" : "text-red-400")}
                  {row("P&L %", `${(((parseFloat(exit) - parseFloat(entry)) / parseFloat(entry)) * 100).toFixed(2)}%`, (parseFloat(exit) >= parseFloat(entry)) ? "text-emerald-400" : "text-red-400")}
                </>
              )}
              {calc.rMultiple !== null && row("R-кратное", `${calc.rMultiple.toFixed(2)}R`, calc.rMultiple >= 0 ? "text-emerald-400" : "text-red-400")}
            </div>

            {/* Quick reference */}
            <div className="mt-4 p-3 bg-muted/30 border border-border">
              <div className="text-[10px] font-mono uppercase text-muted-foreground mb-2">Справочник</div>
              <div className="space-y-1 text-xs font-mono text-muted-foreground">
                <div>• 1% риск от $50k = $500 макс. убыток</div>
                <div>• 2:1 — минимум для положит. ожидания</div>
                <div>• Win rate 40% при avg 2R — прибыльно</div>
                <div>• Win rate 50% при avg 1.5R — прибыльно</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* R/W table */}
      <Card className="bg-card border-border rounded-none shadow-none">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Таблица безубыточности</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono text-center">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Win Rate</th>
                  {[0.5, 1, 1.5, 2, 2.5, 3].map((r) => <th key={r} className="px-3 py-2">Avg {r}R</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[30, 40, 50, 60, 70].map((wr) => (
                  <tr key={wr} className="hover:bg-muted/40">
                    <td className="px-3 py-2 text-left font-bold">{wr}%</td>
                    {[0.5, 1, 1.5, 2, 2.5, 3].map((r) => {
                      const ev = (wr / 100) * r - (1 - wr / 100);
                      return (
                        <td key={r} className={`px-3 py-2 ${ev > 0 ? "text-emerald-400" : ev < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                          {ev > 0 ? "+" : ""}{ev.toFixed(2)}R
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
