/**
 * «WS originals» gallery (Вид → Фон): interactive scenes with a «3D» / «HOVER» badge. Tiles use small thumbnails
 * (`-thumb.webp`, lazy); the full scene loads only once chosen. Photo credits sit in each tile's tooltip and under the
 * gallery for the chosen one (CC BY / BY-SA require it); all of them in public/backgrounds/CREDITS.md.
 */
import { ExternalLink, Move3d, MousePointer2 } from "lucide-react";
import { useAppearance } from "@/contexts/appearance-context";
import { SCENES, SCENE_IDS, isScene, sceneUrl, type SceneId } from "@/lib/appearance/scenes";
import { BASE } from "@/lib/api";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { OptionCard, Section } from "./bits";
import { RIDGE_LAYERS, RidgeSvg } from "./scenes/ridge";

const SMOKE_STILL = "radial-gradient(40% 50% at 30% 40%, hsl(var(--foreground) / .18), transparent 70%), radial-gradient(35% 40% at 70% 60%, hsl(var(--foreground) / .14), transparent 70%), radial-gradient(60% 50% at 50% 50%, hsl(var(--foreground) / .07), transparent 75%)";

function SceneThumb({ id }: { id: SceneId }) {
  const photo = SCENES[id].photo;
  return (
    <span aria-hidden="true" className="relative block aspect-[16/10] overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[#0a0a0a]">
      {photo && <img src={sceneUrl(photo.file, "-thumb")} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
      {id === "smoke" && <span className="dark absolute inset-0" style={{ background: SMOKE_STILL.replaceAll("var(--foreground)", "0 0% 94%") }} />}
      {id === "ridge" && (
        <span className="absolute inset-0" style={{ "--foreground": "0 0% 94%", "--ridge-k": "3" } as React.CSSProperties}>
          <RidgeSvg>{RIDGE_LAYERS.map((l, i) => <g key={i}>{l.node}</g>)}</RidgeSvg>
        </span>
      )}
    </span>
  );
}

export function OriginalsGallery() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const current = appearance.bg.kind;
  const chosen = isScene(current) ? SCENES[current].photo : undefined;
  const credit = (id: SceneId) => {
    const p = SCENES[id].photo;
    return p ? t("background.credit", { author: p.credit.author, license: p.credit.license }) : undefined;
  };
  return (
    <Section title={t("background.originals")} hint={t("background.originalsHint")}>
      <div role="radiogroup" aria-label={t("background.originals")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SCENE_IDS.map((id) => {
          const name = t(`background.kinds.${id}`);
          const mode = SCENES[id].mode;
          const badge = mode === "3d" ? t("background.badge3d") : t("background.badgeHover");
          const c = credit(id);
          return (
              <OptionCard key={id} title={c ? `${name} · ${c}` : name} selected={current === id} onSelect={() => update((a) => ({ ...a, bg: { ...a.bg, kind: id } }))} label={`${name}, ${badge}${c ? `. ${c}` : ""}`}>
                <span className="relative block">
                  <SceneThumb id={id} />
                  <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-2xs font-semibold tracking-wide text-white">
                    {mode === "3d" ? <Move3d className="h-3 w-3" aria-hidden="true" /> : <MousePointer2 className="h-3 w-3" aria-hidden="true" />}
                    {badge}
                  </span>
                </span>
                <span className="truncate px-1 text-sm font-medium text-foreground">{name}</span>
              </OptionCard>
          );
        })}
      </div>
      {chosen && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t("background.credit", { author: chosen.credit.author, license: chosen.credit.license })}</span>
          <a href={chosen.credit.source} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
            {t("background.creditSource")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          <a href={`${BASE}/backgrounds/CREDITS.md`} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
            {t("background.creditsAll")}
          </a>
        </p>
      )}
    </Section>
  );
}
