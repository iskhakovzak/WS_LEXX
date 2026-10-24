/**
 * The «WS originals» scenes behind the shell (lazy chunk: loaded only when a scene is chosen). Photo scenes stack a
 * blurred depth layer, the photo (with a slight 3D tilt) and a fog layer at different depths, then a scrim sized by
 * lib/appearance/scenes `photoScrim` so muted text on the canvas stays AA over any pixel. HOVER scenes add the smoke
 * trail. Images: public/backgrounds (WebP, ≤ 100 KB each; credits in CREDITS.md there).
 */
import * as React from "react";
import { isLightTheme, type ThemeId } from "@/lib/appearance/model";
import { SCENES, TRAIL_ALPHA, photoScrim, sceneUrl, smokeLevels, type SceneId } from "@/lib/appearance/scenes";
import { startSmoke } from "@/lib/smoke";
import { createTrail, isPaused, prefersReducedMotion, startSceneMotion } from "./motion";
import { RIDGE_LAYERS, RidgeSvg } from "./ridge";

function layer(depth: number, tilt = false): React.CSSProperties {
  const move = `translate3d(calc(var(--px, 0) * ${(-depth * 22).toFixed(1)}px), calc(var(--py, 0) * ${(-depth * 14).toFixed(1)}px), 0)`;
  const rot = tilt ? " perspective(1400px) rotateY(calc(var(--px, 0) * 2deg)) rotateX(calc(var(--py, 0) * -1.5deg))" : "";
  return { position: "absolute", inset: 0, transform: `${move}${rot} scale(${(1.04 + depth * 0.03).toFixed(3)})`, willChange: "transform" };
}

function useTrailCanvas(enabled: boolean, light: boolean) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [trail, setTrail] = React.useState<ReturnType<typeof createTrail> | null>(null);
  React.useEffect(() => {
    if (!enabled || !ref.current || prefersReducedMotion()) { setTrail(null); return; }
    setTrail(createTrail(ref.current, light));
  }, [enabled, light]);
  return { ref, trail };
}

export default function SceneBackdrop({ scene, theme }: { scene: SceneId; theme: ThemeId }) {
  const def = SCENES[scene];
  const light = isLightTheme(theme);
  const root = React.useRef<HTMLDivElement>(null);
  const smokeRef = React.useRef<HTMLCanvasElement>(null);
  const hover = def.mode === "hover";
  const { ref: trailRef, trail } = useTrailCanvas(hover, light);
  const levels = scene === "smoke" ? smokeLevels(theme) : null;

  // Smoke: its own loop also draws the trail (one loop). Everything else: the scene motion loop.
  React.useEffect(() => {
    if (scene !== "smoke" || !smokeRef.current) return;
    return startSmoke(smokeRef.current, { light, still: prefersReducedMotion(), speed: 0.35, fps: 15, startAt: 3, paused: isPaused, onFrame: () => { trail?.frame(); } });
  }, [scene, light, trail]);
  React.useEffect(() => {
    if (!root.current) return;
    return startSceneMotion(root.current, { parallax: def.mode === "3d", trail, externalLoop: scene === "smoke" });
  }, [def.mode, trail, scene]);

  const photo = def.photo;
  const scrim = photo ? photoScrim(theme, photo, hover ? TRAIL_ALPHA : 0) : 0;
  const trailAlpha = levels ? levels.trail : TRAIL_ALPHA;
  return (
    <div ref={root} className="absolute inset-0 overflow-hidden">
      {photo && (
        <>
          <img src={sceneUrl(photo.file, "-bg")} alt="" decoding="async" style={{ ...layer(0.35), width: "100%", height: "100%", objectFit: "cover", filter: "blur(6px)" }} />
          <img src={sceneUrl(photo.file)} alt="" decoding="async" style={{ ...layer(1, def.mode === "3d"), width: "100%", height: "100%", objectFit: "cover", objectPosition: `${def.focusX ?? 50}% 50%` }} />
          <div style={{ ...layer(1.6), background: "radial-gradient(120% 60% at 50% 110%, hsl(var(--background) / .55), transparent 70%)" }} />
          <div className="absolute inset-0" style={{ background: `hsl(var(--background) / ${scrim})` }} />
        </>
      )}
      {scene === "ridge" && RIDGE_LAYERS.map((l, i) => (
        <div key={i} style={layer(l.depth)}><RidgeSvg>{l.node}</RidgeSvg></div>
      ))}
      {scene === "smoke" && (
        <canvas ref={smokeRef} className="absolute" style={{ inset: "-8%", width: "116%", height: "116%", filter: "blur(18px)", opacity: levels?.smoke ?? 0.15 }} />
      )}
      {hover && <canvas ref={trailRef} className="absolute inset-0 h-full w-full" style={{ opacity: trailAlpha, filter: "blur(8px)" }} />}
    </div>
  );
}
