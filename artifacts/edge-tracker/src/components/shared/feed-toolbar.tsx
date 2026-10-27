/**
 * The one toolbar of the feeds in /notifications («Входящие», «Команда», «Архив»; design audit wave 3): the wave-3
 * filter pattern (components/shared/filters/filter-toolbar) in one row — the only search, «Все / Непрочитанные» as the
 * one Segmented (the main mode of a feed), the tab's «Фильтры (n)» (`filters`), quiet end items and «Прочитать всё».
 * The tab renders its ActiveFilters chips right under it.
 *
 *   [ 🔍 search …        ] [ Все | Непрочитанные 3 ] [ Фильтры 2 ]          ? ⟳  [ ✓ Прочитать всё ]
 */
import * as React from "react";
import { CheckCheck } from "lucide-react";
import { Segmented, Toolbar } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/shared/filters/filter-toolbar";

export function FeedToolbar({
  search,
  onSearch,
  placeholder,
  searchAria,
  unreadOnly,
  onUnreadOnly,
  allLabel,
  unreadLabel,
  modeAria,
  unreadCount,
  onReadAll,
  readAllLabel,
  readAllPending,
  filters,
  end,
  className,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  searchAria: string;
  /** null: no unread mode on this tab (the archive). */
  unreadOnly: boolean | null;
  onUnreadOnly?: (v: boolean) => void;
  allLabel: string;
  unreadLabel: string;
  modeAria: string;
  unreadCount?: number;
  /** Absent: nothing to mark (the button is hidden, not disabled). */
  onReadAll?: () => void;
  readAllLabel: string;
  readAllPending?: boolean;
  /** The tab's «Фильтры (n)» (FiltersButton). */
  filters?: React.ReactNode;
  /** Quiet items before «Прочитать всё» (refresh, the keys hint). */
  end?: React.ReactNode;
  className?: string;
}) {
  return (
    <Toolbar className={className}>
      <ToolbarSearch value={search} onChange={onSearch} placeholder={placeholder} ariaLabel={searchAria} />
      {unreadOnly != null && onUnreadOnly && (
        <Segmented<"all" | "unread">
          ariaLabel={modeAria}
          value={unreadOnly ? "unread" : "all"}
          onChange={(v) => onUnreadOnly(v === "unread")}
          options={[
            { value: "all", label: allLabel },
            { value: "unread", label: unreadLabel, count: unreadCount || undefined },
          ]}
        />
      )}
      {filters}
      {(end || onReadAll) && (
        <span className="ml-auto flex items-center gap-1">
          {end}
          {onReadAll && (
            // Phones: icon only (named by aria-label), so the row stays one line.
            <Button variant="outline" size="sm" className="h-9" onClick={onReadAll} disabled={readAllPending} aria-label={readAllLabel} title={readAllLabel}>
              <CheckCheck aria-hidden="true" /> <span className="hidden sm:inline">{readAllLabel}</span>
            </Button>
          )}
        </span>
      )}
    </Toolbar>
  );
}
