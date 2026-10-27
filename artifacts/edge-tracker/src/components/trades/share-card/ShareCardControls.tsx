/**
 * Controls of the share-card dialog: background themes, the artwork picker of «Олимп», the photo picker, the
 * $ / R / % switch and the two toggles. Stateless — ShareCardDialog owns the state.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";
import { Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { shareCardI18n } from "@/i18n/ns/shareCard";
import { cn } from "@/lib/utils";
import { THEME_KINDS, type ResultMode, type ThemeKind } from "./model";
import { OLYMP_ART, artOf, artThumbUrl, stepArt } from "./themes";

/** Swatches of the procedural themes (CSS only: drawing them in canvas for a 64px tile is not worth it). */
const SWATCH: Record<Exclude<ThemeKind, "olymp" | "photo">, string> = {
  marble: "bg-[linear-gradient(135deg,#55555a_0%,#2a2a2e_40%,#0d0d0f_100%)]",
  night: "bg-[radial-gradient(circle_at_72%_28%,rgba(232,195,106,0.55),#121827_55%,#04050a_100%)]",
};

export function ThemePicker({ theme, art, photoUrl, onTheme }: { theme: ThemeKind; art: string; photoUrl: string | null; onTheme: (t: ThemeKind) => void }) {
  const { t } = shareCardI18n.useT();
  return (
    <div className="space-y-2">
      <p className="micro-label">{t("themes.label")}</p>
      <div role="radiogroup" aria-label={t("themes.label")} className="grid grid-cols-4 gap-2">
        {THEME_KINDS.map((k) => {
          const active = k === theme;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onTheme(k)}
              className={cn(
                "group flex min-w-0 flex-col items-center gap-1 rounded-xl p-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)]",
              )}
            >
              <span className={cn("relative block aspect-[4/5] w-full overflow-hidden rounded-lg ring-1 ring-border", active && "ring-2 ring-primary")}>
                {k === "olymp" && <img src={artThumbUrl(artOf(art).id)} alt="" className="h-full w-full object-cover" loading="lazy" />}
                {(k === "marble" || k === "night") && <span className={cn("absolute inset-0", SWATCH[k])} />}
                {k === "photo" && (photoUrl
                  ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                  : <span className="absolute inset-0 grid place-items-center bg-muted"><ImagePlus className="h-5 w-5" aria-hidden="true" /></span>)}
              </span>
              <span className="line-clamp-2 w-full text-center leading-tight">{t(`themes.${k}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** «Олимп»: prev / next, the position, a strip of thumbnails (the next one peeks out) and the credit. */
export function ArtPicker({ art, onArt }: { art: string; onArt: (id: string) => void }) {
  const { t } = shareCardI18n.useT();
  const current = artOf(art);
  const index = OLYMP_ART.findIndex((a) => a.id === current.id);
  const strip = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-art="${current.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current.id]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("art.prev")} title={t("art.prev")} onClick={() => onArt(stepArt(current.id, -1).id)}><ChevronLeft /></Button>
        <span className="min-w-0 flex-1 text-center text-xs tabular-nums text-muted-foreground">{t("art.position", { n: index + 1, total: OLYMP_ART.length })}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("art.next")} title={t("art.next")} onClick={() => onArt(stepArt(current.id, 1).id)}><ChevronRight /></Button>
      </div>
      <div ref={strip} className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {OLYMP_ART.map((a) => (
          <button
            key={a.id}
            type="button"
            data-art={a.id}
            aria-label={t("art.pick", { credit: a.credit })}
            aria-pressed={a.id === current.id}
            title={a.credit}
            onClick={() => onArt(a.id)}
            className={cn("aspect-[4/5] w-12 shrink-0 overflow-hidden rounded-md ring-1 ring-border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", a.id === current.id ? "ring-2 ring-primary" : "opacity-75 hover:opacity-100")}
          >
            <img src={artThumbUrl(a.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      <p className="truncate text-xs text-muted-foreground" title={current.credit}>{current.credit}</p>
    </div>
  );
}

export function PhotoPicker({ hasPhoto, failed, onFile }: { hasPhoto: boolean; failed: boolean; onFile: (f: File) => void }) {
  const { t } = shareCardI18n.useT();
  const input = React.useRef<HTMLInputElement | null>(null);
  return (
    <div className="space-y-1.5">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => input.current?.click()}>
        <ImagePlus className="h-4 w-4" aria-hidden="true" /> {hasPhoto ? t("photo.change") : t("photo.pick")}
      </Button>
      {failed ? <p className="text-xs text-down">{t("photo.failed")}</p> : <p className="text-xs text-muted-foreground">{t("photo.hint")}</p>}
    </div>
  );
}

export function ResultSwitch({ mode, modes, rOnly, onMode }: { mode: ResultMode | null; modes: readonly ResultMode[]; rOnly: boolean; onMode: (m: ResultMode) => void }) {
  const { t } = shareCardI18n.useT();
  const label = (m: ResultMode) => (m === "usd" ? "$" : m === "r" ? "R" : "%");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="micro-label">{t("result.label")}</p>
        {mode && modes.length > 1 && (
          <Segmented
            ariaLabel={t("result.label")}
            size="sm"
            value={mode}
            onChange={onMode}
            options={modes.map((m) => ({ value: m, label: label(m), title: t(`result.${m}`) }))}
          />
        )}
      </div>
      {mode && <p className="text-xs text-muted-foreground">{t(`result.${mode}`)}</p>}
      {rOnly && <p className="text-xs text-muted-foreground">{t("result.rOnly")}</p>}
    </div>
  );
}

export function ToggleRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
