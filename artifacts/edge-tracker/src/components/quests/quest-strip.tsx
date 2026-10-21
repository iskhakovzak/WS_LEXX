import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown, Footprints, PartyPopper, Swords, X } from "lucide-react";
import { MOTION } from "@/components/ds";
import { cn } from "@/lib/utils";
import { questsI18n } from "@/i18n/ns/quests";
import type { Quest, QuestsMe } from "@/lib/quests/types";
import { useQuestsMe } from "./api";
import { SCOPE_ORDER, freshlyDone, isOptionalStep, questTitle, stripView, type StripView } from "./model";
import { QuestRow, QuestStatusIcon, useIsHere } from "./quest-row";

export const PROGRESS_HREF = "/ratings?tab=quests";
const SEEN_KEY = "quests.seenDone";

function readSeen(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)));
  } catch { /* storage unavailable */ }
}

/** A quest finished since the last visit: one short line with a pop, shown once (instant under reduced motion). */
function Celebration({ quest, onDone }: { quest: Quest; onDone: () => void }) {
  const { t } = questsI18n.useT();
  const reduce = useReducedMotion();
  useEffect(() => {
    const id = window.setTimeout(onDone, 6000);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <motion.div
      role="status"
      initial={reduce ? false : { opacity: 0, scale: 0.92, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 22 }}
      className="flex min-w-0 max-w-full items-center gap-2 self-start rounded-xl bg-up/10 px-2.5 py-1.5 text-sm text-foreground"
    >
      <motion.span
        aria-hidden="true"
        initial={reduce ? false : { rotate: -25, scale: 0.6 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 12, delay: 0.08 }}
        className="text-up"
      >
        <PartyPopper className="h-4 w-4" />
      </motion.span>
      <span className="min-w-0 truncate font-medium">{t("strip.celebrate", { title: questTitle(quest) })}</span>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-up">{t("row.reward", { points: quest.rewardPoints })}</span>
      <button type="button" onClick={onDone} aria-label={t("strip.close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </motion.div>
  );
}

/** Celebrate each newly finished quest once; ids are remembered per browser. Client-only (effects). */
function useCelebration(me: QuestsMe) {
  const [queue, setQueue] = useState<Quest[]>([]);
  useEffect(() => {
    const seen = readSeen();
    const fresh = freshlyDone(me.quests, me.today, seen);
    if (!fresh.length) return;
    for (const q of fresh) seen.add(q.id);
    writeSeen(seen);
    setQueue((prev) => [...prev, ...fresh.filter((q) => !prev.some((p) => p.id === q.id))]);
  }, [me]);
  return { current: queue[0] ?? null, next: () => setQueue((prev) => prev.slice(1)) };
}

function StripPanel({ id, view, today }: { id: string; view: StripView; today: string }) {
  const { t } = questsI18n.useT();
  const isHere = useIsHere();
  return (
    <div id={id} className="flex w-full min-w-0 flex-col gap-2 rounded-xl bg-foreground/[0.04] p-3 lg:w-[28rem]">
      {view.kind === "onboarding" && (
        <ol className="flex flex-col gap-1" aria-label={t("scope.onboarding")}>
          {view.steps.map((q) => (
            <li key={q.id} className="flex min-w-0 items-center gap-2 text-sm">
              <QuestStatusIcon q={q} />
              <span className={cn("min-w-0 flex-1 truncate", q.status === "done" ? "text-muted-foreground line-through decoration-muted-foreground/50" : "text-foreground", q.id === view.next?.id && "font-medium")}>
                {questTitle(q)}
                {isOptionalStep(q) && <span className="ml-1.5 text-2xs font-normal text-muted-foreground">{t("strip.optional")}</span>}
              </span>
              {q.id === view.next?.id && q.href && !isHere(q.href) && (
                <Link href={q.href} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("row.go")}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
      {/* Grouped by scope («На сегодня», «От куратора»…): a curator quest with a Friday deadline is not «today». */}
      {SCOPE_ORDER.map((scope, _i, all) => {
        const first = all.find((s) => view.today.some((q) => q.scope === s));
        const list = view.today.filter((q) => q.scope === scope);
        if (!list.length) return null;
        const labelled = view.kind === "onboarding" || view.today.some((q) => q.scope !== scope);
        return (
          <div key={scope} className={cn("flex flex-col", (view.kind === "onboarding" || scope !== first) && "border-t border-[var(--glass-border)] pt-2")}>
            {labelled && <span className="micro-label">{t(`scope.${scope}`)}</span>}
            <ul className="flex flex-col divide-y divide-[var(--glass-border)]">
              {list.map((q) => <QuestRow key={q.id} q={q} today={today} compact />)}
            </ul>
          </div>
        );
      })}
      {view.kind === "today" && view.done === view.total && <p className="text-xs text-up">{t("strip.allDone")}</p>}
      <Link href={PROGRESS_HREF} className="inline-flex min-h-8 items-center gap-1 self-start rounded-lg px-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("strip.all")}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * The quest line inside the dashboard day row: «Квесты 1/3» (today's quests) or «Первые шаги 3/7 · Дальше: …» for a
 * new trader; the list opens in place. A quest finished since the last visit gets a short celebration.
 */
export function QuestStripView({ me, defaultOpen = false }: { me: QuestsMe; defaultOpen?: boolean }) {
  const { t } = questsI18n.useT();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const party = useCelebration(me);
  const view = stripView(me);
  if (!view && !party.current) return null;
  const Icon = view?.kind === "onboarding" ? Footprints : Swords;
  const allDone = !!view && view.done === view.total;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <AnimatePresence initial={false}>
        {party.current && <Celebration key={party.current.id} quest={party.current} onDone={party.next} />}
      </AnimatePresence>
      {view && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t("strip.openAria")}
          className="group inline-flex min-h-8 min-w-0 max-w-full items-center gap-1.5 self-start rounded-lg px-1.5 text-sm font-medium transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className={cn("h-4 w-4 shrink-0", allDone ? "text-up" : "text-primary")} aria-hidden="true" />
          <span className="shrink-0 tabular-nums">
            {view.kind === "onboarding" ? t("strip.onboarding", { done: view.done, total: view.total }) : t("strip.quests", { done: view.done, total: view.total })}
          </span>
          {view.kind === "onboarding" && view.next && (
            <span className="min-w-0 truncate font-normal text-muted-foreground">· {t("strip.next", { title: questTitle(view.next) })}</span>
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && view && (
          <motion.div key="panel" initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={MOTION.fast}>
            <StripPanel id={panelId} view={view} today={me.today} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Dashboard slot (passed into the day line by the page): the viewer's quests; nothing for a role without them. */
export function QuestStrip({ enabled }: { enabled: boolean }) {
  const q = useQuestsMe(enabled);
  if (!enabled || !q.data) return null;
  return <QuestStripView me={q.data} />;
}
