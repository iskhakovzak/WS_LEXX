/**
 * AI advisor: the trader describes an idea, POST /api/options/ai-analyze picks one structure on the loaded chain
 * (ATM ±15 strikes are sent — the prompt uses ATM ±10, with IV and Δ when the chain has them).
 */
import { useCallback, useState } from "react";
import { AlertTriangle, Layers, RefreshCw, Send, Sparkles } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { http } from "@/lib/api/http";
import { fmtUsd } from "@/lib/format";
import { calculatorI18n } from "@/i18n/ns/calculator";
import { usePersistedState } from "./lib";
import { MetricTile } from "./fields";
import { compactForAi } from "./chainApi";
import type { ChainData } from "./strategies";
import type { OpenInBuilderParams } from "./handoff";

interface AiAnalysisResult {
  strategy: string;
  reasoning: string;
  legs: Array<{ action: "buy" | "sell"; type: "call" | "put"; strike: number; premium: number; contracts: number }>;
  maxRisk: number | null;
  maxProfit: number | null;
  breakevens: number[];
  whyBest: string;
  keyRisk: string;
  altStrategies?: string[];
}

export default function AiAdvisor({ chain, atmIv, onOpenInBuilder }: {
  chain: ChainData | null;
  atmIv: number | null;
  onOpenInBuilder: (p: OpenInBuilderParams) => void;
}) {
  const { t } = calculatorI18n.useT();
  const [aiPrompt, setAiPrompt] = usePersistedState<string>("advisor_ai_prompt", "");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const analyzeWithAI = useCallback(async () => {
    if (!chain || !aiPrompt.trim()) return;
    setAiLoading(true); setAiError(null); setAiResult(null);
    try {
      setAiResult(await http.post<AiAnalysisResult>("/api/options/ai-analyze", {
        symbol: chain.symbol, spot: chain.spot, daysToExpiry: chain.daysToExpiry, ...compactForAi(chain), userPrompt: aiPrompt,
      }));
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : calculatorI18n.t("advisor.aiError"));
    } finally {
      setAiLoading(false);
    }
  }, [chain, aiPrompt]);

  return (
    <Panel title={t("advisor.aiTitle")} icon={Sparkles} description={chain
      ? t("advisor.aiDescription", { symbol: chain.symbol, price: fmtUsd(chain.spot), days: t("shared.days", { count: chain.daysToExpiry }) })
      : t("advisor.aiDescriptionEmpty")}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-prompt" className="text-xs font-normal text-muted-foreground">{t("advisor.aiLabel")}</Label>
          <Textarea
            id="ai-prompt"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void analyzeWithAI(); }}
            placeholder={t("advisor.aiPlaceholder")}
            disabled={!chain || aiLoading}
            rows={3}
            className="resize-none rounded-2xl"
          />
        </div>
        <Button type="button" variant="outline" className="self-end" onClick={() => void analyzeWithAI()} disabled={!chain || !aiPrompt.trim() || aiLoading}>
          {aiLoading ? <RefreshCw className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          {aiLoading ? t("advisor.aiThinking") : t("advisor.aiAsk")}
        </Button>

        {aiError && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-down/15 px-3 py-2 text-sm text-down">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{aiError}
          </p>
        )}

        {aiResult && (
          <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-base font-semibold text-primary">
                <Sparkles className="h-4 w-4" aria-hidden="true" />{aiResult.strategy}
              </span>
              {chain && aiResult.legs.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenInBuilder({
                  symbol: chain.symbol, spot: chain.spot, days: chain.daysToExpiry, iv: atmIv,
                  legs: aiResult.legs.map((l) => ({ side: l.action, kind: l.type, strike: l.strike, premium: l.premium, qty: Math.max(1, l.contracts || 1) })),
                })}>
                  <Layers aria-hidden="true" /> {t("shared.toBuilder")}
                </Button>
              )}
            </div>
            {aiResult.legs.length > 0 && (
              <ul className="flex flex-col gap-1">
                {aiResult.legs.map((leg, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm tabular-nums">
                    <Pill tone={leg.action === "buy" ? "up" : "down"}>{leg.action === "buy" ? "Buy" : "Sell"}</Pill>
                    <Pill tone={leg.type === "call" ? "accent" : "warn"}>{leg.type === "call" ? "Call" : "Put"}</Pill>
                    <span className="font-medium">{fmtUsd(leg.strike)}</span>
                    <span className="text-muted-foreground">×{leg.contracts}</span>
                    <span className="ml-auto text-xs text-muted-foreground">~{t("shared.perShareSuffix", { price: fmtUsd(leg.premium) })}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <MetricTile label={t("shared.maxRisk")} value={aiResult.maxRisk != null ? fmtUsd(aiResult.maxRisk, { decimals: 0 }) : t("advisor.notLimited")} tone="text-down" />
              <MetricTile label={t("shared.maxProfit")} value={aiResult.maxProfit != null ? fmtUsd(aiResult.maxProfit, { decimals: 0 }) : t("shared.unlimited")} tone="text-up" />
              <MetricTile label={t("shared.breakeven")} value={aiResult.breakevens.length ? aiResult.breakevens.map((b) => fmtUsd(b)).join(" / ") : "—"} />
            </div>
            <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">{aiResult.reasoning}</p>
            <p className="text-sm"><span className="text-muted-foreground">{t("advisor.why")} </span>{aiResult.whyBest}</p>
            <p className="flex items-start gap-2 text-sm text-[hsl(var(--chart-3))]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{aiResult.keyRisk}
            </p>
            {aiResult.altStrategies && aiResult.altStrategies.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t("advisor.alternatives")}</span>
                {aiResult.altStrategies.map((alt, i) => <Pill key={i} tone="neutral">{alt}</Pill>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
