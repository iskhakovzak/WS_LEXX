/**
 * The «Вид» background behind the shell: your image (from IndexedDB, under a scrim that keeps canvas text AA), a
 * procedural CSS background (aurora / grid / dusk) or a «WS originals» scene (lazy chunk, see scenes/).
 * Fixed, z-index −1, no pointer events; nothing renders for «none».
 */
import * as React from "react";
import { useAppearance } from "@/contexts/appearance-context";
import { useTheme } from "@/contexts/theme-context";
import { loadBgImage } from "@/lib/appearance/bg-store";
import { isScene } from "@/lib/appearance/scenes";

/** Fired on window after the stored image changed (saved / removed), so every reader reloads it. */
export const BG_IMAGE_EVENT = "ws-appearance-bg";

const SceneBackdrop = React.lazy(() => import("./scenes/scene-backdrop"));

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
      {isScene(kind) && (
        <React.Suspense fallback={null}>
          <SceneBackdrop key={`${kind}-${theme}`} scene={kind} theme={theme} />
        </React.Suspense>
      )}
    </div>
  );
}
