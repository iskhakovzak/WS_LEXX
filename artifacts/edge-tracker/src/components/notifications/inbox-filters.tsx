/**
 * The inbox's own filters (the quiet second row of the /notifications FeedToolbar): severity chips, group and type
 * selects, «Сбросить», the keyboard hint on wide screens.
 */
import { X } from "lucide-react";
import { FilterChip, Kbd, Pill } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { notificationsI18n } from "@/i18n/ns/notifications";
import { GROUP_LABELS, GROUP_ORDER, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_TONE, TYPES, type NotificationGroup, type Severity } from "./model";

export const ALL_GROUPS = "__all__";
export type GroupPick = NotificationGroup | typeof ALL_GROUPS;

export function InboxFilters({ severities, setSeverities, group, setGroup, types, setTypes, filtersOn, onReset }: {
  severities: Severity[];
  setSeverities: (f: (prev: Severity[]) => Severity[]) => void;
  group: GroupPick;
  setGroup: (g: GroupPick) => void;
  types: string[];
  setTypes: (t: string[]) => void;
  filtersOn: boolean;
  onReset: () => void;
}) {
  const { t } = notificationsI18n.useT();
  const typeOptions = group === ALL_GROUPS ? TYPES : TYPES.filter((x) => x.group === group);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SEVERITY_ORDER.map((s) => (
        <FilterChip
          key={s}
          size="sm"
          active={severities.includes(s)}
          onClick={() => setSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
          className={cn(severities.includes(s) && s !== "info" && (s === "critical" ? "text-down" : "text-[hsl(var(--chart-3))]"))}
        >
          <Pill tone={SEVERITY_TONE[s]} dot className="px-0 py-0 text-xs bg-transparent">{SEVERITY_LABEL[s]}</Pill>
        </FilterChip>
      ))}
      <span className="mx-1 hidden h-5 w-px bg-[var(--glass-border)] sm:block" aria-hidden="true" />
      <Select value={group} onValueChange={(v) => { setGroup(v as GroupPick); setTypes([]); }}>
        <SelectTrigger aria-label={t("page.group")} className="h-8 w-full text-xs sm:w-[190px]"><SelectValue placeholder={t("page.allGroups")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_GROUPS}>{t("page.allGroups")}</SelectItem>
          {GROUP_ORDER.map((g) => <SelectItem key={g} value={g}>{GROUP_LABELS[g]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={types.length === 1 ? types[0] : ALL_GROUPS} onValueChange={(v) => setTypes(v === ALL_GROUPS ? [] : [v])}>
        <SelectTrigger aria-label={t("page.type")} className="h-8 w-full text-xs sm:w-[260px]"><SelectValue placeholder={t("page.allTypes")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_GROUPS}>{t("page.allTypes")}</SelectItem>
          {typeOptions.map((x) => <SelectItem key={x.type} value={x.type}>{x.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {filtersOn && (
        <button type="button" onClick={onReset} className="chip inline-flex h-8 items-center gap-1 px-2.5 text-xs">
          <X className="h-3 w-3" aria-hidden="true" /> {commonI18n.t("actions.reset")}
        </button>
      )}
      <div className="ml-auto hidden items-center gap-1 text-2xs text-muted-foreground lg:flex" aria-hidden="true">
        <Kbd keys={["↑", "↓"]} /> {t("page.keys.select")} · <Kbd keys={["Enter"]} /> {t("page.keys.open")} · <Kbd keys={["R"]} /> {t("page.keys.read")} · <Kbd keys={["E"]} /> {t("page.keys.archive")} · <Kbd keys={["X"]} /> {t("page.keys.mark")}
      </div>
    </div>
  );
}
