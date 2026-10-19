/**
 * Game-screen playback: play / pause at 1× / 5× / 30× base bars per second (remembered), driving the game controller
 * through `next(n)` (consecutive «next» requests merge in its queue, so a slow round trip just batches bars — nothing
 * is buffered client-side). The controller's own autoplay (own-mode lead-in) counts as playing too, and pausing stops
 * both. Ticks every 50 ms at most; fractional bars carry over (model.paceTick).
 */
import * as React from "react";
import { usePersistentState } from "@/components/ds";
import { isPace, nextPace, paceTick, type Pace } from "./model";

const TICK_MS = 50;

export function usePlayback({ next, active, external }: {
  next: (n: number) => void;
  /** False when the game is over (playback stops). */
  active: boolean;
  /** The controller's own autoplay flag (own-mode lead-in). */
  external: { playing: boolean; setPlaying: (v: boolean) => void };
}) {
  const [paceRaw, setPaceRaw] = usePersistentState<number>("sim.pace", 5);
  const pace: Pace = isPace(paceRaw) ? paceRaw : 5;
  const [own, setOwn] = React.useState(false);
  const live = React.useRef({ next, pace, external });
  live.current = { next, pace, external };

  React.useEffect(() => { if (!active) setOwn(false); }, [active]);

  React.useEffect(() => {
    if (!own || !active) return;
    let carry = 0;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const r = paceTick(live.current.pace, now - last, carry);
      last = now;
      carry = r.carry;
      if (r.bars > 0) live.current.next(r.bars);
    }, Math.max(TICK_MS, Math.round(1000 / Math.max(1, pace))));
    return () => window.clearInterval(id);
  }, [own, active, pace]);

  const playing = (own && active) || external.playing;
  const setPlaying = React.useCallback((v: boolean) => {
    setOwn(v);
    if (!v && live.current.external.playing) live.current.external.setPlaying(false);
  }, []);
  const ownRef = React.useRef(own);
  ownRef.current = own;
  const toggle = React.useCallback(() => setPlaying(!(live.current.external.playing || ownRef.current)), [setPlaying]);
  const setPace = React.useCallback((p: Pace) => setPaceRaw(p), [setPaceRaw]);
  const faster = React.useCallback(() => setPaceRaw((p) => nextPace(isPace(p) ? p : 5, 1)), [setPaceRaw]);
  const slower = React.useCallback(() => setPaceRaw((p) => nextPace(isPace(p) ? p : 5, -1)), [setPaceRaw]);
  return { playing, setPlaying, toggle, pace, setPace, faster, slower };
}
