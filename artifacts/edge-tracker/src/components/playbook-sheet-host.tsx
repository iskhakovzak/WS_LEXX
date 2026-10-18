/**
 * App-wide host of the playbook sheet (mounted once in the shell): listens to `openSetupSheet` / `openTaggingSheet`
 * (components/shared/playbook-sheet) from any page and opens the cheat sheet or the tagging inbox over it. The sheet
 * itself is a lazy chunk that loads on the first request. `?tagDay=YYYY-MM-DD` on any page (the «разметить вчерашние
 * сделки» quest link) opens the tagging sheet for that day and drops the param.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PLAYBOOK_SHEET_EVENT, type PlaybookSheetRequest } from "@/components/shared/playbook-sheet";
import type { QuickSheetRequest } from "@/components/playbook/today/quick-sheet";

const QuickSheet = lazy(() => import("@/components/playbook/today/quick-sheet"));

export function PlaybookSheetHost() {
  const [request, setRequest] = useState<QuickSheetRequest | null>(null);
  const [open, setOpen] = useState(false);
  const search = useSearch();
  const [location, navigate] = useLocation();
  useEffect(() => {
    const qs = new URLSearchParams(search);
    const day = qs.get("tagDay");
    if (!day) return;
    qs.delete("tagDay");
    const rest = qs.toString();
    navigate(`${location}${rest ? `?${rest}` : ""}`, { replace: true });
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setRequest((prev) => ({ kind: "tag", day, n: (prev?.n ?? 0) + 1 }));
      setOpen(true);
    }
  }, [search, location, navigate]);
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<PlaybookSheetRequest>).detail;
      if (!detail) return;
      setRequest((prev) => ({ ...detail, n: (prev?.n ?? 0) + 1 }));
      setOpen(true);
    }
    window.addEventListener(PLAYBOOK_SHEET_EVENT, onOpen);
    return () => window.removeEventListener(PLAYBOOK_SHEET_EVENT, onOpen);
  }, []);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <QuickSheet request={request} open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
