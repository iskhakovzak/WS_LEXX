/**
 * Admin → «Роли и права» → «Доступ по ступеням» (owner 2026-10-21: close sections — e.g. the top of the day — per ladder
 * stage, and choose which stages see other traders' names). Rows = the sections a trader can see, grouped as in the
 * sidebar (`groups`, built by the page from components/shell/nav-model blockableSections); columns Джун / Трейдер /
 * Сеньор with switches (on = open); one extra row «Видит имена других трейдеров». Edits stay a draft until «Сохранить»
 * (PUT /api/admin/settings: validated and audited server-side, settings.update). «Открыть всё» opens every section.
 * Staff are never restricted. Desktop: a table; phone: one card per section. Admin only (settings.manage).
 */
import { useMemo, useState } from "react";
import { Lock, Save, Undo2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { QueryError } from "@/components/query-error";
import { ListSkeleton, Panel, Pill } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { adminI18n } from "@/i18n/ns/admin";
import { commonI18n } from "@/i18n/ns/common";
import { useDeskSettings, useSaveDeskSettings } from "./desk-settings-api";
import type { StageKey } from "./desk-settings-model";
import {
  STAGES, accessChanges, closedCount, isOpen, openAll, readAccess, seesNames, setNames, setOpen, unknownClosed,
  type AccessDraft, type AccessGroup,
} from "./stage-access-model";

const stageLabel = (s: StageKey) => commonI18n.t(`tiers.${s}`);

/** One switch cell: on = open (sections) / sees names. */
function Cell({ label, stage, on, onChange }: { label: string; stage: StageKey; on: boolean; onChange: (v: boolean) => void }) {
  const { t } = adminI18n.useT();
  return (
    <Switch
      checked={on}
      onCheckedChange={onChange}
      aria-label={`${t("stageAccess.cellAria", { section: label, stage: stageLabel(stage) })}: ${on ? t("stageAccess.open") : t("stageAccess.closed")}`}
    />
  );
}

type Row = { key: string; label: string; child: boolean; on: (s: StageKey) => boolean; set: (s: StageKey, v: boolean) => void; hint?: string };

function DesktopTable({ blocks }: { blocks: { id: string; label: string; rows: Row[] }[] }) {
  const { t } = adminI18n.useT();
  return (
    <table className="hidden w-full text-sm md:table">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="py-2 pr-3 font-medium">{t("stageAccess.section")}</th>
          {STAGES.map((s) => <th key={s} scope="col" className="w-24 py-2 text-center font-medium">{stageLabel(s)}</th>)}
        </tr>
      </thead>
      {blocks.map((b) => (
        <tbody key={b.id}>
          <tr><th scope="rowgroup" colSpan={4} className="micro-label pb-1 pt-4 text-left">{b.label}</th></tr>
          {b.rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--glass-border)]">
              <th scope="row" className={cn("py-2 pr-3 text-left font-normal", r.child && "pl-5 text-muted-foreground")}>
                {r.label}
                {r.hint && <span className="block text-xs text-muted-foreground">{r.hint}</span>}
              </th>
              {STAGES.map((s) => (
                <td key={s} className="py-2 text-center"><Cell label={r.label} stage={s} on={r.on(s)} onChange={(v) => r.set(s, v)} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

function PhoneCards({ blocks }: { blocks: { id: string; label: string; rows: Row[] }[] }) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {blocks.map((b) => (
        <section key={b.id} aria-label={b.label} className="flex flex-col gap-2">
          <h3 className="micro-label">{b.label}</h3>
          {b.rows.map((r) => (
            <div key={r.key} className="rounded-xl bg-[var(--glass-bg)] p-3">
              <p className="text-sm font-medium">{r.label}</p>
              {r.hint && <p className="text-xs text-muted-foreground">{r.hint}</p>}
              <div className="mt-2 grid grid-cols-3 gap-2">
                {STAGES.map((s) => (
                  <label key={s} className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                    {stageLabel(s)}
                    <Cell label={r.label} stage={s} on={r.on(s)} onChange={(v) => r.set(s, v)} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function StageAccessPanel({ groups }: { groups: AccessGroup[] }) {
  const { t } = adminI18n.useT();
  const { toast } = useToast();
  const q = useDeskSettings(true);
  const save = useSaveDeskSettings();
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  const rows = useMemo(() => q.data?.settings ?? [], [q.data]);
  const d = draft ?? readAccess(rows);
  const changes = accessChanges(rows, d);

  if (q.isLoading) return <Panel title={t("stageAccess.title")} icon={Lock}><ListSkeleton rows={6} /></Panel>;
  if (q.isError || !q.data) return <QueryError error={q.error} title={t("stageAccess.loadFailed")} onRetry={() => q.refetch()} />;

  const edit = (next: AccessDraft) => setDraft(next);
  const blocks = [
    {
      id: "privacy", label: t("stageAccess.privacy"),
      rows: [{ key: "names", label: t("stageAccess.names"), hint: t("stageAccess.namesHint"), child: false, on: (s: StageKey) => seesNames(d, s), set: (s: StageKey, v: boolean) => edit(setNames(d, s, v)) }],
    },
    ...groups.map((g) => ({
      id: g.id, label: g.label,
      rows: g.sections.map((x): Row => ({ key: x.href, label: x.label, child: !!x.parent, on: (s) => isOpen(d, x.href, s), set: (s, v) => edit(setOpen(d, x.href, s, v)) })),
    })),
  ];
  const closed = closedCount(d);
  const stale = unknownClosed(d, groups);

  const submit = () => {
    if (!changes.length) return;
    save.mutate(changes, {
      onSuccess: () => { setDraft(null); toast({ title: t("stageAccess.saved"), duration: 2500 }); },
      onError: (err) => toast({ title: t("stageAccess.loadFailed"), description: humanizeApiError(err), variant: "destructive" }),
    });
  };

  return (
    <Panel
      title={t("stageAccess.title")}
      icon={Lock}
      description={t("stageAccess.description")}
      actions={<Pill tone={closed ? "warn" : "neutral"}>{closed ? t("stageAccess.closedCount", { count: closed }) : t("stageAccess.allOpen")}</Pill>}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={submit} disabled={!changes.length || save.isPending}>
            <Save aria-hidden="true" />{t("stageAccess.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={!draft || save.isPending}>
            <Undo2 aria-hidden="true" />{t("stageAccess.undo")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => edit(openAll(d))} disabled={!closed || save.isPending} title={t("stageAccess.openAllHint")}>
            <Unlock aria-hidden="true" />{t("stageAccess.openAll")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("stageAccess.staffNote")}</span>
        </div>
      }
    >
      <DesktopTable blocks={blocks} />
      <PhoneCards blocks={blocks} />
      {stale.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{t("stageAccess.unknown", { list: stale.join(", ") })}</p>}
    </Panel>
  );
}
