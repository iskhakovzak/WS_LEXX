/**
 * The «Вид» background behind the shell: your image (from IndexedDB, under a scrim that keeps canvas text AA), the
 * slow smoke (lib/smoke at ~15 fps and 0.35× pace, faint), or a procedural CSS background (aurora / grid / dusk).
 * Fixed, z-index −1, no pointer events; nothing renders for «none».
 */
import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { useAppearance } from "@/contexts/appearance-context";
import { useTheme, isLightTheme } from "@/contexts/theme-context";
import { loadBgImage } from "@/lib/appearance/bg-store";
import { startSmoke } from "@/lib/smoke";

/** Fired on window after the stored image changed (saved / removed), so every reader reloads it. */
export const BG_IMAGE_EVENT = "ws-appearance-bg";

/** Object URL of the stored image (null when there is none); revoked on change / unmount. */
export function useBgImageUrl(enabled = true): string | null {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let current: string | null = null;
    const load = () => {
      void loadBgImage().then((blob) => {
        if (!alive) return;
        if (current) URL.revokeObjectURL(current);
        current = blob ? URL.createObjectURL(blob) : null;
        setUrl(current);
      });
    };
    load();
    window.addEventListener(BG_IMAGE_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(BG_IMAGE_EVENT, load);
      if (current) URL.revokeObjectURL(current);
    };
  }, [enabled]);
  return enabled ? url : null;
}

function SmokeCanvas({ light }: { light: boolean }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const still = !!useReducedMotion();
  React.useEffect(() => {
    const c = ref.current;
    return c ? startSmoke(c, { light, still, speed: 0.35, fps: 15 }) : undefined;
  }, [light, still]);
  // Faint on purpose: muted text on the canvas keeps 4.5:1 over the brightest wisp.
  return <canvas ref={ref} className="absolute" style={{ inset: "-8%", width: "116%", height: "116%", filter: "blur(18px)", opacity: light ? 0.25 : 0.2 }} />;
}

export function BackdropLayer() {
  const { appearance } = useAppearance();
  const { theme } = useTheme();
  const kind = appearance.bg.kind;
  const url = useBgImageUrl(kind === "image");
  if (kind === "none") return null;
  return (
    <div aria-hidden="true" className="app-backdrop bg-kind" data-kind={kind}>
      {kind === "image" && url && (
        <>
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${url}")` }} />
          <div className="absolute inset-0" style={{ background: "hsl(var(--background) / var(--bg-scrim))" }} />
        </>
      )}
      {kind === "smoke" && <SmokeCanvas light={isLightTheme(theme)} />}
    </div>
  );
}
