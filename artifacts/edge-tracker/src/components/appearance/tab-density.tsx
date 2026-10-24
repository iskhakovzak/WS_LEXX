/** «Вид» → Плотность: compact (the desk default) or spacious rows for every table and the trades / review lists. */
import { useAppearance } from "@/contexts/appearance-context";
import { DENSITIES, type Density } from "@/lib/appearance/model";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { OptionCard, Section } from "./bits";

const ROWS = [
  { t: "NVDA", v: "+$420" },
  { t: "TSLA", v: "−$180" },
  { t: "AMD", v: "+$96" },
] as const;

/** Rows drawn at the paddings the global rule uses (index.css: --cell-py 8px / 13px). */
function SampleRows({ density }: { density: Density }) {
  const py = density === "compact" ? "py-1" : "py-2";
  return (
    <span aria-hidden="true" className="block overflow-hidden rounded-xl border border-[var(--glass-border)] bg-card">
      {ROWS.map((r) => (
        <span key={r.t} className={`flex items-center justify-between border-b border-border/50 px-3 text-xs last:border-b-0 ${py}`}>
          <span className="font-semibold text-foreground">{r.t}</span>
          <span className={r.v.startsWith("+") ? "font-medium tabular-nums text-up" : "font-medium tabular-nums text-down"}>{r.v}</span>
        </span>
      ))}
    </span>
  );
}

export function DensityTab() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t("density.title")} hint={t("density.hint")}>
      <div role="radiogroup" aria-label={t("density.title")} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DENSITIES.map((d) => (
          <OptionCard key={d} selected={appearance.density === d} onSelect={() => update((a) => ({ ...a, density: d }))} label={`${t(`density.${d}`)}. ${t(`density.${d}Hint`)}`} className="p-3">
            <SampleRows density={d} />
            <span className="block px-1">
              <span className="block text-sm font-semibold text-foreground">{t(`density.${d}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`density.${d}Hint`)}</span>
            </span>
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}
