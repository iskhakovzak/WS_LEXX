/** «Вид» → Цвета: accent, text tone (light themes), lines and the interface font. Every colour is contrast-guarded. */
import { useTheme } from "@/contexts/theme-context";
import { useAppearance } from "@/contexts/appearance-context";
import { Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import {
  ACCENTS, ACCENT_IDS, FONT_IDS, FONT_STACKS, LINE_MODES, TEXT_TONES, TEXT_TONE_IDS, isLightTheme,
  type Appearance, type FontId, type LineMode,
} from "@/lib/appearance/model";
import { isHex } from "@/lib/appearance/color";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { CustomSwatch, GuardNote, OptionCard, Section, Swatch, SwatchGroup } from "./bits";

const INK_SWATCH = "linear-gradient(135deg, hsl(var(--foreground)) 50%, hsl(var(--background)) 50%)";

function AccentSection() {
  const { t } = appearanceI18n.useT();
  const { appearance, update, computed } = useAppearance();
  const set = (accent: Appearance["accent"]) => update((a) => ({ ...a, accent }));
  const custom = isHex(appearance.accent) ? appearance.accent : null;
  return (
    <Section title={t("colors.accent")} hint={t("colors.accentHint")}>
      <SwatchGroup label={t("colors.accent")}>
        {ACCENT_IDS.map((id) => (
          <Swatch key={id} color={ACCENTS[id] ?? INK_SWATCH} label={t(`colors.accents.${id}`)} selected={appearance.accent === id} onSelect={() => set(id)} />
        ))}
        <CustomSwatch value={custom} selected={!!custom} label={t("colors.customAria", { name: t("colors.accent") })} onPick={set} />
      </SwatchGroup>
      <GuardNote result={computed.report.accent} />
    </Section>
  );
}

function ToneSection() {
  const { t } = appearanceI18n.useT();
  const { theme } = useTheme();
  const { appearance, update, computed } = useAppearance();
  const set = (textTone: Appearance["textTone"]) => update((a) => ({ ...a, textTone }));
  const custom = isHex(appearance.textTone) ? appearance.textTone : null;
  return (
    <Section title={t("colors.tone")} hint={t("colors.toneHint")}>
      <SwatchGroup label={t("colors.tone")}>
        {TEXT_TONE_IDS.map((id) => (
          <Swatch key={id} label={t(`colors.tones.${id}`)} selected={appearance.textTone === id} onSelect={() => set(id)} color="#ffffff">
            <span className="text-sm font-semibold" style={{ color: TEXT_TONES[id] ?? "#171717" }}>Aa</span>
          </Swatch>
        ))}
        <CustomSwatch value={custom} selected={!!custom} label={t("colors.customAria", { name: t("colors.tone") })} onPick={set} />
      </SwatchGroup>
      {!isLightTheme(theme) && <p className="text-xs text-muted-foreground">{t("colors.toneDarkNote")}</p>}
      <GuardNote result={computed.report.tone} />
    </Section>
  );
}

function LinesSection() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const custom = isHex(appearance.lines) ? appearance.lines : null;
  const mode: LineMode | "custom" = custom ? "custom" : (appearance.lines as LineMode);
  return (
    <Section title={t("colors.lines")} hint={t("colors.linesHint")}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel={t("colors.lines")}
          value={mode === "custom" ? "" : mode}
          onChange={(v) => update((a) => ({ ...a, lines: v as LineMode }))}
          options={LINE_MODES.map((m) => ({ value: m, label: t(`colors.lineModes.${m}`) }))}
        />
        <SwatchGroup label={t("colors.custom")}>
          <CustomSwatch value={custom} selected={!!custom} label={t("colors.customAria", { name: t("colors.lines") })} onPick={(hex) => update((a) => ({ ...a, lines: hex }))} />
        </SwatchGroup>
      </div>
    </Section>
  );
}

function FontSection() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t("colors.font")} hint={t("colors.fontHint")}>
      <div role="radiogroup" aria-label={t("colors.font")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FONT_IDS.map((id: FontId) => (
          <OptionCard
            key={id}
            selected={appearance.font === id}
            onSelect={() => update((a) => ({ ...a, font: id }))}
            label={`${t(`colors.fonts.${id}`)}. ${t(`colors.fontNotes.${id}`)}`}
            className="p-3"
          >
            <span className={cn("block text-2xl font-semibold leading-none tracking-tight text-up tabular-nums")} style={{ fontFamily: FONT_STACKS[id] ?? "'Inter', system-ui, sans-serif" }}>
              +$4,320
            </span>
            <span className="block">
              <span className="block text-sm font-medium text-foreground">{t(`colors.fonts.${id}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`colors.fontNotes.${id}`)}</span>
            </span>
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}

export function ColorsTab() {
  return (
    <div className="flex flex-col gap-5">
      <AccentSection />
      <ToneSection />
      <LinesSection />
      <FontSection />
    </div>
  );
}
