/**
 * The «WS originals» scenes behind the shell (lazy chunk: loaded only when a scene is chosen). Photo scenes stack a
 * blurred depth layer, the photo (with a slight 3D tilt) and a fog layer at different depths, then a scrim of
 * 1 − --scene-vis (lib/appearance/scenes `sceneLevels`, set by «Яркость фона»). HOVER scenes add the smoke trail. Images: public/backgrounds (WebP at 1280 / 1920 / 2560 / 3840 px picked by srcset —
 * phones ≤ 1920; credits in CREDITS.md there).
 * `ambient` (the screen lock): the smoke keeps drifting while the window is unfocused (a desk monitor nobody is
 * clicking on), pausing only while the tab is hidden; the pointer parallax is off (the caller drifts --px / --py).
 */
import * as React from "react";
import { isLightTheme, type BgMotion, type ThemeId } from "@/lib/appearance/model";
import { LIGHT_PHOTO_FILTER, SCENES, TRAIL_ALPHA, sceneSources, sceneUrl, type SceneId } from "@/lib/appearance/scenes";
import { startSmoke } from "@/lib/smoke";
import { bgMotionAllowed, createTrail, isPaused, startSceneMotion } from "./motion";
import { RIDGE_LAYERS, RidgeSvg } from "./ridge";

/** A depth layer: nearer layers (bigger depth) travel further against the pointer; the photo also tilts in 3D. The
 * scale keeps the edges off-screen at full travel (±1). */
/** Photo tilt at full pointer travel, both axes. */
const TILT_DEG = 2.75;

function layer(depth: number, tilt = false): React.CSSProperties {
  const move = `translate3d(calc(var(--px, 0) * ${(-depth * 38).toFixed(1)}px), calc(var(--py, 0) * ${(-depth * 24).toFixed(1)}px), 0)`;
  const rot = tilt ? ` perspective(1200px) rotateY(calc(var(--px, 0) * ${TILT_DEG}deg)) rotateX(calc(var(--py, 0) * -${TILT_DEG}deg))` : "";
  return { position: "absolute", inset: 0, transform: `${move}${rot} scale(${(1.07 + depth * 0.04).toFixed(3)})`, willChange: "transform" };
}

function useTrailCanvas(enabled: boolean, light: boolean) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [trail, setTrail] = React.useState<ReturnType<typeof createTrail> | null>(null);
  React.useEffect(() => {
    if (!enabled || !ref.current) { setTrail(null); return; }
    setTrail(createTrail(ref.current, light));
  }, [enabled, light]);
  return { ref, trail };
}

const hiddenOnly = () => typeof document !== "undefined" && document.hidden;

export default function SceneBackdrop({ scene, theme, motion = "on", ambient = false }: { scene: SceneId; theme: ThemeId; motion?: BgMotion; ambient?: boolean }) {
  const def = SCENES[scene];
  const light = isLightTheme(theme);
  const root = React.useRef<HTMLDivElement>(null);
  const smokeRef = React.useRef<HTMLCanvasElement>(null);
  const allowed = bgMotionAllowed(motion);
  const hover = def.mode === "hover" && allowed;
  const { ref: trailRef, trail } = useTrailCanvas(hover, light);

  // Smoke: its own loop also draws the trail (one loop). Everything else: the scene motion loop.
  React.useEffect(() => {
    if (scene !== "smoke" || !smokeRef.current) return;
    return startSmoke(smokeRef.current, { light, still: !allowed, speed: 0.35, fps: 15, startAt: 3, paused: ambient ? hiddenOnly : isPaused, onFrame: () => { trail?.frame(); } });
  }, [scene, light, trail, ambient, allowed]);
  React.useEffect(() => {
    if (!root.current) return;
    return startSceneMotion(root.current, { parallax: def.mode === "3d" && !ambient, allowed, trail, externalLoop: scene === "smoke" });
  }, [def.mode, trail, scene, ambient, allowed]);

  const photo = def.photo;
  const src = photo ? sceneSources(photo) : null;
  return (
    <div ref={root} className="absolute inset-0 overflow-hidden">
      {photo && src && (
        <>
          <img src={sceneUrl(photo.file, "-bg")} alt="" decoding="async" style={{ ...layer(0.35), width: "100%", height: "100%", objectFit: "cover", filter: light ? `blur(6px) ${LIGHT_PHOTO_FILTER}` : "blur(6px)" }} />
          <picture>
            <source media="(max-width: 767px)" srcSet={src.phoneSrcSet} />
            <img src={src.src} srcSet={src.srcSet} sizes={src.sizes} alt="" decoding="async" style={{ ...layer(1, def.mode === "3d"), width: "100%", height: "100%", objectFit: "cover", objectPosition: `${photo.focusX}% 50%`, filter: light ? LIGHT_PHOTO_FILTER : undefined }} />
          </picture>
          <div style={{ ...layer(1.6), background: "radial-gradient(120% 60% at 50% 110%, hsl(var(--background) / .55), transparent 70%)" }} />
          <div className="absolute inset-0" style={{ background: "hsl(var(--background) / calc(1 - var(--scene-vis, 0.3)))" }} />
          {/* Vignette toward the canvas colour: the subject in the middle reads as the focus, edges calm down under the
              sidebar and panels (moves pixels toward the canvas only, so it never lowers text contrast). */}
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 75% 70% at 55% 45%, transparent 45%, hsl(var(--background) / ${light ? 0.35 : 0.55}) 100%)` }} />
        </>
      )}
      {scene === "ridge" && RIDGE_LAYERS.map((l, i) => (
        <div key={i} style={layer(l.depth)}><RidgeSvg>{l.node}</RidgeSvg></div>
      ))}
      {scene === "smoke" && (
        <canvas ref={smokeRef} className="absolute" style={{ inset: "-8%", width: "116%", height: "116%", filter: "blur(18px)", opacity: "var(--scene-vis, 0.2)" }} />
      )}
      {hover && <canvas ref={trailRef} className="absolute inset-0 h-full w-full" style={{ opacity: TRAIL_ALPHA, filter: "blur(8px)" }} />}
    </div>
  );
}
