import * as React from "react";
import { Award, Check, ChevronDown, Plus, Swords, X } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtDayMonth } from "@/lib/format";
import { personName } from "@/i18n";
import { questsI18n } from "@/i18n/ns/quests";
import type { Quest, QuestsMe } from "@/lib/quests/types";
import { MANUAL_TEMPLATE, useCancelQuest, useCompleteQuest, useTraderQuests } from "./api";
import { AssignQuestDialog } from "./assign-dialog";
import { achievementTitle, earnedTiers, questTitle, tierLabel } from "./model";
import { Medal } from "./medal";
import { QuestsBoard } from "./quests-board";
import { AchievementsGrid } from "./achievements-grid";
import { KudosDialog } from "./kudos-dialog";
import { useKudos } from "./api";

/** Totals + earned medals in one line (highest tier colour; the title says the tier and date). */
function Summary({ data }: { data: QuestsMe }) {
  const { t } = questsI18n.useT();
  const s = data.summary;
  const earned = data.achievements.filter((a) => a.tier);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {s.onboarding && s.onboarding.done < s.onboarding.total && <Pill tone="purple">{t("header.onboarding", { done: s.onboarding.done, total: s.onboarding.total })}</Pill>}
        {s.weekTotal > 0 && <Pill tone="accent">{t("header.weekDone", { done: s.weekDone, total: s.weekTotal })}</Pill>}
        <Pill tone="neutral">{t("header.achievements", { earned: s.achievementsEarned, total: s.achievementsTotal })}</Pill>
      </div>
      {earned.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("achievements.title")}>
          {earned.map((a) => {
            const top = earnedTiers(a)[0];
            const label = top?.earnedAt ? `${achievementTitle(a)} — ${t("achievements.earnedOn", { tier: tierLabel(top.tier), date: fmtDayMonth(top.earnedAt) })}` : achievementTitle(a);
            return (
              <li key={a.id} title={label}>
                <span className="sr-only">{label}</span>
                <Medal category={a.category} tier={a.tier} size="sm" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The trader's kudos from curators (newest first, up to 5). */
function KudosList({ trader }: { trader: string }) {
  const { t } = questsI18n.useT();
  const q = useKudos(trader);
  const list = q.data?.kudos ?? [];
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="micro-label">{t("kudos.list")}</span>
      <ul className="flex flex-col gap-0.5">
        {list.slice(0, 5).map((k) => (
          <li key={k.id} className="flex min-w-0 items-baseline gap-2 text-xs">
            <Award className="h-3.5 w-3.5 shrink-0 self-center text-medal-gold" aria-hidden="true" />
            <span className="shrink-0 text-muted-foreground">{t("kudos.by", { curator: personName(k.author), date: fmtDayMonth(k.day) })}</span>
            {k.note && <span className="min-w-0 truncate text-foreground" title={k.note}>{k.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every achievement of the trader (folded by default: the cabinet leads with today's work). */
function AllAchievements({ data }: { data: QuestsMe }) {
  const { t } = questsI18n.useT();
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex min-h-8 items-center gap-1 self-start rounded-lg px-1 text-xs font-medium text-primary hover:underline">
        {t("profile.all")}
        <ChevronDown className={open ? "h-3.5 w-3.5 rotate-180" : "h-3.5 w-3.5"} aria-hidden="true" />
      </button>
      {open && <AchievementsGrid list={data.achievements} />}
    </div>
  );
}

/** Presentational (tests): the trader's quests (curator quests cancellable) and achievements summary. */
export function CuratorQuestsView({ data, onGive, onCancel, onComplete, onKudos, trader }: { data: QuestsMe; onGive: () => void; onCancel: (q: Quest) => void; onComplete: (q: Quest) => void; onKudos?: () => void; trader?: string }) {
  const { t } = questsI18n.useT();
  return (
    <Panel
      title={t("curator.title")}
      icon={Swords}
      actions={
        <span className="flex flex-wrap items-center gap-1.5">
          {onKudos && <Button type="button" size="sm" variant="outline" onClick={onKudos}><Award className="h-3.5 w-3.5" /> {t("kudos.give")}</Button>}
          <Button type="button" size="sm" onClick={onGive}><Plus className="h-3.5 w-3.5" /> {t("curator.give")}</Button>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <Summary data={data} />
        {trader && <KudosList trader={trader} />}
        <AllAchievements data={data} />
        <QuestsBoard
          quests={data.quests}
          today={data.today}
          emptyHint={t("curator.none")}
          links={false}
          action={(q) => q.scope === "curator" && q.status === "active" ? (
            <span className="flex shrink-0 items-center gap-1">
              {q.template === MANUAL_TEMPLATE && (
                <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onComplete(q)} aria-label={t("curator.completeAria", { title: questTitle(q) })}>
                  <Check className="h-3.5 w-3.5" /> {t("curator.complete")}
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => onCancel(q)} aria-label={t("curator.cancelAria", { title: questTitle(q) })}>
                <X className="h-3.5 w-3.5" /> {t("curator.cancel")}
              </Button>
            </span>
          ) : null}
        />
      </div>
    </Panel>
  );
}

/** Curator profile block (passed in by the curator page): quests + achievements, «Дать квест», cancel. */
export function CuratorQuestsPanel({ trader }: { trader: string }) {
  const { t } = questsI18n.useT();
  const { toast } = useToast();
  const q = useTraderQuests(trader);
  const [giving, setGiving] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<Quest | null>(null);
  const [completing, setCompleting] = React.useState<Quest | null>(null);
  const [kudos, setKudos] = React.useState(false);
  const cancel = useCancelQuest();
  const complete = useCompleteQuest();
  // Both confirmations close at once; the result arrives as a toast and the lists refetch in the background.
  const markDone = () => {
    if (!completing) return;
    complete.mutate(completing.id, {
      onSuccess: () => toast({ title: t("curator.completed") }),
      onError: (e) => toast({ title: t("curator.completeFailed"), description: humanizeApiError(e), variant: "destructive" }),
    });
    setCompleting(null);
  };
  if (q.isLoading) return <div className="glass-panel h-40 rounded-2xl" aria-hidden="true" />;
  if (!q.data) {
    return (
      <Panel title={t("curator.title")} icon={Swords}>
        <p className="text-sm text-muted-foreground">{q.isError ? t("curator.loadFailed") : t("curator.notConnected")}</p>
      </Panel>
    );
  }
  const confirm = () => {
    if (!cancelling) return;
    cancel.mutate(cancelling.id, {
      onSuccess: () => toast({ title: t("curator.cancelled") }),
      onError: (e) => toast({ title: t("curator.cancelFailed"), description: humanizeApiError(e), variant: "destructive" }),
    });
    setCancelling(null);
  };
  return (
    <>
      <CuratorQuestsView data={q.data} trader={trader} onGive={() => setGiving(true)} onCancel={setCancelling} onComplete={setCompleting} onKudos={() => setKudos(true)} />
      <KudosDialog open={kudos} onOpenChange={setKudos} trader={trader} />
      <AssignQuestDialog open={giving} onOpenChange={setGiving} trader={trader} today={q.data.today} />
      <AlertDialog open={!!cancelling} onOpenChange={(v) => { if (!v) setCancelling(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("curator.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{cancelling ? t("curator.cancelText", { title: questTitle(cancelling), name: personName(trader) }) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("curator.keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirm(); }} className="bg-down text-primary-foreground hover:bg-down/90">
              {t("curator.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!completing} onOpenChange={(v) => { if (!v) setCompleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("curator.completeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{completing ? t("curator.completeText", { title: questTitle(completing), name: personName(trader), points: completing.rewardPoints }) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("curator.keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); markDone(); }}>
              {t("curator.complete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
