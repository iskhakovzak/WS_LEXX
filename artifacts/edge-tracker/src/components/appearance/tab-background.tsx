/**
 * «Вид» → Фон: «Выбрать фон» (the grouped gallery) and «Яркость фона» up front; your own image (IndexedDB on this
 * device, never uploaded) and the panel material under «Ещё настройки».
 */
import * as React from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { isScene } from "@/lib/appearance/scenes";
import { useAppearance } from "@/contexts/appearance-context";
import { Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PANEL_MODES } from "@/lib/appearance/model";
import { deleteBgImage, prepareBgImage, saveBgImage } from "@/lib/appearance/bg-store";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { MoreSettings, OptionCard, OptionText, Section } from "./bits";
import { BG_IMAGE_EVENT, useBgImageUrl } from "./backdrop-layer";
import { BackgroundGallery, BgThumb } from "./originals";

function ImageControls() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const url = useBgImageUrl();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await prepareBgImage(file);
      try { await saveBgImage(blob); } catch { setError(t("background.errors.storage")); return; }
      window.dispatchEvent(new Event(BG_IMAGE_EVENT));
      update((a) => ({ ...a, bg: { ...a.bg, kind: "image" } }));
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(code === "not-image" ? t("background.errors.notImage") : code === "too-big" ? t("background.errors.tooBig") : t("background.errors.failed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onRemove() {
    await deleteBgImage();
    window.dispatchEvent(new Event(BG_IMAGE_EVENT));
    if (appearance.bg.kind === "image") update((a) => ({ ...a, bg: { ...a.bg, kind: "none" } }));
  }

  return (
    <Section title={t("background.image")} hint={t("background.imageHint")}>
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label={t("background.image")} className="w-40">
          <OptionCard
            selected={appearance.bg.kind === "image"}
            onSelect={() => (url ? update((a) => ({ ...a, bg: { ...a.bg, kind: "image" } })) : inputRef.current?.click())}
            label={`${t("background.kinds.image")}. ${t("background.notes.image")}`}
          >
            <BgThumb kind="image" />
            <OptionText title={t("background.kinds.image")} />
          </OptionCard>
        </div>
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus aria-hidden="true" />
            {url ? t("background.replace") : t("background.chooseFile")}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void onRemove()}>
              <Trash2 aria-hidden="true" />
              {t("background.remove")}
            </Button>
          )}
        </div>
      </div>
      {appearance.bg.kind === "image" && !url && <p className="text-xs text-muted-foreground">{t("background.missing")}</p>}
      {error && <p role="alert" className="text-xs text-down">{error}</p>}
    </Section>
  );
}

/** «Яркость фона»: 0…100 % of the brightest the theme allows for this scene / image (lib/appearance/scenes). */
function BrightnessSection() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const [draft, setDraft] = React.useState(appearance.bg.brightness);
  React.useEffect(() => { setDraft(appearance.bg.brightness); }, [appearance.bg.brightness]);
  const pct = Math.round(draft * 100);
  return (
    <Section title={t("background.brightness")} hint={t("background.brightnessHint")} aside={<span className="text-sm font-semibold tabular-nums text-foreground">{pct}%</span>}>
      <Slider
        className="max-w-md"
        min={0}
        max={100}
        step={5}
        value={[pct]}
        aria-label={t("background.brightness")}
        onValueChange={([v]) => setDraft(v / 100)}
        onValueCommit={([v]) => update((a) => ({ ...a, bg: { ...a.bg, brightness: v / 100 } }))}
      />
    </Section>
  );
}

function PanelsSection() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t("background.panels")} hint={t("background.panelsHint")}>
      <Segmented
        ariaLabel={t("background.panels")}
        className="self-start"
        value={appearance.bg.panels}
        onChange={(panels) => update((a) => ({ ...a, bg: { ...a.bg, panels } }))}
        options={PANEL_MODES.map((m) => ({ value: m, label: t(`background.panelModes.${m}`) }))}
      />
      <p className="text-xs text-muted-foreground">{t(`background.panelNotes.${appearance.bg.panels}`)}</p>
    </Section>
  );
}

export function BackgroundTab() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const kind = appearance.bg.kind;
  return (
    <div className="flex flex-col gap-5">
      <Section
        title={t("background.choose")}
        hint={t("background.chooseHint")}
        aside={kind !== "none" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => update((a) => ({ ...a, bg: { ...a.bg, kind: "none" } }))}>
            <X aria-hidden="true" />
            {t("background.clear")}
          </Button>
        )}
      >
        <BackgroundGallery />
      </Section>
      {(kind === "image" || isScene(kind)) && <BrightnessSection />}
      <MoreSettings>
        <ImageControls />
        <PanelsSection />
      </MoreSettings>
    </div>
  );
}
