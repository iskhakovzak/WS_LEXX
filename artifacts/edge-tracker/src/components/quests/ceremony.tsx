/**
 * The ceremony of a BIG win (a stage step, setup gold, a closed leak, a comeback after a stop, a platinum tier): the
 * coin flips in, a short burst of confetti, the title. Small wins get only the quiet in-app notice. The server lists the
 * unseen big wins (QuestsMe.celebrate); closing marks them seen (POST /api/quests/achievements/seen), so another tab or
 * a reload never replays them. Motion follows the app setting (useReducedMotion): reduced = the coin is simply there.
 */
import * as React from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { fmtDayMonth } from "@/lib/format";
import { questsI18n } from "@/i18n/ns/quests";
import type { AchievementCategory, QuestsMe } from "@/lib/quests/types";
import { textOf, tierLabel } from "./model";
import { Medal, TIER_TONE } from "./medal";
import { useMarkSeen } from "./api";

type Item = NonNullable<QuestsMe["celebrate"]>[number];

const PIECES = 26;
/** Token colours only (the medal metals and the semantic up / accent). */
const PIECE_TONES = ["bg-medal-gold", "bg-medal-silver", "bg-medal-bronze", "bg-up", "bg-primary"] as const;

function categoryOf(id: string, me: QuestsMe): AchievementCategory {
  if (id.startsWith("leak:")) return "leaks";
  if (id.startsWith("path:")) return "growth";
  if (id.startsWith("setup:")) return "mastery";
  return me.achievements.find((a) => a.id === id)?.category ?? "growth";
}

function Confetti() {
  const pieces = React.useMemo(() => Array.from({ length: PIECES }, (_, i) => ({
    x: ((i * 37) % 100) - 50, rot: (i * 53) % 360, delay: (i % 7) * 0.04, tone: PIECE_TONES[i % PIECE_TONES.length]!, drift: ((i * 17) % 40) - 20,
  })), []);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className={`absolute left-1/2 top-16 h-2 w-1.5 rounded-sm ${p.tone}`}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{ x: p.x * 3 + p.drift, y: [0, -60 - (i % 5) * 12, 140], opacity: [0, 1, 0], rotate: p.rot }}
          transition={{ duration: 1.4, delay: p.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

/** Presentational (tests): one big win. */
export function CeremonyView({ item, me, onClose }: { item: Item; me: QuestsMe; onClose: () => void }) {
  const { t } = questsI18n.useT();
  const reduce = useReducedMotion();
  const title = textOf(item.title, `ach.${item.id}.title`) ?? t("ach.fallback");
  return (
    <DialogContent className="max-w-sm overflow-hidden text-center">
      {!reduce && <Confetti />}
      <div className="relative flex flex-col items-center gap-3 pt-2">
        <motion.div
          initial={reduce ? false : { rotateY: 90, scale: 0.5 }}
          animate={{ rotateY: 0, scale: 1 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 14 }}
        >
          <Medal category={categoryOf(item.id, me)} tier={item.tier} size="lg" className="h-20 w-20" />
        </motion.div>
        <DialogTitle className="text-lg">{t("ceremony.title")}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-foreground">{title}</span>
            <span className={`text-sm font-medium ${TIER_TONE[item.tier].text}`}>{tierLabel(item.tier)} · {fmtDayMonth(item.date)}</span>
          </div>
        </DialogDescription>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button type="button" onClick={onClose}>{t("ceremony.close")}</Button>
          <Button type="button" variant="ghost" asChild><Link href={`/ratings?tab=quests&ach=${encodeURIComponent(item.id)}`} onClick={onClose}>{t("ceremony.more")}</Link></Button>
        </div>
      </div>
    </DialogContent>
  );
}

/** Shows the unseen big wins one by one (the setting achievements.ceremony off → the server sends none). */
export function AchievementCeremony({ me }: { me: QuestsMe }) {
  const seen = useMarkSeen();
  const [closed, setClosed] = React.useState<ReadonlySet<string>>(new Set());
  const queue = (me.celebrate ?? []).filter((c) => !closed.has(c.key));
  const current = queue[0] ?? null;
  const close = () => {
    if (!current) return;
    setClosed((s) => new Set([...s, current.key]));
    seen.mutate([current.key]);
  };
  return (
    <Dialog open={!!current} onOpenChange={(v) => { if (!v) close(); }}>
      {current && <CeremonyView item={current} me={me} onClose={close} />}
    </Dialog>
  );
}
