/**
 * /calculator — options only: chain + advisor, single-option Black-Scholes, multi-leg strategy builder with payoff.
 * (Position sizer and FX converter were removed from the page by the owner's decision — the files stay in
 * components/calculator/ but are not rendered.) Sections live in src/components/calculator/*.
 * ?ticker=XYZ prefills the ticker in every options view.
 */
import { BarChart3 } from "lucide-react";
import { Page, PageHeader } from "@/components/ds";
import OptionsSection from "@/components/calculator/OptionsSection";

function tickerParam(): string | undefined {
  try {
    const t = new URLSearchParams(window.location.search).get("ticker")?.trim().toUpperCase();
    return t && /^[A-Z.\-]{1,10}$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

export default function CalculatorPage() {
  return (
    <Page>
      <PageHeader
        title="Опционный калькулятор"
        icon={BarChart3}
        description="Цепочка и советник по стратегиям, цена и греки по Black-Scholes, конструктор многоногих стратегий с диаграммой выплат"
      />
      <OptionsSection initialTicker={tickerParam()} />
    </Page>
  );
}
