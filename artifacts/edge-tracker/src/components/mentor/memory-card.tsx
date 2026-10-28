/**
 * «Что ментор знает обо мне»: the data facts from the journal (each can be hidden from the mentor), the memory notes
 * (the mentor's, the trader's own — editable) and the curator's guidance (read-only for the trader). The curator's
 * panel shows the same card with `curator` set: notes read-only, guidance editable.
 */
import * as React from "react";
import { Brain, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/format";
import { personName } from "@/i18n";
import { mentorI18n } from "@/i18n/ns/mentor";
import { useAddNote, useDeleteNote, useSetHidden, useUpdateNote, type Fact, type Note } from "./api";
import { factText } from "./model";

function NoteRow({ n, editable }: { n: Note; editable: boolean }) {
  const { t } = mentorI18n.useT();
  const update = useUpdateNote();
  const del = useDeleteNote();
  const [edit, setEdit] = React.useState(false);
  const [body, setBody] = React.useState(n.body);
  if (edit) {
    return (
      <li className="tile flex flex-col gap-2 px-3 py-2">
        <Textarea value={body} maxLength={400} rows={2} onChange={(e) => setBody(e.target.value)} aria-label={t("memory.edit")} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setBody(n.body); setEdit(false); }}>{t("memory.cancel")}</Button>
          <Button size="sm" disabled={!body.trim() || update.isPending} onClick={() => update.mutate({ id: n.id, body: body.trim() }, { onSuccess: () => setEdit(false) })}>{t("memory.save")}</Button>
        </div>
      </li>
    );
  }
  const who = n.source === "curator" ? personName(n.author) : t(`memory.source.${n.source}`);
  return (
    <li className="group flex items-start gap-2 text-sm">
      <Pill tone={n.kind === "guidance" ? "accent" : "neutral"} className="mt-0.5 shrink-0">{t(`memory.kind.${n.kind}`)}</Pill>
      <span className="min-w-0 flex-1 text-foreground">
        {n.body}
        <span className="ml-1.5 text-xs text-muted-foreground">· {who} · {fmtDate(n.updatedAt, "dayMonth")}</span>
      </span>
      {editable && (
        <span className="flex shrink-0 gap-0.5">
          <Button size="sm" variant="ghost" aria-label={t("memory.edit")} onClick={() => setEdit(true)}><Pencil aria-hidden="true" /></Button>
          <Button size="sm" variant="ghost" aria-label={t("memory.delete")} disabled={del.isPending} onClick={() => del.mutate(n.id)}><PendingIcon pending={del.isPending && del.variables === n.id} icon={Trash2} /></Button>
        </span>
      )}
    </li>
  );
}

function AddNote({ trader, guidance }: { trader?: string; guidance: boolean }) {
  const { t } = mentorI18n.useT();
  const add = useAddNote();
  const [open, setOpen] = React.useState(guidance);
  const [body, setBody] = React.useState("");
  if (!open) return <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpen(true)}><Plus aria-hidden="true" />{t("memory.add")}</Button>;
  const submit = () => add.mutate({ kind: guidance ? "guidance" : "goal", body: body.trim(), trader }, { onSuccess: () => { setBody(""); setOpen(guidance); } });
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={body} maxLength={400} rows={2} onChange={(e) => setBody(e.target.value)} placeholder={guidance ? t("curator.guidancePlaceholder") : t("memory.placeholder")} aria-label={guidance ? t("curator.guidance") : t("memory.add")} />
      <div className="flex justify-end gap-2">
        {!guidance && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("memory.cancel")}</Button>}
        <Button size="sm" disabled={!body.trim() || add.isPending} onClick={submit}>{guidance ? t("curator.send") : t("memory.save")}</Button>
      </div>
    </div>
  );
}

export function MemoryCard({ facts, notes, curator, trader }: { facts: Fact[]; notes: Note[]; curator?: boolean; trader?: string }) {
  const { t } = mentorI18n.useT();
  const hide = useSetHidden();
  const own = notes.filter((n) => n.kind !== "guidance");
  const guidance = notes.filter((n) => n.kind === "guidance");
  const toggle = (f: Fact) => {
    const hidden = facts.filter((x) => x.hidden).map((x) => x.key);
    hide.mutate(f.hidden ? hidden.filter((k) => k !== f.key) : [...hidden, f.key]);
  };
  return (
    <Panel title={curator ? t("curator.title") : t("memory.title")} icon={Brain} description={curator ? t("curator.description") : t("memory.description")}>
      <div className="flex flex-col gap-4">
        {facts.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">{t("memory.facts")}</h3>
            <ul className="flex flex-col gap-1">
              {facts.map((f) => (
                <li key={f.key} className={`flex items-center gap-2 text-sm ${f.hidden ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  <span className="min-w-0 flex-1">{factText(f)}</span>
                  {!curator && (
                    <Button size="sm" variant="ghost" aria-label={f.hidden ? t("memory.show") : t("memory.hide")} title={f.hidden ? t("memory.show") : t("memory.hide")} disabled={hide.isPending} onClick={() => toggle(f)}>
                      {f.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{t("memory.notes")}</h3>
          {own.length ? <ul className="flex flex-col gap-1.5">{own.map((n) => <NoteRow key={n.id} n={n} editable={!curator} />)}</ul> : <p className="text-sm text-muted-foreground">{curator ? t("curator.noNotes") : t("memory.empty")}</p>}
          {!curator && <AddNote guidance={false} />}
        </section>
        {(guidance.length > 0 || curator) && (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">{t("memory.guidance")}</h3>
            {guidance.length > 0 && <ul className="flex flex-col gap-1.5">{guidance.map((n) => <NoteRow key={n.id} n={n} editable={!!curator} />)}</ul>}
            {curator && <AddNote trader={trader} guidance />}
          </section>
        )}
      </div>
    </Panel>
  );
}
