/**
 * The one toolbar of the feeds in /notifications («Входящие», «Команда», «Архив»; design audit wave 2): search, the
 * «Непрочитанные» toggle and «Прочитать всё» — the same three controls in the same place on every tab. Tab-specific
 * filters (severity / sections / trader) go into `children`, a quieter second row of the same panel (never on the photo).
 *
 *   [ 🔍 search …            ] [ Непрочитанные 3 ]                 [ ✓ Прочитать всё ]
 *   children (filters of this tab)
 */
import * as React from "react";
import { CheckCheck, Search, X } from "lucide-react";
import { FilterChip } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { commonI18n } from "@/i18n/ns/common";
import { cn } from "@/lib/utils";

export function FeedToolbar({
  search,
  onSearch,
  placeholder,
  searchAria,
  unreadOnly,
  onUnreadOnly,
  unreadLabel,
  unreadCount,
  onReadAll,
  readAllLabel,
  readAllPending,
  children,
  className,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  searchAria: string;
  /** null: no unread toggle on this tab (the archive). */
  unreadOnly: boolean | null;
  onUnreadOnly?: (v: boolean) => void;
  unreadLabel: string;
  unreadCount?: number;
  /** Absent: nothing to mark (the button is hidden, not disabled). */
  onReadAll?: () => void;
  readAllLabel: string;
  readAllPending?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  // «/» focuses the search (not while typing elsewhere).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={cn("glass-panel flex flex-col rounded-2xl", className)}>
      <div className="flex flex-wrap items-center gap-inline gap-y-2 p-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={ref}
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { onSearch(""); (e.target as HTMLInputElement).blur(); } }}
            placeholder={placeholder}
            aria-label={searchAria}
            className="h-9 pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label={commonI18n.t("actions.clearSearch")}
              className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {unreadOnly != null && onUnreadOnly && (
          <FilterChip active={unreadOnly} onClick={() => onUnreadOnly(!unreadOnly)} count={unreadCount || undefined}>{unreadLabel}</FilterChip>
        )}
        {onReadAll && (
          <Button variant="outline" size="sm" className="ml-auto h-9" onClick={onReadAll} disabled={readAllPending}>
            <CheckCheck aria-hidden="true" /> {readAllLabel}
          </Button>
        )}
      </div>
      {children && <div className="border-t border-[var(--glass-border)] px-2 py-2">{children}</div>}
    </div>
  );
}
