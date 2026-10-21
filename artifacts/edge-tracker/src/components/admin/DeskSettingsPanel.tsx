/**
 * Admin console → «Настройки деска» (owner 2026-10-18: «легко настраивать, всё на сайте»). The form is built from the
 * server registry (GET /api/admin/settings → lib/settings/registry.ts): one section per group, one row per key
 * (DeskSettingField). Edits stay a draft until the one «Сохранить» (PUT, the whole batch; SETTINGS_INVALID problems land
 * next to their fields); a value equal to the default is sent as «по умолчанию» (null). Admins only (settings.manage).
 * By default only the ~10 pilot settings (registry flag `pilot`, PILOT.md) are shown; «Показать все (N)» opens the rest
 * (remembered per browser). Rows with unsaved edits or server problems stay visible either way.
 */
import { useMemo, useState } from "react";
import { Save, SlidersHorizontal, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/query-error";
import { EmptyState, ListSkeleton, Panel, usePersistentState } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isApiError } from "@/lib/api/http";
import { humanizeApiError } from "@/lib/api/errors";
import { deskSettingsI18n } from "@/i18n/ns/deskSettings";
import { useDeskSettings, useSaveDeskSettings } from "./desk-settings-api";
import { DeskSettingField } from "./DeskSettingField";
import {
  changesOf, checkValue, groupRows, normalize, parseInput, pilotRowsOf, shownProblem, visibleRows, type Problem, type SettingRow, type SettingValue,
} from "./desk-settings-model";
import { settingLabel } from "./desk-settings-text";

const fieldId = (key: string) => `desk-setting-${key.replace(/[^a-z0-9]/gi, "-")}`;
const groupId = (group: string) => `desk-settings-group-${group}`;

/** Scroll a group / field into view and focus the field (sticky menu + pilot shortcuts, OWNER-12). */
function jumpTo(id: string, focus = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: focus ? "center" : "start" });
  if (focus) (el as HTMLElement).focus?.({ preventScroll: true });
}

export function DeskSettingsPanel({ canManage }: { canManage: boolean }) {
  const { t } = deskSettingsI18n.useT();
  const q = useDeskSettings(canManage);
  if (!canManage) return <EmptyState icon={SlidersHorizontal} title={t("title")} description={t("denied")} className="py-16" />;
  if (q.isLoading) return <Panel title={t("title")} icon={SlidersHorizontal}><ListSkeleton rows={6} /></Panel>;
  if (q.isError || !q.data) return <QueryError error={q.error} title={t("loadFailed")} onRetry={() => q.refetch()} />;
  return <SettingsForm rows={q.data.settings} />;
}

function SettingsForm({ rows }: { rows: SettingRow[] }) {
  const { t } = deskSettingsI18n.useT();
  const { toast } = useToast();
  const save = useSaveDeskSettings();
  const [draft, setDraft] = useState<Record<string, SettingValue | null>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [serverProblems, setServerProblems] = useState<Record<string, Problem>>({});

  const [showAll, setShowAll] = usePersistentState<boolean>("admin.settings.showAll", false);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const pilotRows = useMemo(() => pilotRowsOf(rows), [rows]);
  const changes = useMemo(() => changesOf(rows, draft), [rows, draft]);

  const shown = (r: SettingRow): SettingValue => (r.key in draft ? (draft[r.key] ?? r.default) : r.effective);
  const localProblem = (r: SettingRow): Problem | null => {
    const text = texts[r.key];
    if (text !== undefined) {
      const p = parseInput(r.key, r.def, text);
      if (!p.ok) return p.problem;
    }
    return r.key in draft ? checkValue(r.key, r.def, shown(r)) : null;
  };
  const problems = rows.map(localProblem).filter((p): p is Problem => !!p);
  const dirtyKeys = new Set([...changes.map((c) => c.key), ...problems.map((p) => p.key)]);
  const keep = new Set([...dirtyKeys, ...Object.keys(serverProblems), ...Object.keys(draft)]);
  const shownRows = visibleRows(rows, showAll === true, keep);
  const groups = groupRows(shownRows);
  const pilotOnly = shownRows.length < rows.length;

  const onValue = (r: SettingRow, v: SettingValue | null, text?: string) => {
    setServerProblems(({ [r.key]: _gone, ...rest }) => rest);
    if (text !== undefined) {
      setTexts((s) => ({ ...s, [r.key]: text }));
      const p = parseInput(r.key, r.def, text);
      if (p.ok) setDraft((d) => ({ ...d, [r.key]: p.value }));
      return;
    }
    setTexts(({ [r.key]: _gone, ...rest }) => rest);
    setDraft((d) => ({ ...d, [r.key]: v === null ? null : normalize(r, v) ?? null }));
  };

  const discard = () => { setDraft({}); setTexts({}); setServerProblems({}); };

  const submit = () => {
    if (problems.length) { toast({ title: t("save.fixFields"), variant: "destructive" }); return; }
    if (!changes.length) return;
    save.mutate(changes, {
      onSuccess: (data) => {
        discard();
        const n = data.changed?.length ?? 0;
        // Short toast (OWNER-31): it sits bottom-right; the save buttons are on the left of the bar now.
        toast(n ? { title: t("save.done"), description: t("save.doneText", { count: n }), duration: 2500 } : { title: t("save.nothing"), duration: 2500 });
      },
      onError: (err) => {
        const list = isApiError(err) && err.code === "SETTINGS_INVALID" ? ((err.body as { details?: { problems?: Problem[] } } | null)?.details?.problems ?? []) : [];
        if (list.length) setServerProblems(Object.fromEntries(list.map((p) => [p.key, shownProblem(byKey.get(p.key)?.def, p)])));
        toast({ title: t("save.failed"), description: list.length ? t("save.fixFields") : humanizeApiError(err), variant: "destructive" });
      },
    });
  };

  const pending = dirtyKeys.size;
  const toggle = pilotRows.length > 0 && pilotRows.length < rows.length && (
    <button type="button" className="chip min-h-7 shrink-0 rounded-full px-2.5 text-xs font-medium" aria-pressed={showAll === true} onClick={() => setShowAll(!showAll)}>
      {showAll ? t("jump.onlyPilot", { count: pilotRows.length }) : t("jump.showAll", { count: rows.length })}
    </button>
  );
  return (
    <div className="flex flex-col gap-[var(--grid-gap)] pb-2">
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {/* OWNER-12: a sticky menu of the groups + the pilot checklist shortcuts (PILOT.md §2.5). */}
      <nav aria-label={t("jump.aria")} className="sticky top-0 z-sticky -mx-1 flex flex-col gap-1.5 rounded-2xl border border-[var(--glass-border)] bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {groups.map((g) => (
            <button key={g.group} type="button" className="chip min-h-7 shrink-0 rounded-full px-2.5 text-xs" onClick={() => jumpTo(groupId(g.group))}>
              {deskSettingsI18n.tryT(`groups.${g.group}.title`) ?? g.group}
            </button>
          ))}
        </div>
        {pilotOnly ? (
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
            <span className="font-medium text-foreground">{t("jump.pilotShown", { count: pilotRows.length, total: rows.length })}</span>
            {toggle}
          </div>
        ) : pilotRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={t("jump.pilotAria")}>
            <span className="font-medium text-foreground">{t("jump.pilot", { count: pilotRows.length })}</span>
            {pilotRows.map((r) => (
              <button key={r.key} type="button" className="rounded px-1.5 py-0.5 text-muted-foreground underline-offset-2 hover:bg-[var(--glass-bg)] hover:text-foreground hover:underline" onClick={() => jumpTo(fieldId(r.key), true)}>
                {settingLabel(r.key)}
              </button>
            ))}
            <span className="ml-auto">{toggle}</span>
          </div>
        )}
      </nav>
      {groups.map((g) => (
        <Panel
          key={g.group}
          id={groupId(g.group)}
          className="scroll-mt-28"
          title={deskSettingsI18n.tryT(`groups.${g.group}.title`) ?? g.group}
          description={deskSettingsI18n.tryT(`groups.${g.group}.description`)}
          bodyClassName="py-0"
        >
          <div className="divide-y divide-[var(--glass-border)]">
            {g.rows.map((r) => (
              <DeskSettingField
                key={r.key}
                row={r}
                value={shown(r)}
                text={texts[r.key]}
                dirty={dirtyKeys.has(r.key)}
                problem={serverProblems[r.key] ?? localProblem(r)}
                onValue={(v, text) => onValue(r, v, text)}
              />
            ))}
          </div>
        </Panel>
      ))}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-2xl px-[var(--panel-p)] py-2.5",
          // Unsaved edits: the bar sticks to the bottom on a solid background (the one next step); clean: a quiet footer.
          pending ? "sticky bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-sticky border border-[var(--glass-border)] bg-background/95 shadow-lg backdrop-blur" : "glass-panel",
        )}
        role="region"
        aria-label={t("title")}
      >
        {/* Buttons on the left: toasts appear bottom-right and must never cover «Сохранить» (OWNER-31). */}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={submit} disabled={!pending || save.isPending}>
            <Save aria-hidden="true" />
            {save.isPending ? t("save.saving") : t("save.button")}
          </Button>
          <Button variant="ghost" size="sm" onClick={discard} disabled={!pending || save.isPending}>
            <Undo2 aria-hidden="true" />
            {t("save.discard")}
          </Button>
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? t("save.pending", { count: pending }) : t("save.idle")}
        </span>
      </div>
    </div>
  );
}
