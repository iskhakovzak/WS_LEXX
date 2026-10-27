/**
 * «Вид» → Детали: the money colours as four presets (Классика · Мягкие · Монохром · Своя), journal chips as one switch
 * + presets, and the table density as a two-option toggle. Each colour, the break-even range, the guardrails and every
 * chip colour sit under «Ещё настройки» (opened by «Своя» / «Свои»). Previews render in the theme's real tokens plus
 * the preset's guarded colours, so a card shows exactly what the page will get.
 */
import * as React from "react";
import { useTheme } from "@/contexts/theme-context";
import { useAppearance } from "@/contexts/appearance-context";
import { Segmented } from "@/components/ds";
import { TradeChip } from "@/components/ds/trade-chip";
import { Switch } from "@/components/ui/switch";
import { fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHIP_GROUP_IDS, DENSITIES, type Appearance } from "@/lib/appearance/model";
import { computeAppearanceVars } from "@/lib/appearance/vars";
import {
  CHIP_PRESET_IDS, MONEY_PRESETS, MONEY_PRESET_IDS, applyChipsPreset, chipsPresetOf, moneyPresetOf, setAllChips,
} from "@/lib/appearance/presets";
import { THEME_SELECTORS, readThemeTokens } from "@/components/shared/theme-tokens";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { MoreSettings, OptionCard, OptionText, Section } from "./bits";
import { MoneyAdvanced } from "./money-advanced";
import { ChipsAdvanced } from "./chips-advanced";

/** CSS variables of `a` in the current theme on top of the theme's own tokens (overrides on <html> do not leak in). */
function usePreviewStyle() {
  const { theme } = useTheme();
  const base = React.useMemo(() => readThemeTokens(THEME_SELECTORS[theme]), [theme]);
  return (a: Appearance) => ({ ...base, ...computeAppearanceVars(a, theme).vars }) as React.CSSProperties;
}

/** The «Своя» card while no own colours are set: an empty picker hint instead of a copy of «Классика». */
function OwnHint() {
  return (
    <span aria-hidden="true" className="flex items-center gap-2 rounded-xl bg-card px-2 py-2">
      <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: "conic-gradient(from 90deg, #ef4444, #f59e0b, #84cc16, #14b8a6, #3b82f6, #a855f7, #ef4444)" }} />
      <span className="h-5 flex-1 rounded-full border border-dashed border-[var(--field-border)]" />
    </span>
  );
}

function MoneyPills() {
  return (
    <span aria-hidden="true" className="flex flex-wrap gap-1 rounded-xl bg-card py-2 pl-2 pr-7">
      <span className="rounded-full bg-up/12 px-2 py-0.5 text-xs font-semibold tabular-nums text-up">{fmtUsd(1240, { signed: true, decimals: 0 })}</span>
      <span className="rounded-full bg-down/12 px-2 py-0.5 text-xs font-semibold tabular-nums text-down">{fmtUsd(-860, { signed: true, decimals: 0 })}</span>
      <span className="rounded-full bg-be/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-be">$0</span>
    </span>
  );
}

function MoneyPresets({ onCustom }: { onCustom: () => void }) {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const style = usePreviewStyle();
  const current = moneyPresetOf(appearance.money);
  const ids = [...MONEY_PRESET_IDS, "custom"] as const;
  return (
    <Section title={t("money.title")} hint={t("money.hint")}>
      <div role="radiogroup" aria-label={t("money.title")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ids.map((id) => {
          const preview: Appearance = id === "custom" ? appearance : { ...appearance, money: { ...appearance.money, ...MONEY_PRESETS[id] } };
          return (
            <OptionCard
              key={id}
              selected={current === id}
              onSelect={() => (id === "custom" ? onCustom() : update((a) => ({ ...a, money: { ...a.money, ...MONEY_PRESETS[id] } })))}
              label={`${t(`money.presets.${id}`)}. ${t(`money.presetNotes.${id}`)}`}
            >
              {id === "custom" && current !== "custom"
                ? <OwnHint />
                : <span style={style(preview)} className="block rounded-xl text-foreground"><MoneyPills /></span>}
              <OptionText title={t(`money.presets.${id}`)} note={t(`money.presetNotes.${id}`)} />
            </OptionCard>
          );
        })}
      </div>
    </Section>
  );
}

const SAMPLE_CHIPS = [["strategy", "OPG"], ["strategy", "Day"], ["strategy", "MOC"], ["tag", "mistake"]] as const;

function ChipsQuick({ onCustom }: { onCustom: () => void }) {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const style = usePreviewStyle();
  const current = chipsPresetOf(appearance.chips);
  const on = current !== "off";
  const ids = [...CHIP_PRESET_IDS, "custom"] as const;
  return (
    <Section
      title={t("chips.switch")}
      hint={t("chips.switchHint")}
      aside={<Switch checked={on} onCheckedChange={(v) => update((a) => ({ ...a, chips: setAllChips(a.chips, v) }))} aria-label={t("chips.switch")} />}
    >
      {!on ? (
        <p className="text-xs text-muted-foreground">{t("chips.offNoteAll")}</p>
      ) : (
        <div role="radiogroup" aria-label={t("chips.switch")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ids.map((id) => {
            const preview: Appearance = id === "custom" ? appearance : { ...appearance, chips: applyChipsPreset(id) };
            return (
              <OptionCard
                key={id}
                selected={current === id}
                onSelect={() => (id === "custom" ? onCustom() : update((a) => ({ ...a, chips: applyChipsPreset(id) })))}
                label={`${t(`chips.presets.${id}`)}. ${t(`chips.presetNotes.${id}`)}`}
              >
                {id === "custom" && current !== "custom" ? <OwnHint /> : (
                  <span aria-hidden="true" style={style(preview)} className="flex flex-wrap gap-1 rounded-xl bg-card py-2 pl-2 pr-7">
                    {SAMPLE_CHIPS.map(([g, k]) => <TradeChip key={k} group={g} value={k}>{g === "tag" ? t("chips.keys.mistake") : k}</TradeChip>)}
                  </span>
                )}
                <OptionText title={t(`chips.presets.${id}`)} note={t(`chips.presetNotes.${id}`)} />
              </OptionCard>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function DensityToggle() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t("density.title")} hint={t("density.hint")}>
      <Segmented
        ariaLabel={t("density.title")}
        className="self-start"
        value={appearance.density}
        onChange={(density) => update((a) => ({ ...a, density }))}
        options={DENSITIES.map((d) => ({ value: d, label: t(`density.${d}`) }))}
      />
      <p className={cn("text-xs text-muted-foreground")}>{t(`density.${appearance.density}Hint`)}</p>
    </Section>
  );
}

export function DetailsTab() {
  const { t } = appearanceI18n.useT();
  const [more, setMore] = React.useState(false);
  const moreRef = React.useRef<HTMLDivElement>(null);
  const { appearance } = useAppearance();
  const chipsOn = CHIP_GROUP_IDS.some((g) => appearance.chips[g].on);
  // «Своя» / «Свои»: open «Ещё настройки» and bring the pickers into view.
  const openMore = () => {
    setMore(true);
    requestAnimationFrame(() => moreRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div className="flex flex-col gap-5">
      <MoneyPresets onCustom={openMore} />
      <ChipsQuick onCustom={openMore} />
      <DensityToggle />
      <div ref={moreRef} className="scroll-mt-2">
      <MoreSettings open={more} onOpenChange={setMore}>
        <MoneyAdvanced />
        {chipsOn && <p className="-mb-2 border-t border-[var(--glass-border)] pt-4 text-sm font-semibold text-foreground">{t("chips.advanced")}</p>}
        {chipsOn && <ChipsAdvanced />}
      </MoreSettings>
      </div>
    </div>
  );
}
