/**
 * The /discussions filter row (design audit wave 3, components/shared/filters): search · which threads (the main mode)
 * · «Фильтры (n)» with sort, audience, type and the busiest tickers; every non-default value (and a view picked from a
 * stat card: mentions / positions / live) shows as a removable chip under the row, with «Найдено: N».
 */
import type * as React from "react";
import { Lock } from "lucide-react";
import { FilterChip, Segmented, Toolbar } from "@/components/ds";
import { ActiveFilters, FilterSection, FiltersButton, ToolbarSearch, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tokenLabel, type AudienceOptions } from "./audience";
import { SORT_LABELS, TYPES, TYPE_LABELS, type SortKey, type TickerStat, type ViewKey } from "./lib";
import { discussionsI18n } from "@/i18n/ns/discussions";
import { commonI18n } from "@/i18n/ns/common";

const DEFAULT_SORT: SortKey = "active";
const MAIN_VIEWS = ["all", "unread", "mine", "open"] as const;

export type AudienceTabs = { restricted: number; forMe: number; publicCount: number; tokens: { token: string; count: number }[] };

export function DiscussionsToolbar({
  q, setQ, view, setView, sort, setSort, audience, setAudience, audienceTabs, audienceOpts, showAudience, total,
  type, setType, ticker, setTicker, tickerStats, unreadCount, found, searchRef, onReset, className,
}: {
  q: string;
  setQ: (v: string) => void;
  view: ViewKey;
  setView: (v: ViewKey) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
  audience: string;
  setAudience: (v: string) => void;
  audienceTabs: AudienceTabs;
  audienceOpts: AudienceOptions | null | undefined;
  showAudience: boolean;
  total: number;
  type: string;
  setType: (v: string) => void;
  ticker: string | null;
  setTicker: (v: string | null) => void;
  tickerStats: TickerStat[];
  unreadCount: number;
  found: number;
  searchRef: React.Ref<HTMLInputElement>;
  onReset: () => void;
  className?: string;
}) {
  const { t } = discussionsI18n.useT();
  const { t: tc } = commonI18n.useT();
  const extraView = !(MAIN_VIEWS as readonly string[]).includes(view);
  const audienceName = audience === "me" ? t("page.forMe") : audience === "public" ? t("audience.everyone") : tokenLabel(audience, audienceOpts);
  const count = [sort !== DEFAULT_SORT, audience !== "all", type !== "all", !!ticker].filter(Boolean).length;
  const chips: Array<ActiveFilter | false> = [
    extraView && { key: "view", label: t(`view.${view}`), onRemove: () => setView("all") },
    !!ticker && { key: "ticker", label: `$${ticker}`, onRemove: () => setTicker(null) },
    type !== "all" && { key: "type", label: TYPE_LABELS[type] ?? type, onRemove: () => setType("all") },
    audience !== "all" && { key: "audience", label: audienceName, onRemove: () => setAudience("all") },
    sort !== DEFAULT_SORT && { key: "sort", label: `${tc("actions.sort")}: ${SORT_LABELS[sort]}`, onRemove: () => setSort(DEFAULT_SORT) },
  ];
  const filtered = !!q.trim() || chips.some(Boolean);
  const toggleAudience = (v: string) => setAudience(audience === v ? "all" : v);

  return (
    <div className={className}>
      <Toolbar className="gap-2">
        <ToolbarSearch inputRef={searchRef} value={q} onChange={setQ} placeholder={t("page.searchPlaceholder")} ariaLabel={t("page.searchAria")} />
        <Segmented<ViewKey>
          ariaLabel={t("page.viewAria")}
          value={extraView ? "all" : view}
          onChange={setView}
          options={[
            { value: "all", label: t("view.all") },
            { value: "unread", label: t("view.unread"), count: unreadCount || undefined },
            { value: "mine", label: t("view.mine") },
            { value: "open", label: t("view.open") },
          ]}
        />
        <FiltersButton count={count} onReset={onReset} resultCount={found}>
          <FilterSection title={tc("actions.sort")}>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger aria-label={tc("actions.sort")} className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterSection>
          {showAudience && (
            <FilterSection title={t("page.audienceAria")}>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("page.audienceAria")}>
                <FilterChip size="sm" active={audience === "all"} onClick={() => setAudience("all")} count={total}>{t("page.allThreads")}</FilterChip>
                {(audienceOpts?.viewer.tokens.length ?? 0) > 0 && (
                  <FilterChip size="sm" active={audience === "me"} onClick={() => toggleAudience("me")} count={audienceTabs.forMe}>{t("page.forMe")}</FilterChip>
                )}
                <FilterChip size="sm" active={audience === "public"} onClick={() => toggleAudience("public")} count={audienceTabs.publicCount}>{t("audience.everyone")}</FilterChip>
                {audienceTabs.tokens.map(({ token, count: n }) => (
                  <FilterChip key={token} size="sm" active={audience === token} onClick={() => toggleAudience(token)} count={n}>
                    <Lock className="opacity-70" aria-hidden="true" />{tokenLabel(token, audienceOpts)}
                  </FilterChip>
                ))}
              </div>
            </FilterSection>
          )}
          <FilterSection title={t("page.typeAria")}>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label={t("page.typeAria")} className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("page.allTypes")}</SelectItem>
                {TYPES.map((ty) => <SelectItem key={ty} value={ty}>{TYPE_LABELS[ty]}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterSection>
          {tickerStats.length > 0 && (
            <FilterSection title={tc("trading.tickers")}>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={tc("trading.tickers")}>
                {tickerStats.slice(0, 12).map((s) => (
                  <FilterChip key={s.ticker} size="sm" className="tabular-nums" active={ticker === s.ticker} onClick={() => setTicker(ticker === s.ticker ? null : s.ticker)} count={s.count}>
                    ${s.ticker}
                  </FilterChip>
                ))}
              </div>
            </FilterSection>
          )}
        </FiltersButton>
      </Toolbar>
      <ActiveFilters items={chips} onReset={onReset} className="mt-2">
        {filtered && <span className="text-xs tabular-nums text-muted-foreground">{t("page.found", { count: found })}</span>}
      </ActiveFilters>
    </div>
  );
}
