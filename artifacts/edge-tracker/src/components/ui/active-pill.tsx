/**
 * The solid pill behind the active option of a segmented control / tab list (the neutral «selected» fill — white in the
 * dark themes, ink in the light ones — never the accent, which belongs to the primary button). Every option renders it while active
 * with the same `layoutId`, so framer-motion slides one pill from the old option to the new one (a short spring,
 * ~250 ms; follows «Движение и анимации» through lib/motion — off: it simply jumps). Put it first inside a `relative`
 * option and wrap the option's content in a `relative` span so it paints above the pill.
 */
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const PILL_SPRING = { type: "spring", stiffness: 560, damping: 42, mass: 0.7 } as const;

export function ActivePill({ layoutId, className }: { layoutId: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      layoutId={reduce ? undefined : layoutId}
      transition={PILL_SPRING}
      className={cn("absolute inset-0 rounded-full bg-selected shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]", className)}
    />
  );
}
