/**
 * The promotion moment: the new stage's coin flips in edge-on, settles with a small wobble and catches one shine.
 * Under «reduce motion» the coin is simply there (no flip, no shine). Shown once per promotion (reveal-model.ts).
 */
import * as React from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { medalsI18n } from "@/i18n/ns/medals";
import { latestPromotion, markSeen, readSeen, shouldReveal, type PromotionRow } from "./reveal-model";
import { MEDAL_STAGES, StageMedal, medalStageName, medalStageOf, type MedalStage } from "./stage-medal";

const HALO: Readonly<Record<MedalStage, string>> = {
  junior: "bg-[radial-gradient(closest-side,hsl(var(--medal-bronze)/0.35),transparent)]",
  trader: "bg-[radial-gradient(closest-side,hsl(var(--medal-silver)/0.35),transparent)]",
  senior: "bg-[radial-gradient(closest-side,hsl(var(--medal-gold)/0.4),transparent)]",
};

/**
 * Picks the newest unseen promotion of `user` from their stage history and opens the reveal once. `enabled` = the
 * viewer is that trader (a mentor looking at someone's path never consumes their moment).
 */
export function usePromotionReveal(user: string | null | undefined, history: readonly PromotionRow[] | undefined, enabled: boolean) {
  const [row, setRow] = React.useState<PromotionRow | null>(null);
  React.useEffect(() => {
    if (!enabled || !user || !history?.length) return;
    const p = latestPromotion(history);
    if (!p || !shouldReveal(p, readSeen(user))) return;
    markSeen(user, p.id); // remembered on open: a reload or another tab never replays it
    setRow(p);
  }, [enabled, user, history]);
  return { row, close: () => setRow(null) };
}

export function PromotionRevealDialog({ row, onClose }: { row: PromotionRow | null; onClose: () => void }) {
  const { t } = medalsI18n.useT();
  const reduce = useReducedMotion();
  const stage = row ? medalStageOf(row.toStage) : null;
  const next = stage ? MEDAL_STAGES[MEDAL_STAGES.indexOf(stage) + 1] ?? null : null;
  return (
    <Dialog open={!!row && !!stage} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md overflow-hidden text-center">
        {row && stage && (
          <div className="flex flex-col items-center gap-3 pt-2">
            <span className="micro-label text-muted-foreground">{t("reveal.eyebrow")}</span>
            <div className="relative grid place-items-center" style={{ perspective: 900 }}>
              <span aria-hidden="true" className={cn("pointer-events-none absolute -inset-10 rounded-full", HALO[stage])} />
              <motion.div
                className="relative"
                initial={reduce ? false : { rotateY: 90, scale: 0.72, opacity: 0 }}
                animate={{ rotateY: [90, -18, 7, 0], scale: [0.72, 1.04, 1, 1], opacity: [0, 1, 1, 1] }}
                transition={reduce ? { duration: 0 } : { duration: 1.05, times: [0, 0.55, 0.8, 1], ease: "easeOut" }}
              >
                <StageMedal stage={stage} size={200} shine={!reduce} />
              </motion.div>
            </div>
            <DialogTitle className="text-xl font-semibold text-foreground">{t("reveal.title", { stage: medalStageName(stage) })}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                <p className="text-xs tabular-nums">{t("reveal.since", { date: fmtDate(row.createdAt.slice(0, 10), "long") })}</p>
                <p className="font-medium text-foreground">{next ? t("reveal.next", { next: medalStageName(next) }) : t("reveal.top")}</p>
                <p>{t("reveal.body")}</p>
              </div>
            </DialogDescription>
            <Button className="mt-1 min-w-32" onClick={onClose}>{t("reveal.close")}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
