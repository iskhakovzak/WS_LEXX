import type { EggStats } from "@/lib/lock/eggs/egg-store";

/** What the launcher hands every lock-screen game. */
export type GameProps = {
  stats: EggStats;
  /** Change the records / preferences (saved to this browser at once). */
  update: (f: (s: EggStats) => EggStats) => void;
  sound: boolean;
  reduced: boolean;
  /** Close the game and go back to the lock screen. */
  onExit: () => void;
};

/** Monochrome segmented control styling shared by the games. */
export const SEG_BASE = "h-8 rounded-full px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";
export const SEG_ON = "bg-white text-black";
export const SEG_OFF = "text-white/65 hover:bg-white/10 hover:text-white";
export const SERIF = "var(--app-font-serif)";
