/**
 * The screen lock «Заблокировать» (lazy chunk; App renders it INSTEAD of the routes while locked, so no page, number or
 * notification is mounted underneath). Full screen, above everything (z-tooltip): the viewer's «Вид» background at full
 * brightness without panels — a «WS originals» scene or their own image; anything else falls back to the smoke — always
 * in the dark (a screensaver; kind to OLED), a slow drift and a breathing halo, the clock, New York time with the
 * market phase, the name and the WS mark. The first key (or a click) reveals the unlock field.
 * Lives at the top of components/ because it composes three features: appearance (scenes), shell (market clock) and lock.
 */
import * as React from "react";
import { LockKeyhole } from "lucide-react";
import SceneBackdrop from "@/components/appearance/scenes/scene-backdrop";
import { useBgImageUrl } from "@/components/appearance/backdrop-layer";
import { useMarketClock } from "@/components/shell/market-clock";
import { LockClock } from "@/components/lock/lock-clock";
import { UnlockForm } from "@/components/lock/unlock-form";
import { useAmbientDrift } from "@/components/lock/ambient";
import { WsMark } from "@/components/ds/brand";
import { useAppearance } from "@/contexts/appearance-context";
import { useTheme } from "@/contexts/theme-context";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { isLightTheme, type ThemeId } from "@/lib/appearance/model";
import { isScene, type SceneId } from "@/lib/appearance/scenes";
import { lockStore, useLockState } from "@/lib/lock/lock-store";
import { personNameFor } from "@/i18n";
import { lockI18n } from "@/i18n/ns/lock";
import { shellI18n } from "@/i18n/ns/shell";
import { latinizeName } from "@workspace/text-search";

/** The product name in the tab title (the visible UI is being renamed to WS_Desk). */
const PRODUCT = "WS_Desk";

/** The intro's rule: the Latin display name, else a transliteration. */
function latinShown(stored: string | null | undefined): string {
  if (!stored) return "";
  const v = personNameFor(stored, "en");
  return /[\u0400-\u04ff]/.test(v) ? latinizeName(v).trim() || v : v;
}

/** Dark surface tokens for everything inside the lock (the scenes' fog and scrim read --background). */
const DARK_VARS = { "--background": "0 0% 0%", "--foreground": "0 0% 96%", "--scene-vis": "1", colorScheme: "dark" } as React.CSSProperties;

export default function LockScreen() {
  const { t, lang } = lockI18n.useT();
  const { t: tsh } = shellI18n.useT();
  const { appearance } = useAppearance();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const { dismiss } = useToast();
  const dismissRef = React.useRef(dismiss);
  const lock = useLockState();
  const market = useMarketClock();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const glowRef = React.useRef<HTMLDivElement>(null);
  const [typing, setTyping] = React.useState(false);
  useAmbientDrift(rootRef, glowRef);

  const kind = appearance.bg.kind;
  const image = useBgImageUrl(kind === "image");
  const scene: SceneId = isScene(kind) ? kind : "smoke";
  const sceneTheme: ThemeId = isLightTheme(theme) ? "dark" : theme;

  // Tab title; toasts that were open stay closed; the server's view (attempts left, code set) on mount.
  React.useEffect(() => {
    const prev = document.title;
    document.title = `${PRODUCT} · ${t("tabTitle")}`;
    return () => { document.title = prev; };
  }, [t, lang]);
  React.useEffect(() => { dismissRef.current(); void lockStore.refreshStatus(); }, []);

  const name = user?.role !== "guest" ? latinShown(user?.traderName) : "";
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("screen.aria")}
      data-lock-screen=""
      className="fixed inset-0 z-tooltip select-none overflow-hidden bg-black text-white print:hidden"
      style={DARK_VARS}
    >
      <div aria-hidden="true" className="absolute inset-0">
        {kind === "image" && image ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${image}")`, transform: "translate3d(calc(var(--px, 0) * -14px), calc(var(--py, 0) * -10px), 0) scale(1.05)" }}
          />
        ) : (
          <SceneBackdrop key={`${scene}-${sceneTheme}`} scene={scene} theme={sceneTheme} ambient />
        )}
        {/* A soft vignette keeps the white type readable over the brightest photo. */}
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.55) 100%)" }} />
        <div
          className="absolute inset-0 transition-opacity duration-500"
          style={{ background: "rgba(0,0,0,0.35)", opacity: typing ? 1 : 0 }}
        />
      </div>

      <div className="relative flex h-full flex-col items-center justify-center gap-10 px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        <div className={typing ? "transition-[opacity,transform] duration-500 -translate-y-4 opacity-80" : "transition-[opacity,transform] duration-500"}>
          <LockClock nyTime={market.nyTime.slice(0, 5)} phase={market.phase} phaseLabel={tsh(`clock.phase.${market.phase}`)} glowRef={glowRef} />
        </div>
        <UnlockForm
          hasCode={lock.hasCode}
          kind={lock.kind}
          attemptsLeft={lock.attemptsLeft}
          onVisibleChange={setTyping}
          onForgot={logout}
        />
      </div>

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-3 transition-opacity duration-500 ${typing ? "opacity-0" : "opacity-100"}`}
      >
        <p className="flex items-center gap-2 text-xs text-white/50">
          <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
          {touch ? t("screen.hintTouch") : t("screen.hint")}
        </p>
        <div className="flex items-center gap-2.5 text-white/70">
          <WsMark size={22} />
          {name && <span className="text-[0.7rem] font-medium uppercase tracking-[0.28em]">{name}</span>}
        </div>
      </div>
    </div>
  );
}
