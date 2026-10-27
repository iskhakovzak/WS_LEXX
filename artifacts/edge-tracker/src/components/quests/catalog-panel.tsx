/**
 * «Каталог достижений» (staff, /ratings → «Квесты и достижения»): every line of the desk with its rule, tiers, horizon,
 * whether it is one per setup / leak / step, whether it feeds the risk allocation — and, for an admin, a switch per line
 * (the desk setting achievements.disabled; a switched-off line is not counted or shown, earned tiers stay in history).
 */
import { BookOpen, Coins } from "lucide-react";
import { Panel, PanelSkeleton, Pill } from "@/components/ds";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { questsI18n } from "@/i18n/ns/quests";
import type { AchievementCatalogEntry, AchievementCategory } from "@/lib/quests/types";
import { CATEGORY_ORDER, tierLabel, textOf } from "./model";
import { Medal } from "./medal";
import { useAchievementCatalog, useSaveDisabledLines } from "./api";

function Row({ e, canEdit, onToggle }: { e: AchievementCatalogEntry; canEdit: boolean; onToggle: (on: boolean) => void }) {
  const { t } = questsI18n.useT();
  const title = textOf({ key: `ach.${e.id}.title` }, null) ?? e.id;
  const hint = textOf({ key: `ach.${e.id}.hint`, params: { count: e.tiers[0]?.target ?? 1 } }, null) ?? "";
  return (
    <li className="flex min-w-0 items-start gap-3 py-2">
      <Medal category={e.category} tier={e.disabled ? null : (e.tiers[e.tiers.length - 1]?.tier ?? "gold")} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={e.disabled ? "text-sm font-medium text-muted-foreground line-through" : "text-sm font-medium text-foreground"}>{title}</span>
          <span className="text-2xs text-muted-foreground">{t(`achievements.horizon.${e.horizon}`)}</span>
          {e.secret && <Pill tone="neutral">{t("catalog.secret")}</Pill>}
          {e.dynamic && <Pill tone="neutral">{t("catalog.dynamic")}</Pill>}
          {e.capital && <Pill tone="accent"><Coins className="mr-1 h-3 w-3" aria-hidden="true" />{t("catalog.capital")}</Pill>}
        </div>
        <span className="text-xs text-muted-foreground">{hint}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {e.tiers.map((x) => `${tierLabel(x.tier)} ${x.target}`).join(" · ")}
        </span>
      </div>
      <Switch
        checked={!e.disabled}
        disabled={!canEdit}
        onCheckedChange={onToggle}
        aria-label={t("catalog.toggleAria", { title })}
        title={canEdit ? undefined : t("catalog.readOnly")}
      />
    </li>
  );
}

export function AchievementCatalogPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = questsI18n.useT();
  const { toast } = useToast();
  const q = useAchievementCatalog(true);
  const save = useSaveDisabledLines();
  if (q.isLoading) return <PanelSkeleton />;
  if (!q.data) return null;
  const entries = q.data.entries;
  const toggle = (id: string, on: boolean) => {
    const off = new Set(entries.filter((e) => e.disabled).map((e) => e.id));
    if (on) off.delete(id); else off.add(id);
    save.mutate([...off], {
      onSuccess: () => toast({ title: t("catalog.saved") }),
      onError: (err) => toast({ title: t("catalog.failed"), description: humanizeApiError(err), variant: "destructive" }),
    });
  };
  const byCat = CATEGORY_ORDER.map((c) => [c, entries.filter((e) => e.category === c)] as [AchievementCategory, AchievementCatalogEntry[]]).filter(([, l]) => l.length);
  const tiers = entries.reduce((s, e) => s + e.tiers.length, 0);
  return (
    <Panel
      title={t("catalog.title")}
      icon={BookOpen}
      description={t("catalog.description")}
      actions={<span className="text-xs tabular-nums text-muted-foreground">{t("catalog.count", { lines: entries.length, tiers })}</span>}
    >
      <div className="flex flex-col gap-3">
        {!canEdit && <p className="text-xs text-muted-foreground">{t("catalog.readOnly")}</p>}
        {byCat.map(([cat, list]) => (
          <section key={cat} className="flex flex-col">
            <h3 className="micro-label">{t(`category.${cat}`)}</h3>
            <ul className="flex flex-col divide-y divide-[var(--glass-border)]">
              {list.map((e) => <Row key={e.id} e={e} canEdit={canEdit && !save.isPending} onToggle={(on) => toggle(e.id, on)} />)}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}
