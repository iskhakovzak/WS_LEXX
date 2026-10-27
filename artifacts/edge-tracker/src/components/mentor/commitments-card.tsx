/**
 * «Обязательства»: 1–3 measurable commitments with their score from the trades («7 из 9 после убытков»), the verdict,
 * close / drop, and a short add form (kind → its one parameter → the trader's own words). Used on /coach (own) and in
 * the curator's panel (`trader` set: the curator adds and closes for the trader).
 */
import * as React from "react";
import { Check, Plus, Target, X } from "lucide-react";
import { EmptyState, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import { mentorI18n } from "@/i18n/ns/mentor";
import { COMMITMENT_KINDS, useAddCommitment, useCloseCommitment, type Commitment, type CommitmentKind, type CommitmentView } from "./api";
import { KIND_FIELDS, commitmentText, kindLabel, verdictTone } from "./model";

const MAX_ACTIVE = 3;

function Row({ c, canEdit }: { c: CommitmentView; canEdit: boolean }) {
  const { t } = mentorI18n.useT();
  const close = useCloseCommitment();
  const p = c.progress;
  const pct = p.rate == null ? 0 : Math.round(p.rate * 100);
  return (
    <li className="tile flex flex-col gap-1.5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{commitmentText(c)}</span>
        <Pill tone={verdictTone(c.verdict)}>{t(`commitments.verdict.${c.verdict}`)}</Pill>
      </div>
      {p.tracked && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {p.opportunities ? `${t("commitments.kept", { kept: p.kept, total: p.opportunities })} ${p.unit ? t(`commitments.unit.${p.unit}`) : ""}` : t("commitments.noData")}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{t(`commitments.source.${c.source}`)} · {t("commitments.since", { date: fmtDate(c.startedOn, "dayMonth") })}</span>
        {canEdit && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" disabled={close.isPending} onClick={() => close.mutate({ id: c.id, status: "achieved" })}><Check aria-hidden="true" />{t("commitments.close.achieved")}</Button>
            <Button size="sm" variant="ghost" disabled={close.isPending} onClick={() => close.mutate({ id: c.id, status: "dropped" })}><X aria-hidden="true" />{t("commitments.close.dropped")}</Button>
          </span>
        )}
      </div>
    </li>
  );
}

function AddForm({ trader, onDone }: { trader?: string; onDone: () => void }) {
  const { t } = mentorI18n.useT();
  const add = useAddCommitment();
  const [kind, setKind] = React.useState<CommitmentKind>("pause_after_loss");
  const [value, setValue] = React.useState("");
  const [text, setText] = React.useState("");
  const field = KIND_FIELDS[kind];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    const body = { kind, text: text.trim() || commitmentText({ kind, params: field ? { [field]: field === "time" ? value : n } : {}, text: null }), trader,
      minutes: field === "minutes" ? n : null, count: field === "count" ? n : null, usd: field === "usd" ? n : null, time: field === "time" ? value : null };
    add.mutate(body, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="tile flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {t("commitments.form.kind")}
          <select value={kind} onChange={(e) => { setKind(e.target.value as CommitmentKind); setValue(""); }} className="glass-field min-h-9 rounded-lg px-2 text-sm text-foreground">
            {COMMITMENT_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
        </label>
        {field && (
          <label className="flex w-32 flex-col gap-1 text-xs text-muted-foreground">
            {t(`commitments.form.${field}`)}
            <Input required type={field === "time" ? "time" : "number"} min={field === "time" ? undefined : 1} step={field === "usd" ? "any" : 1} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("commitments.form.text")}
        <Input required={!field} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t("commitments.form.cancel")}</Button>
        <Button type="submit" size="sm" disabled={add.isPending}>{t("commitments.form.save")}</Button>
      </div>
      {add.isError && <p className="text-xs text-destructive" role="alert">{t("commitments.form.failed")}</p>}
    </form>
  );
}

export function CommitmentsCard({ active, closed, canEdit, trader }: { active: CommitmentView[]; closed: Commitment[]; canEdit: boolean; trader?: string }) {
  const { t } = mentorI18n.useT();
  const [adding, setAdding] = React.useState(false);
  const full = active.length >= MAX_ACTIVE;
  return (
    <Panel
      title={t("commitments.title")}
      icon={Target}
      description={t("commitments.description")}
      actions={canEdit && !adding ? <Button size="sm" variant="outline" disabled={full} title={full ? t("commitments.full") : undefined} onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t("commitments.add")}</Button> : null}
    >
      <div className="flex flex-col gap-2">
        {adding && <AddForm trader={trader} onDone={() => setAdding(false)} />}
        {active.length ? (
          <ul className="flex flex-col gap-2">{active.map((c) => <Row key={c.id} c={c} canEdit={canEdit} />)}</ul>
        ) : !adding ? (
          <EmptyState compact icon={Target} title={t("commitments.empty")} />
        ) : null}
        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">{t("commitments.closed")}</summary>
            <ul className="mt-1.5 flex flex-col gap-1">
              {closed.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span className="text-foreground">{commitmentText(c)}</span>
                  <span>{t(`commitments.status.${c.status}`)}{c.closedOn ? ` · ${fmtDate(c.closedOn, "dayMonth")}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}
