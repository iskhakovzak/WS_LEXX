/** «Вид» → Чипы: colours of the journal chips (strategies, tag kinds, trade type), each group on / off + reset. */
import { RotateCcw } from "lucide-react";
import { useAppearance } from "@/contexts/appearance-context";
import { TradeChip } from "@/components/ds/trade-chip";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CHIP_GROUPS, CHIP_GROUP_IDS, chipToken, type Appearance, type ChipGroup } from "@/lib/appearance/model";
import { cn } from "@/lib/utils";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { CustomSwatch, GuardNote, Section, Swatch, SwatchGroup } from "./bits";

const PRESETS = ["#3b82f6", "#14b8a6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"] as const;
type ChipKeyLabel = "setup" | "mistake" | "emotion" | "other" | "intraday" | "overnight" | "swing";

function ChipRow({ group, k }: { group: ChipGroup; k: string }) {
  const { t } = appearanceI18n.useT();
  const { appearance, update, computed } = useAppearance();
  const g = appearance.chips[group];
  const value = g.colors[k] ?? null;
  const label = group === "strategy" ? k : t(`chips.keys.${k as ChipKeyLabel}`);
  const set = (hex: string | null) => update((a) => {
    const colors = { ...a.chips[group].colors };
    if (hex) colors[k] = hex; else delete colors[k];
    return { ...a, chips: { ...a.chips, [group]: { ...a.chips[group], colors } } } as Appearance;
  });
  const custom = value && !PRESETS.includes(value as (typeof PRESETS)[number]) ? value : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-28 shrink-0">
          <TradeChip group={group} value={k}>{label}</TradeChip>
        </span>
        <SwatchGroup label={label} className={cn(!g.on && "pointer-events-none opacity-40")}>
          <Swatch color={`hsl(var(${chipToken(group, k)}))`} label={t("money.byDefault")} selected={value == null} onSelect={() => set(null)}>
            {value != null && <RotateCcw className="h-3.5 w-3.5 text-background mix-blend-difference" aria-hidden="true" />}
          </Swatch>
          {PRESETS.map((hex) => <Swatch key={hex} color={hex} label={hex} selected={value === hex} onSelect={() => set(hex)} />)}
          <CustomSwatch value={custom} selected={!!custom} label={t("colors.customAria", { name: label })} onPick={set} />
        </SwatchGroup>
      </div>
      <GuardNote result={computed.report.chips?.[chipToken(group, k)]} />
    </div>
  );
}

function ChipGroupSection({ group }: { group: ChipGroup }) {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const g = appearance.chips[group];
  const name = t(`chips.groups.${group}`);
  const patch = (next: Partial<Appearance["chips"][ChipGroup]>) =>
    update((a) => ({ ...a, chips: { ...a.chips, [group]: { ...a.chips[group], ...next } } }) as Appearance);
  return (
    <Section
      title={name}
      aside={
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={g.on} onCheckedChange={(on) => patch({ on })} aria-label={t("chips.colorizeAria", { group: name })} />
            {t("chips.colorize")}
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={g.on && Object.keys(g.colors).length === 0}
            onClick={() => patch({ on: true, colors: {} })}
            aria-label={t("chips.resetAria", { group: name })}
          >
            <RotateCcw aria-hidden="true" />
            {t("chips.reset")}
          </Button>
        </span>
      }
    >
      {!g.on && <p className="text-xs text-muted-foreground">{t("chips.offNote")}</p>}
      <div className="flex flex-col gap-2">
        {CHIP_GROUPS[group].map((k) => <ChipRow key={k} group={group} k={k} />)}
      </div>
    </Section>
  );
}

export function ChipsTab() {
  const { t } = appearanceI18n.useT();
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-xs text-muted-foreground"><span className="font-semibold text-foreground">{t("chips.title")}.</span> {t("chips.hint")}</p>
      {CHIP_GROUP_IDS.map((g) => <ChipGroupSection key={g} group={g} />)}
    </div>
  );
}
