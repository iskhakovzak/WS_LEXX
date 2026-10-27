/**
 * Lock-screen easter eggs (owner 2026-10-24: «мини-пасхалку в экране блокировки: типа игры в настольный теннис, где-то в
 * углу иконочка»). A faint ping-pong paddle in the bottom-right corner opens a small launcher with three games:
 * «Пинг-понг», «Свеча: выше/ниже» and «Дыхание». The games are a lazy chunk and use no API data (the server answers 423
 * while locked); records live in localStorage per person (lib/lock/eggs/egg-store).
 *
 * Keys (lib/lock/eggs/keys): inside an open game every key is the game's and Esc returns to the lock screen; in the
 * launcher Enter / Space / arrows / Esc work its buttons, while a printable key (a digit of the code) still starts the
 * unlock. Clicks inside never reach the lock screen's «click to unlock».
 */
import * as React from "react";
import { ArrowLeft, CandlestickChart, Volume2, VolumeX, Wind, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type EggStats, loadEggStats, saveEggStats } from "@/lib/lock/eggs/egg-store";
import { LOCK_EGG_ATTR } from "@/lib/lock/eggs/keys";
import { lockEggsI18n } from "@/i18n/ns/lockEggs";
import { motionReduced } from "@/lib/motion";
import { SERIF, type GameProps } from "./game-props";

type GameId = "pong" | "candle" | "breath";
const GAMES: readonly GameId[] = ["pong", "candle", "breath"];

const LAZY: Record<GameId, React.LazyExoticComponent<React.ComponentType<GameProps>>> = {
  pong: React.lazy(() => import("./pong-game")),
  candle: React.lazy(() => import("./candle-game")),
  breath: React.lazy(() => import("./breath-game")),
};

/** A table-tennis paddle with a ball: lucide has none. */
export function PaddleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M9.6 14.4 4.4 19.6" strokeWidth={3.4} />
      <circle cx="14.2" cy="9.8" r="6.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="5" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ICONS: Record<GameId, (p: { className?: string }) => React.ReactNode> = {
  pong: PaddleIcon,
  candle: ({ className }) => <CandlestickChart className={className} aria-hidden="true" />,
  breath: ({ className }) => <Wind className={className} aria-hidden="true" />,
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function LockEggs({ owner, dim }: { owner: string | null; dim: boolean }) {
  const { t } = lockEggsI18n.useT();
  const [menu, setMenu] = React.useState(false);
  const [game, setGame] = React.useState<GameId | null>(null);
  const [stats, setStats] = React.useState<EggStats>(() => loadEggStats(owner));
  const menuRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const reduced = React.useMemo(motionReduced, []);

  const update = React.useCallback((f: (s: EggStats) => EggStats) => {
    setStats((prev) => {
      const next = f(prev);
      if (next !== prev) saveEggStats(owner, next);
      return next;
    });
  }, [owner]);

  const exit = React.useCallback(() => {
    setGame(null);
    setMenu(false);
    // Back to the bare lock screen: no focused egg element, so the next digit starts the unlock.
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  // The launcher closes on a click / tap outside it.
  React.useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!menuRef.current?.contains(n) && !triggerRef.current?.contains(n)) setMenu(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menu]);

  React.useEffect(() => { if (game) panelRef.current?.focus(); }, [game]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setMenu(false); triggerRef.current?.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button[data-game]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const toggleSound = () => update((s) => ({ ...s, prefs: { ...s.prefs, sound: !s.prefs.sound } }));
  const Game = game ? LAZY[game] : null;

  return (
    <>
      <div
        {...{ [LOCK_EGG_ATTR]: "menu" }}
        onClick={stop}
        onKeyDown={onMenuKey}
        // A digit typed in the launcher moves focus to the unlock field: the launcher steps aside.
        onBlur={(e) => { if (menu && !e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(false); }}
        className={cn(
          "absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] transition-opacity duration-500",
          dim && !menu ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        {menu && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("trigger")}
            className="absolute bottom-12 right-0 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-black/75 p-1.5 text-white shadow-[0_16px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
          >
            <p className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-[0.24em] text-white/45">{t("launcher.title")}</p>
            {GAMES.map((id) => {
              const Icon = ICONS[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  data-game={id}
                  onClick={() => { setMenu(false); setGame(id); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/85">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-white">{t(`games.${id}.name`)}</span>
                    <span className="block truncate text-xs text-white/50">{t(`games.${id}.desc`)}</span>
                  </span>
                </button>
              );
            })}
            <p className="px-3 pb-1.5 pt-1 text-2xs text-white/35">{t("launcher.hint")}</p>
          </div>
        )}
        <button
          ref={triggerRef}
          type="button"
          aria-label={t("trigger")}
          aria-haspopup="menu"
          aria-expanded={menu}
          title={t("trigger")}
          onClick={() => setMenu((v) => !v)}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-full transition-[color,background-color,opacity] duration-300 hover:bg-white/10 hover:text-white/85 focus-visible:text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
            menu ? "bg-white/10 text-white/85" : "text-white/20",
          )}
        >
          <PaddleIcon className="h-[18px] w-[18px]" />
        </button>
      </div>

      {game && Game && (
        <div
          {...{ [LOCK_EGG_ATTR]: "game" }}
          onClick={stop}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); exit(); } }}
          className="absolute inset-0 grid place-items-center bg-black/70 px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in-0"
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t(`games.${game}.name`)}
            tabIndex={-1}
            className="flex max-h-full w-[min(52rem,100%)] flex-col gap-3 overflow-y-auto rounded-3xl border border-white/10 bg-black/60 p-3 text-white shadow-[0_24px_90px_rgba(0,0,0,0.65)] outline-none sm:p-5"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setGame(null); setMenu(true); }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {t("back")}
              </button>
              <h2 className="min-w-0 flex-1 truncate text-center text-xl italic text-white/90" style={{ fontFamily: SERIF }}>{t(`games.${game}.name`)}</h2>
              <button
                type="button"
                onClick={toggleSound}
                aria-pressed={stats.prefs.sound}
                aria-label={stats.prefs.sound ? t("soundOn") : t("soundOff")}
                title={stats.prefs.sound ? t("soundOn") : t("soundOff")}
                className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                {stats.prefs.sound ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={exit}
                aria-label={t("close")}
                title={`${t("close")} · Esc`}
                className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <React.Suspense fallback={<div className="aspect-[8/5] w-full" />}>
              <Game stats={stats} update={update} sound={stats.prefs.sound} reduced={reduced} onExit={exit} />
            </React.Suspense>
          </div>
        </div>
      )}
    </>
  );
}
