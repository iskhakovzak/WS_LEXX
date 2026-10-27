/**
 * The inbox's own filters behind «Фильтры (n)» of the /notifications toolbar (design audit wave 3): severity chips,
 * group and type selects; `inboxActiveFilters` lists each active one as a removable chip. `InboxKeysHint` keeps the
 * keyboard hint behind «?» instead of a permanent line of keys.
 */
import { Keyboard } from "lucide-react";
import { FilterChip, Kbd, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterSection, FiltersButton, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { cn } from "@/lib/utils";
import { notificationsI18n } from "@/i18n/ns/notifications";
import { GROUP_LABELS, GROUP_ORDER, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_TONE, TYPES, typeMeta, type NotificationGroup, type Severity } from "./model";

export const ALL_GROUPS = "__all__";
export type GroupPick = NotificationGroup | typeof ALL_GROUPS;

type Props = {
  severities: Severity[];
  setSeverities: (f: (prev: Severity[]) => Severity[]) => void;
  group: GroupPick;
  setGroup: (g: GroupPick) => void;
  types: string[];
  setTypes: (t: string[]) => void;
};

/** Filters inside the popover that are not at their default. */
export function inboxFilterCount({ severities, group, types }: Pick<Props, "severities" | "group" | "types">): number {
  return severities.length + (group !== ALL_GROUPS ? 1 : 0) + (types.length ? 1 : 0);
}

export function InboxFiltersButton({ severities, setSeverities, group, setGroup, types, setTypes, resultCount }: Props & { resultCount?: number }) {
  const { t } = notificationsI18n.useT();
  const typeOptions = group === ALL_GROUPS ? TYPES : TYPES.filter((x) => x.group === group);
  const reset = () => { setSeverities(() => []); setGroup(ALL_GROUPS); setTypes([]); };
  return (
    <FiltersButton count={inboxFilterCount({ severities, group, types })} onReset={reset} resultCount={resultCount}>
      <FilterSection title={t("page.severity")}>
        <div className="flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.map((s) => (
            <FilterChip
              key={s}
              size="sm"
              active={severities.includes(s)}
              onClick={() => setSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
              className={cn(severities.includes(s) && s !== "info" && (s === "critical" ? "text-down" : "text-[hsl(var(--chart-3))]"))}
            >
              <Pill tone={SEVERITY_TONE[s]} dot className="bg-transparent px-0 py-0 text-xs">{SEVERITY_LABEL[s]}</Pill>
            </FilterChip>
          ))}
        </div>
      </FilterSection>
      <FilterSection title={t("page.group")}>
        <Select value={group} onValueChange={(v) => { setGroup(v as GroupPick); setTypes([]); }}>
          <SelectTrigger aria-label={t("page.group")} className="h-9 w-full"><SelectValue placeholder={t("page.allGroups")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_GROUPS}>{t("page.allGroups")}</SelectItem>
            {GROUP_ORDER.map((g) => <SelectItem key={g} value={g}>{GROUP_LABELS[g]}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSection>
      <FilterSection title={t("page.type")}>
        <Select value={types.length === 1 ? types[0] : ALL_GROUPS} onValueChange={(v) => setTypes(v === ALL_GROUPS ? [] : [v])}>
          <SelectTrigger aria-label={t("page.type")} className="h-9 w-full"><SelectValue placeholder={t("page.allTypes")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_GROUPS}>{t("page.allTypes")}</SelectItem>
            {typeOptions.map((x) => <SelectItem key={x.type} value={x.type}>{x.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSection>
    </FiltersButton>
  );
}

/** One removable chip per active popover filter (severity, group, each type). */
export function inboxActiveFilters({ severities, setSeverities, group, setGroup, types, setTypes }: Props): ActiveFilter[] {
  return [
    ...severities.map((s) => ({ key: `sev:${s}`, label: SEVERITY_LABEL[s], onRemove: () => setSeverities((prev) => prev.filter((x) => x !== s)) })),
    ...(group !== ALL_GROUPS ? [{ key: "group", label: GROUP_LABELS[group], onRemove: () => { setGroup(ALL_GROUPS); setTypes([]); } }] : []),
    ...types.map((ty) => ({ key: `type:${ty}`, label: typeMeta(ty).label, onRemove: () => setTypes(types.filter((x) => x !== ty)) })),
  ];
}

/** «?»: the inbox keyboard shortcuts, on demand. */
export function InboxKeysHint() {
  const { t } = notificationsI18n.useT();
  const rows: Array<[string[], string]> = [
    [["↑", "↓"], t("page.keys.select")],
    [["Enter"], t("page.keys.open")],
    [["R"], t("page.keys.read")],
    [["E"], t("page.keys.archive")],
    [["X"], t("page.keys.mark")],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className="hidden md:inline-flex" aria-label={t("page.keys.title")} title={t("page.keys.title")}>
          <Keyboard aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3">
        <p className="mb-2 text-sm font-semibold">{t("page.keys.title")}</p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {rows.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{label}</span>
              <Kbd keys={keys} />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
