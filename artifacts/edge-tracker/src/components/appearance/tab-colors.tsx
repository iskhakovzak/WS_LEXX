/**
 * «Вид» → Цвета: six accent swatches and three fonts up front; the other accents + your own colour, the text tone
 * (light themes), the lines and the mono font under «Ещё настройки». Every colour is contrast-guarded.
 * A choice that lives under «Ещё» but is the current one also shows up front, so the selection is always visible.
 */
import { useTheme } from "@/contexts/theme-context";
import { useAppearance } from "@/contexts/appearance-context";
import { Segmented } from "@/components/ds";
import {
  ACCENTS, ACCENT_IDS, FONT_IDS, FONT_STACKS, LINE_MODES, TEXT_TONES, TEXT_TONE_IDS, isLightTheme,
  type AccentId, type Appearance, type FontId, type LineMode,
} from "@/lib/appearance/model";
import { isHex } from "@/lib/appearance/color";
import { cn } from "@/lib/utils";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { CustomSwatch, GuardNote, MoreSettings, OptionCard, OptionText, Section, Swatch, SwatchGroup } from "./bits";

const INK_SWATCH = "linear-gradient(135deg, hsl(var(--foreground)) 50%, hsl(var(--background)) 50%)";
/** The six accents up front: ink + hues that do not clash with the green / red money colours. */
const TOP_ACCENTS: readonly AccentId[] = ["ink", "blue", "cyan", "teal", "amber", "orange"];
const TOP_FONTS: readonly FontId[] = ["inter", "geist", "serif"];

function useAccent() {
  const { appearance, update } = useAppearance();
  const set = (accent: Appearance["accent"]) => update((a) => ({ ...a, accent }));
  return { accent: appearance.accent, set };
}

function AccentSwatches({ ids }: { ids: readonly AccentId[] }) {
  const { t } = appearanceI18n.useT();
  const { accent, set } = useAccent();
  return (
    <>
      {ids.map((id) => (
        <Swatch key={id} color={ACCENTS[id] ?? INK_SWATCH} label={t(`colors.accents.${id}`)} selected={accent === id} onSelect={() => set(id)} />
      ))}
    </>
  );
}

function AccentSection() {
  const { t } = appearanceI18n.useT();
  const { computed } = useAppearance();
  const { accent } = useAccent();
  const extra = !isHex(accent) && !TOP_ACCENTS.includes(accent as AccentId) ? [accent as AccentId] : [];
  const name = isHex(accent) ? t("colors.custom") : t(`colors.accents.${accent as AccentId}`);
  return (
    <Section title={t("colors.accent")} hint={t("colors.accentHint")} aside={<span className="text-xs text-muted-foreground">{t("colors.accentNow", { name })}</span>}>
      <SwatchGroup label={t("colors.accent")}>
        <AccentSwatches ids={[...TOP_ACCENTS, ...extra]} />
      </SwatchGroup>
      <GuardNote result={computed.report.accent} />
    </Section>
  );
}

function MoreAccentsSection() {
  const { t } = appearanceI18n.useT();
  const { accent, set } = useAccent();
  const custom = isHex(accent) ? accent : null;
  return (
    <Section title={t("colors.moreAccents")} hint={t("colors.moreAccentsHint")}>
      <SwatchGroup label={t("colors.moreAccents")}>
        <AccentSwatches ids={ACCENT_IDS.filter((id) => !TOP_ACCENTS.includes(id))} />
        <CustomSwatch value={custom} selected={!!custom} label={t("colors.customAria", { name: t("colors.accent") })} onPick={set} />
      </SwatchGroup>
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

function FontCards({ ids, title, hint }: { ids: readonly FontId[]; title: string; hint?: string }) {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  return (
    <Section title={title} hint={hint}>
      <div role="radiogroup" aria-label={title} className={cn("grid grid-cols-2 gap-2", ids.length > 3 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
        {ids.map((id) => (
          <OptionCard
            key={id}
            selected={appearance.font === id}
            onSelect={() => update((a) => ({ ...a, font: id }))}
            label={`${t(`colors.fonts.${id}`)}. ${t(`colors.fontNotes.${id}`)}`}
            className="p-3"
          >
            <span className="block text-2xl font-semibold leading-none tracking-tight text-up tabular-nums" style={{ fontFamily: FONT_STACKS[id] ?? "'Inter', system-ui, sans-serif" }}>
              +$4,320
            </span>
            <OptionText title={t(`colors.fonts.${id}`)} note={t(`colors.fontNotes.${id}`)} />
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}

export function ColorsTab() {
  const { t } = appearanceI18n.useT();
  const { appearance } = useAppearance();
  const fonts = TOP_FONTS.includes(appearance.font) ? TOP_FONTS : [...TOP_FONTS, appearance.font];
  return (
    <div className="flex flex-col gap-5">
      <AccentSection />
      <FontCards ids={fonts} title={t("colors.font")} hint={t("colors.fontHint")} />
      <MoreSettings>
        <MoreAccentsSection />
        <ToneSection />
        <LinesSection />
        <FontCards ids={FONT_IDS.filter((id) => !TOP_FONTS.includes(id))} title={t("colors.moreFonts")} />
      </MoreSettings>
    </div>
  );
}
