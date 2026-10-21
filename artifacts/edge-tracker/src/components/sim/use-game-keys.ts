/**
 * Game keys (DAS-like, model.keyAction): page-wide except while typing or with a dialog / menu open. The brief card eats
 * the first key (Tab still moves focus); Esc closes the place menu first. After the finish only Enter (again, once — not
 * while the next game is starting) and the timeframe keys work. A control the player reached with the keyboard
 * (:focus-visible) keeps its own Enter / Space, and a focused segmented control / menu keeps its arrows, so keyboard
 * users can still press the buttons they tab to; a button clicked with the mouse keeps no claim (the game buttons do not
 * even take focus), so Space stays «play».
 */
import * as React from "react";
import { keyAction } from "./model";
import type { DisplayTf } from "./tf-model";
import type { GameControls, Ticket } from "./game-types";
import type { GameView } from "./use-sim-game";

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};
const MODIFIERS = ["Shift", "Alt", "Control", "Meta"];
/** Something modal over the page: its own keys win. */
const OVERLAY_OPEN = "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='menu'][data-state='open'], [role='listbox'][data-state='open']";
const ACTIVATES = "button, a[href], summary, [role='button'], [role='link'], [role='switch'], [role='checkbox'], [role='radio'], [role='tab'], [role='menuitem'], [role='option']";
const COMPOSITE = "[role='radiogroup'], [role='tablist'], [role='menu'], [role='menubar'], [role='listbox'], [role='slider']";

const focusVisible = (el: Element): boolean => {
  try { return el.matches(":focus-visible"); } catch { return false; }
};
/** The keyboard-focused control handles this key itself (Enter / Space activate it, arrows move inside a group). */
export function ownedByFocus(target: EventTarget | null, code: string): boolean {
  const el = target instanceof Element ? target : null;
  if (!el || el === document.body || !focusVisible(el)) return false;
  if (code === "Enter" || code === "NumpadEnter" || code === "Space") return !!el.closest(ACTIVATES);
  if (code.startsWith("Arrow")) return !!el.closest(COMPOSITE);
  return false;
}

export type GameKeysState = {
  c: GameControls;
  k: Ticket;
  game: GameView;
  /** Hotkeys switched on. */
  enabled: boolean;
  /** The finish dialog is open. */
  blocked: boolean;
  brief: boolean;
  closeBrief: () => void;
  menuOpen: boolean;
  closeMenu: () => void;
  tfs: readonly DisplayTf[];
  setTf: (tf: DisplayTf) => void;
  togglePlay: () => void;
  faster: () => void;
  slower: () => void;
  pauseAll: () => void;
  step: () => void;
  jump: (() => void) | null;
  setBase: (slot: number) => void;
  clearPlan: () => boolean;
  onSkip?: () => void;
  onNoTrade?: () => void;
  canNoTrade: boolean;
};

export function useGameKeys(state: GameKeysState): void {
  const live = React.useRef(state);
  live.current = state;
  const lastStep = React.useRef(0);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = live.current;
      if (isTyping(e.target) || st.blocked) return;
      if (document.querySelector(OVERLAY_OPEN)) return;
      // The brief card goes away with any key (that key does nothing else).
      if (st.brief) {
        if (MODIFIERS.includes(e.key)) return;
        if (e.key !== "Tab") e.preventDefault();
        st.closeBrief();
        return;
      }
      if (ownedByFocus(e.target, e.code)) return;
      if (st.menuOpen && e.code === "Escape") { e.preventDefault(); st.closeMenu(); return; }
      if (!st.enabled) return;
      const key = keyAction(e);
      if (!key) return;
      const { c } = st;
      if (st.game.done) {
        if (key.a === "again") { e.preventDefault(); if (!e.repeat && !c.starting) c.again(); }
        // The review keeps the timeframe keys.
        if (key.a === "tf") { const tf = st.tfs[key.n ?? -1]; if (tf) { e.preventDefault(); st.setTf(tf); } }
        return;
      }
      e.preventDefault();
      if (e.repeat && key.a !== "step" && key.a !== "faster" && key.a !== "slower") return;
      switch (key.a) {
        case "step": {
          // Held key: auto-repeat fires ~30/s; keep it to ≤ 20 steps/s.
          const now = performance.now();
          if (e.repeat && now - lastStep.current < 50) return;
          lastStep.current = now;
          st.step();
          break;
        }
        case "play": st.togglePlay(); break;
        case "event": st.jump?.(); break;
        case "faster": st.faster(); break;
        case "slower": st.slower(); break;
        case "tf": { const tf = st.tfs[key.n ?? -1]; if (tf) st.setTf(tf); break; }
        case "size": st.setBase(key.n ?? -1); break;
        case "buy": case "sell": case "flat": case "half": c.order(key.a); break;
        case "breakeven": c.breakEven(); break;
        case "cancel": {
          // Esc = cancel the working orders: the plan lines, else the stop / target; playback pauses.
          st.pauseAll();
          const s = st.game.state;
          if (!st.clearPlan() && s.pos !== 0 && (s.stop != null || s.target != null)) c.setBracket(null, null);
          break;
        }
        case "undo": c.undo(); break;
        case "skip": st.onSkip?.(); break;
        case "noTrade": if (st.canNoTrade) st.onNoTrade?.(); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
