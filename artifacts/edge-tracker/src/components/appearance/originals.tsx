/**
 * «Выбрать фон» (Вид → Фон): one gallery in five groups — Машины · Античность · Природа · Город · Абстракции (our
 * procedural backgrounds, the drawn / generated scenes and «Без фона»). Only the open group's tiles render; tiles use
 * small lazy thumbnails (`-thumb.webp`) and the full scene loads only once chosen. Photo credits sit in each tile's
 * tooltip and under the gallery for the chosen one (CC BY / BY-SA require it); all of them in
 * public/backgrounds/CREDITS.md.
 */
import * as React from "react";
import { ExternalLink, ImagePlus, Move3d, MousePointer2 } from "lucide-react";
import { useAppearance } from "@/contexts/appearance-context";
import { Segmented } from "@/components/ds";
import { SCENES, SCENE_GROUPS, isScene, sceneUrl, scenesIn, type SceneGroup } from "@/lib/appearance/scenes";
import type { BgKind } from "@/lib/appearance/model";
import { BASE } from "@/lib/api";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { OptionCard, OptionText } from "./bits";
import { useBgImageUrl } from "./backdrop-layer";
import { RIDGE_LAYERS, RidgeSvg } from "./scenes/ridge";

const SMOKE_STILL = "radial-gradient(40% 50% at 30% 40%, hsl(var(--foreground) / .18), transparent 70%), radial-gradient(35% 40% at 70% 60%, hsl(var(--foreground) / .14), transparent 70%), radial-gradient(60% 50% at 50% 50%, hsl(var(--foreground) / .07), transparent 75%)";
/** At thumbnail size the faint full-screen glows would read as plain black / white: the tiles show them stronger. */
const PREVIEW_BOOST = { "--bg-glow": ".4" } as React.CSSProperties;
const PROCEDURAL: readonly BgKind[] = ["none", "aurora", "grid", "dusk"];

/** The «Абстракции» group: «Без фона», our CSS backgrounds, then the drawn / generated scenes. */
function kindsIn(group: SceneGroup): BgKind[] {
  return group === "abstract" ? [...PROCEDURAL, ...scenesIn("abstract")] : scenesIn(group);
}
export function groupOf(kind: BgKind): SceneGroup {
  return isScene(kind) ? SCENES[kind].group : "abstract";
}

/** A 16:10 picture of any background kind (gallery tiles, the Тема tab). */
export function BgThumb({ kind }: { kind: BgKind }) {
  const imageUrl = useBgImageUrl(kind === "image");
  const photo = isScene(kind) ? SCENES[kind].photo : undefined;
  return (
    <span aria-hidden="true" className="relative block aspect-[16/10] overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[#0a0a0a]">
      {photo && <img src={sceneUrl(photo.file, "-thumb")} alt="" width={480} height={300} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
      {kind === "smoke" && <span className="dark absolute inset-0" style={{ background: SMOKE_STILL.replaceAll("var(--foreground)", "0 0% 94%") }} />}
      {kind === "ridge" && (
        <span className="absolute inset-0" style={{ "--foreground": "0 0% 94%", "--ridge-k": "3" } as React.CSSProperties}>
          <RidgeSvg>{RIDGE_LAYERS.map((l, i) => <g key={i}>{l.node}</g>)}</RidgeSvg>
        </span>
      )}
      {(kind === "none" || kind === "aurora" || kind === "grid" || kind === "dusk") && (
        <span className="absolute inset-0 bg-background">
          {kind !== "none" && <span className="bg-kind absolute inset-0" data-kind={kind} style={PREVIEW_BOOST} />}
          <span className="glass-panel absolute bottom-2 left-2 right-6 top-6 rounded-lg" />
        </span>
      )}
      {kind === "image" && (imageUrl
        ? <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${imageUrl}")` }} />
        : <span className="absolute inset-0 grid place-items-center bg-background text-muted-foreground"><ImagePlus className="h-5 w-5" /></span>)}
    </span>
  );
}

function Badge({ kind }: { kind: BgKind }) {
  const { t } = appearanceI18n.useT();
  if (!isScene(kind)) return null;
  const mode = SCENES[kind].mode;
  return (
    <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-2xs font-semibold tracking-wide text-white">
      {mode === "3d" ? <Move3d className="h-3 w-3" aria-hidden="true" /> : <MousePointer2 className="h-3 w-3" aria-hidden="true" />}
      {mode === "3d" ? t("background.badge3d") : t("background.badgeHover")}
    </span>
  );
}

export function BackgroundGallery() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const current = appearance.bg.kind;
  const [group, setGroup] = React.useState<SceneGroup>(() => groupOf(current));
  const chosen = isScene(current) ? SCENES[current].photo : undefined;
  const credit = (kind: BgKind) => {
    const p = isScene(kind) ? SCENES[kind].photo : undefined;
    return p ? t("background.credit", { author: p.credit.author, license: p.credit.license }) : undefined;
  };
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        ariaLabel={t("background.groupsAria")}
        className="self-start"
        value={group}
        onChange={setGroup}
        options={SCENE_GROUPS.map((g) => ({ value: g, label: t(`background.groups.${g}`), count: kindsIn(g).length }))}
      />
      <div role="radiogroup" aria-label={t(`background.groups.${group}`)} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {kindsIn(group).map((kind) => {
          const name = t(`background.kinds.${kind}`);
          const note = t(`background.notes.${kind}`);
          const c = credit(kind);
          return (
            <OptionCard
              key={kind}
              title={c ? `${name} · ${c}` : note}
              selected={current === kind}
              onSelect={() => update((a) => ({ ...a, bg: { ...a.bg, kind } }))}
              label={`${name}. ${note}${c ? `. ${c}` : ""}`}
            >
              <span className="relative block">
                <BgThumb kind={kind} />
                <Badge kind={kind} />
              </span>
              <OptionText title={name} note={note} />
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
    </div>
  );
}
