/**
 * Sign-in background: the same slowly drifting smoke as the opening intro (lib/smoke), so the
 * intro fades away into the very same scene (owner, 2026-10-24). Decorative only; one still frame under
 * prefers-reduced-motion; stops when the sign-in page unmounts.
 */
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useTheme } from "@/contexts/theme-context";
import { startSmoke } from "@/lib/smoke";

export function LoginSmoke() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const reduced = !!useReducedMotion();
  const light = theme === "light";
  useEffect(() => {
    const canvas = ref.current;
    return canvas ? startSmoke(canvas, { light, still: reduced }) : undefined;
  }, [light, reduced]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed"
      style={{ inset: "-8%", width: "116%", height: "116%", filter: "blur(10px)", opacity: light ? 0.85 : 0.9 }}
    />
  );
}
