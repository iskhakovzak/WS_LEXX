/** «Вид» → Фон: our procedural backgrounds, your own image (IndexedDB on this device, never uploaded), panel material. */
import { Slider } from "@/components/ui/slider";
import { isScene } from "@/lib/appearance/scenes";
import * as React from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useAppearance } from "@/contexts/appearance-context";
import { Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PANEL_MODES, type BgKind } from "@/lib/appearance/model";
import { deleteBgImage, prepareBgImage, saveBgImage } from "@/lib/appearance/bg-store";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { OptionCard, Section } from "./bits";
import { BG_IMAGE_EVENT, useBgImageUrl } from "./backdrop-layer";
import { OriginalsGallery } from "./originals";

const OURS: readonly BgKind[] = ["none", "aurora", "grid", "dusk"];

/** At thumbnail size the faint full-screen glows would read as plain black / white: the tiles show them stronger. */
const PREVIEW_BOOST = { "--bg-glow": ".4" } as React.CSSProperties;

function Preview({ kind, imageUrl }: { kind: BgKind; imageUrl: string | null }) {
  return (
    <span aria-hidden="true" className="relative block h-20 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-background">
      {kind === "image" && imageUrl && <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${imageUrl}")` }} />}
      {kind === "image" && imageUrl && <span className="bg-kind absolute inset-0" style={{ background: "hsl(var(--background) / var(--bg-scrim))" }} />}
      {kind === "image" && !imageUrl && <span className="absolute inset-0 grid place-items-center text-muted-foreground"><ImagePlus className="h-5 w-5" /></span>}
      {(kind === "aurora" || kind === "grid" || kind === "dusk") && <span className="bg-kind absolute inset-0" data-kind={kind} style={PREVIEW_BOOST} />}
      <span className="glass-panel absolute bottom-2 left-2 right-6 top-6 rounded-lg" />
    </span>
  );
}

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
        <OptionCard
          selected={appearance.bg.kind === "image"}
          onSelect={() => (url ? update((a) => ({ ...a, bg: { ...a.bg, kind: "image" } })) : inputRef.current?.click())}
          label={t("background.kinds.image")}
          className="w-40"
        >
          <Preview kind="image" imageUrl={url} />
          <span className="px-1 text-sm font-medium text-foreground">{t("background.kinds.image")}</span>
        </OptionCard>
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus aria-hidden="true" />
            {url ? t("background.replace") : t("background.choose")}
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

export function BackgroundTab() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  return (
    <div className="flex flex-col gap-5">
      <OriginalsGallery />
      <Section title={t("background.ours")}>
        <div role="radiogroup" aria-label={t("background.ours")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OURS.map((kind) => (
            <OptionCard key={kind} selected={appearance.bg.kind === kind} onSelect={() => update((a) => ({ ...a, bg: { ...a.bg, kind } }))} label={t(`background.kinds.${kind}`)}>
              <Preview kind={kind} imageUrl={null} />
              <span className={cn("px-1 text-sm font-medium text-foreground")}>{t(`background.kinds.${kind}`)}</span>
            </OptionCard>
          ))}
        </div>
      </Section>
      <ImageControls />
      {(appearance.bg.kind === "image" || isScene(appearance.bg.kind)) && <BrightnessSection />}
      <Section title={t("background.panels")} hint={t("background.panelsHint")}>
        <Segmented
          ariaLabel={t("background.panels")}
          className="self-start"
          value={appearance.bg.panels}
          onChange={(panels) => update((a) => ({ ...a, bg: { ...a.bg, panels } }))}
          options={PANEL_MODES.map((m) => ({ value: m, label: t(`background.panelModes.${m}`) }))}
        />
      </Section>
    </div>
  );
}
