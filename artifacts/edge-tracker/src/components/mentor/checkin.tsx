/**
 * The 30-second check-in before the session: six state chips and an optional focus line. It is the journal's own
 * check-in (one per NY day, also on the dashboard), so the mentor, the psychology report and the dashboard agree.
 * Saving refreshes the brief when one exists, so the rule for today accounts for the state.
 */
import * as React from "react";
import { HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mentorI18n } from "@/i18n/ns/mentor";
import { useSaveCheckin, type Checkin, type MentorState } from "./api";

const FLAGS = ["sleepWell", "focused", "stressed", "anxious", "tilted", "revenge"] as const;
type Flag = (typeof FLAGS)[number];
const EMPTY: Checkin = { sleepWell: false, focused: false, stressed: false, anxious: false, tilted: false, revenge: false, note: null };

export function CheckinStrip({ state, onSaved }: { state: MentorState; onSaved: () => void }) {
  const { t } = mentorI18n.useT();
  const save = useSaveCheckin(state.today);
  const [editing, setEditing] = React.useState(!state.checkin);
  const [draft, setDraft] = React.useState<Checkin>(state.checkin ?? EMPTY);
  if (!state.self) return null;

  if (!editing && state.checkin) {
    const on = FLAGS.filter((f) => state.checkin![f]);
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <HeartPulse className="h-4 w-4" aria-hidden="true" />
        <span>{t("checkin.done")}{on.length ? `: ${on.map((f) => t(`checkin.flags.${f}`)).join(", ")}` : ""}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{t("checkin.edit")}</Button>
      </div>
    );
  }

  const toggle = (f: Flag) => setDraft((d) => ({ ...d, [f]: !d[f] }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ ...draft, note: draft.note?.trim() || null }, { onSuccess: () => { setEditing(false); onSaved(); } });
  };
  return (
    <form onSubmit={submit} className="tile flex flex-col gap-2 px-3 py-2.5" aria-label={t("checkin.title")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{t("checkin.title")}</p>
        <p className="text-xs text-muted-foreground">{t("checkin.hint")}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("checkin.title")}>
        {FLAGS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={draft[f]}
            onClick={() => toggle(f)}
            className={`min-h-8 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${draft[f] ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-[var(--glass-hover-bg)]"}`}
          >
            {t(`checkin.flags.${f}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1"
          value={draft.note ?? ""}
          maxLength={200}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          placeholder={t("checkin.note")}
          aria-label={t("checkin.note")}
        />
        <Button type="submit" size="sm" disabled={save.isPending}>{t("checkin.save")}</Button>
      </div>
      {save.isError && <p className="text-xs text-destructive" role="alert">{t("checkin.failed")}</p>}
    </form>
  );
}
