/**
 * Playbook modes: «Сегодня» (default, morning-first) · «Мой плейбук» (traders: own + shared-with-me setups) ·
 * «Редактировать» (curators / admins: the full library with folders, editor, variants, compare, review). The mode
 * lives in ?mode= (today = no param); staff come back to the mode they used last. Next to the tabs: the small
 * «Разметить N сделок» link for those who look for the tagging inbox here (the evening card is its main home).
 */
import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { Inbox } from "lucide-react";
import { Segmented } from "@/components/ds";
import { openTaggingSheet } from "@/components/shared/playbook-sheet";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";

export type PlaybookMode = "today" | "mine" | "edit";
const LS_MODE = "playbook-mode";
const LIBRARY_PARAMS = ["folder", "q", "view", "space", "f", "tags", "tab"];

function readLs(): string | null {
  try { return localStorage.getItem(LS_MODE); } catch { return null; }
}
function writeLs(v: PlaybookMode) {
  try { localStorage.setItem(LS_MODE, v); } catch { /* private mode */ }
}

/** The mode a URL asks for (`isStaff` maps «mine» ↔ «edit»: staff have no separate «Мой» tab). */
export function modeFromUrl(search: string, isStaff: boolean, remembered: string | null): PlaybookMode {
  const p = new URLSearchParams(search);
  const lib: PlaybookMode = isStaff ? "edit" : "mine";
  const m = p.get("mode");
  if (m === "today") return "today";
  if (m === "edit" || m === "mine") return lib;
  if (LIBRARY_PARAMS.some((k) => p.get(k))) return lib;
  return isStaff && remembered === "edit" ? "edit" : "today";
}

/** The mode follows the URL (back / forward, links from other pages); switching writes the URL. */
export function usePlaybookMode(isStaff: boolean) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const mode = modeFromUrl(search, isStaff, readLs());
  /** Switch mode; `keep` carries query params over (e.g. ?id= of a personal setup opened from «Сегодня»). */
  const setMode = useCallback((next: PlaybookMode, keep?: Record<string, string>) => {
    if (isStaff) writeLs(next);
    const qs = new URLSearchParams(keep);
    if (next !== "today") qs.set("mode", next);
    else if (isStaff) qs.set("mode", "today");
    const s = qs.toString();
    navigate(`/playbook${s ? `?${s}` : ""}`);
  }, [isStaff, navigate]);
  return { mode, setMode };
}

export function PlaybookModeTabs({ mode, onMode, isStaff, untagged }: { mode: PlaybookMode; onMode: (m: PlaybookMode) => void; isStaff: boolean; untagged?: number | null }) {
  const { t } = playbookTodayI18n.useT();
  const second: PlaybookMode = isStaff ? "edit" : "mine";
  return (
    <>
      {!!untagged && untagged > 0 && !isStaff && (
        <button
          type="button"
          onClick={() => openTaggingSheet()}
          title={t("tagLinkTitle")}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Inbox className="h-3.5 w-3.5" aria-hidden="true" /> {t("tagLink", { count: untagged })}
        </button>
      )}
      <Segmented<PlaybookMode>
        ariaLabel={t("mode.aria")}
        value={mode === "today" ? "today" : second}
        onChange={onMode}
        options={[
          { value: "today", label: t("mode.today") },
          { value: second, label: isStaff ? t("mode.edit") : t("mode.mine") },
        ]}
      />
    </>
  );
}
