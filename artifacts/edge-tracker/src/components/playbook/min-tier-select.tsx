/**
 * «Открыт с уровня» — the minimum tier of an office setup for the tier locks (the card is redacted below it, never a trading
 * block). Curators / admins change it right on the setup card (PATCH /api/playbook/:id { minTier }, audited).
 */
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tierDisplay } from "@/components/shared/tier-labels";
import { useToast } from "@/hooks/use-toast";
import { http } from "@/lib/api/http";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { notLiveMessage } from "./api";
import type { PlaybookEntry } from "./model";

const TIERS = ["junior", "trader", "senior"] as const;
const EVERYONE = "__all";

export function MinTierSelect({ entry }: { entry: PlaybookEntry }) {
  const { t } = playbookTodayI18n.useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const value = entry.minTier ?? EVERYONE;
  const options = entry.minTier && !(TIERS as readonly string[]).includes(entry.minTier) ? [...TIERS, entry.minTier] : TIERS;
  async function change(v: string) {
    const minTier = v === EVERYONE ? null : v;
    if (minTier === (entry.minTier ?? null)) return;
    const prev = qc.getQueryData<PlaybookEntry[]>(["playbook"]);
    qc.setQueryData<PlaybookEntry[]>(["playbook"], (old) => old?.map((e) => (e.id === entry.id ? { ...e, minTier } : e)));
    try {
      await http.patch(`/api/playbook/${entry.id}`, { minTier });
      toast({ title: t("lock.saved") });
      void qc.invalidateQueries({ queryKey: ["playbook-today"] });
    } catch (e) {
      if (prev) qc.setQueryData(["playbook"], prev);
      toast({ title: t("lock.failed"), description: notLiveMessage(e) ?? (e as Error)?.message, variant: "destructive" });
    }
  }
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger className="h-7 w-auto gap-1.5 rounded-full px-2.5 text-xs" aria-label={t("lock.editorLabel")} title={`${t("lock.editorLabel")} · ${t("lock.guidance")}`}>
        <Lock className="h-3 w-3 text-warn" aria-hidden="true" />
        <SelectValue>{value === EVERYONE ? t("lock.everyone") : tierDisplay(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EVERYONE}>{t("lock.everyone")}</SelectItem>
        {options.map((k) => <SelectItem key={k} value={k}>{tierDisplay(k)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
