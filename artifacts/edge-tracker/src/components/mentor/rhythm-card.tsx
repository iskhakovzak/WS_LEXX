/**
 * «Ритм дня» on /coach: the brief before the session (with the 30-second check-in), the debrief after it, the weekly
 * review. A digest is generated on demand: the page's default tab is prepared once when it is missing (one model call),
 * the others on a button; a digest whose inputs changed shows «Обновить» instead of regenerating by itself.
 */
import * as React from "react";
import { Link } from "wouter";
import { CalendarCheck2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Panel, Pill, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { mentorI18n } from "@/i18n/ns/mentor";
import { useRhythm, type BriefContent, type DebriefContent, type Digest, type MentorState, type RhythmKind, type WeeklyContent } from "./api";
import { CheckinStrip } from "./checkin";

const KINDS: readonly RhythmKind[] = ["brief", "debrief", "weekly"];

function Block({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "accent" }) {
  return (
    <div className={tone === "accent" ? "rounded-xl border border-primary/30 bg-primary/5 px-3 py-2" : ""}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm text-foreground">{children}</div>
    </div>
  );
}

function BriefView({ d }: { d: BriefContent }) {
  const { t } = mentorI18n.useT();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold text-foreground">{d.headline}</p>
      {d.points.length > 0 && <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">{d.points.map((p) => <li key={p}>{p}</li>)}</ul>}
      <Block label={t("rhythm.ruleToday")} tone="accent">{d.ruleToday}</Block>
      {d.setups.length > 0 && (
        <Block label={t("rhythm.setups")}>
          <span className="flex flex-wrap gap-1.5">
            {d.setups.map((s) => <Link key={s.id} href={`/playbook?id=${s.id}`} className="rounded-lg border border-border px-2 py-0.5 text-xs hover:bg-[var(--glass-hover-bg)]">{s.name}</Link>)}
          </span>
        </Block>
      )}
    </div>
  );
}

function DebriefView({ d }: { d: DebriefContent }) {
  const { t } = mentorI18n.useT();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">{d.summary}</p>
      <Block label={t("rhythm.vsPlan")}>{d.vsPlan}</Block>
      <Block label={t("rhythm.lesson")}>{d.lesson}</Block>
      {d.praise && <Block label={t("rhythm.praise")}>{d.praise}</Block>}
      {d.challenge && <Block label={t("rhythm.challenge")}>{d.challenge}</Block>}
      {d.ruleTomorrow && (
        <Block label={t("rhythm.ruleTomorrow")} tone="accent">
          {d.ruleTomorrow.text}
          <span className="mt-1 block text-xs text-muted-foreground">{d.savedCommitmentId ? t("rhythm.ruleSaved") : d.ruleSkipped === "full" ? t("rhythm.ruleFull") : null}</span>
        </Block>
      )}
    </div>
  );
}

function WeeklyView({ d }: { d: WeeklyContent }) {
  const { t } = mentorI18n.useT();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">{d.summary}</p>
      {d.commitments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {d.commitments.map((c) => (
            <li key={c.id} className="tile flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
              <Pill tone={c.verdict === "close_achieved" ? "up" : c.verdict === "drop" ? "warn" : "neutral"}>{t(`rhythm.weeklyVerdict.${c.verdict}`)}</Pill>
              <span className="min-w-0 flex-1">{c.note}</span>
            </li>
          ))}
        </ul>
      )}
      <Block label={t("rhythm.nextFocus")} tone="accent">{d.nextFocus}</Block>
    </div>
  );
}

function DigestBody({ kind, digest }: { kind: RhythmKind; digest: Digest }) {
  if (kind === "brief") return <BriefView d={digest.content as BriefContent} />;
  if (kind === "debrief") return <DebriefView d={digest.content as DebriefContent} />;
  return <WeeklyView d={digest.content as WeeklyContent} />;
}

export function RhythmCard({ state, initial }: { state: MentorState; initial: RhythmKind }) {
  const { t } = mentorI18n.useT();
  const [tab, setTab] = React.useState<RhythmKind>(initial);
  const gen = useRhythm();
  const digest = state.digests[tab] as Digest | null;
  const can = state.status.allowed;
  const auto = React.useRef(false);

  // Opening the mentor prepares the leading digest once (on demand: never on a schedule, never twice per open).
  React.useEffect(() => {
    if (auto.current || !can || state.digests[initial]) return;
    auto.current = true;
    gen.mutate({ kind: initial });
  }, [can, initial, state.digests, gen]);

  const run = (force: boolean) => gen.mutate({ kind: tab, force });
  const busy = gen.isPending && gen.variables?.kind === tab;
  return (
    <Panel
      title={t("rhythm.title")}
      icon={CalendarCheck2}
      actions={<Segmented size="sm" ariaLabel={t("rhythm.title")} value={tab} onChange={(v) => setTab(v)} options={KINDS.map((k) => ({ value: k, label: t(`rhythm.tabs.${k}`) }))} />}
    >
      <div className="flex flex-col gap-4">
        {tab === "brief" && <CheckinStrip state={state} onSaved={() => { if (can && state.digests.brief) gen.mutate({ kind: "brief", force: true }); }} />}
        {busy ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("rhythm.generating")}</p>
        ) : digest ? (
          <>
            <DigestBody kind={tab} digest={digest} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {digest.source === "batch" && <span>{t("rhythm.prepared")}</span>}
              {digest.stale && can && (
                <Button size="sm" variant="ghost" onClick={() => run(true)}><RefreshCw aria-hidden="true" />{t("rhythm.refresh")}</Button>
              )}
              {digest.stale && <span>{t("rhythm.stale")}</span>}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">{t(`rhythm.empty.${tab}`)}</p>
            {can && <Button size="sm" onClick={() => run(false)}><Sparkles aria-hidden="true" />{t(`rhythm.generate.${tab}`)}</Button>}
          </div>
        )}
        {gen.isError && gen.variables?.kind === tab && <p className="text-sm text-destructive" role="alert">{t("rhythm.failed")}</p>}
      </div>
    </Panel>
  );
}
