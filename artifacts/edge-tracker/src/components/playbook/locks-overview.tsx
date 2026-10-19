/**
 * «Уровни доступа» (OWNER-03, PILOT §2.5) — one table of the office setups × the ladder: which setup each level sees
 * open, and the «Открыт с уровня» select per row (MinTierSelect: PATCH /api/playbook/:id { minTier }, audited as
 * playbook.min_tier). Curators / admins open it from the playbook header menu («⋯ → Уровни доступа»).
 */
import { Check, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tierDisplay } from "@/components/shared/tier-labels";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { MinTierSelect } from "./min-tier-select";
import { spaceOf, type PlaybookEntry } from "./model";
import { lockRows, LADDER } from "./locks-model";

export function LocksOverviewDialog({ open, onOpenChange, entries }: { open: boolean; onOpenChange: (v: boolean) => void; entries: PlaybookEntry[] }) {
  const { t } = playbookTodayI18n.useT();
  const rows = open ? lockRows(entries.filter((e) => spaceOf(e) === "office" && !e.parentId)) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Opened from the header menu: the menu hands focus back to its trigger as it closes — that is not «outside». */}
      <DialogContent className="flex max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-3 overflow-hidden" onFocusOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("locks.title")}</DialogTitle>
          <DialogDescription>{t("locks.description")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-auto px-6">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-raised [&_th]:border-b [&_th]:border-[var(--glass-border)] [&_th]:bg-popover [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
              <tr>
                <th scope="col">{t("locks.colSetup")}</th>
                <th scope="col">{t("lock.editorLabel")}</th>
                {LADDER.map((k) => <th key={k} scope="col" className="!text-center">{tierDisplay(k)}</th>)}
              </tr>
            </thead>
            <tbody className="[&_td]:border-b [&_td]:border-border/40 [&_td]:px-2 [&_td]:py-1.5">
              {rows.map(({ entry, open: opens }) => (
                <tr key={entry.id}>
                  <th scope="row" className="max-w-[260px] px-2 py-1.5 text-left font-medium text-foreground [overflow-wrap:anywhere]">{entry.name}</th>
                  <td><MinTierSelect entry={entry} /></td>
                  {LADDER.map((k) => (
                    <td key={k} className="text-center">
                      {opens[k]
                        ? <Check role="img" className="mx-auto h-4 w-4 text-up" aria-label={t("locks.openFor", { tier: tierDisplay(k) })} />
                        : <Lock role="img" className="mx-auto h-4 w-4 text-warn" aria-label={t("locks.lockedFor", { tier: tierDisplay(k) })} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("locks.empty")}</p>}
        </div>
        <p className="text-xs text-muted-foreground">{t("locks.footnote")}</p>
      </DialogContent>
    </Dialog>
  );
}
