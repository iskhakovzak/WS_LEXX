/**
 * Admin «Настроить темы» (shared themes are desk settings, settings.manage): one side sheet — the active themes (edit
 * name + tickers inline, archive), «Новая тема», and the archive folded below (restore). Nothing is deleted. Forms
 * are prefilled with the current values.
 */
import { useState } from "react";
import { Archive, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, ListSkeleton } from "@/components/ds";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { isApiError } from "@/lib/api/http";
import { commonI18n } from "@/i18n/ns/common";
import { themesI18n } from "@/i18n/ns/themes";
import { useSaveTheme, useThemeConfig, type ThemeDraft } from "./api";
import { MAX_TICKERS, parseTickers, type ThemeRecord } from "./model";

function saveError(err: unknown): string {
  if (isApiError(err) && err.status === 409) return themesI18n.t("config.duplicate");
  return humanizeApiError(err, themesI18n.t("config.failed"));
}

function ThemeForm({ initial, onDone }: { initial: ThemeRecord | null; onDone: () => void }) {
  const { t } = themesI18n.useT();
  const save = useSaveTheme();
  const [name, setName] = useState(initial?.name ?? "");
  const [text, setText] = useState(initial ? initial.tickers.join(", ") : "");
  const [error, setError] = useState<string | null>(null);
  const parsed = parseTickers(text);
  const problem = !name.trim()
    ? t("config.nameRequired")
    : parsed.invalid.length
      ? t("config.invalid", { list: parsed.invalid.join(", ") })
      : !parsed.tickers.length
        ? t("config.needOne")
        : parsed.tickers.length > MAX_TICKERS
          ? t("config.tooMany", { max: MAX_TICKERS })
          : null;
  const idBase = `theme-form-${initial?.id ?? "new"}`;

  const submit = async () => {
    if (problem) return;
    setError(null);
    const draft: ThemeDraft = { name: name.trim(), tickers: parsed.tickers };
    try {
      await save.mutateAsync({ id: initial?.id ?? null, draft });
      toast({ title: initial ? t("config.saved") : t("config.created") });
      onDone();
    } catch (err) {
      setError(saveError(err));
    }
  };

  return (
    <form className="tile flex flex-col gap-3 p-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idBase}-name`}>{t("config.name")}</Label>
        <Input id={`${idBase}-name`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus={!initial} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idBase}-tickers`}>{t("config.tickers")}</Label>
        <Textarea
          id={`${idBase}-tickers`}
          value={text}
          rows={3}
          className="font-mono text-sm uppercase"
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${idBase}-hint`}
        />
        <p id={`${idBase}-hint`} className={problem && text.trim() ? "text-xs text-warn" : "text-xs text-muted-foreground"}>
          {problem && text.trim() ? problem : `${t("config.tickersHint")} · ${commonI18n.t("units.tickers", { count: parsed.tickers.length })}`}
        </p>
      </div>
      {error && <p role="alert" className="text-xs text-down">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>{commonI18n.t("actions.cancel")}</Button>
        <Button type="submit" size="sm" disabled={!!problem || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {initial ? commonI18n.t("actions.save") : t("config.create")}
        </Button>
      </div>
    </form>
  );
}

const ICON_BTN = "grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground disabled:opacity-40";

function ThemeLine({ theme, onEdit }: { theme: ThemeRecord; onEdit?: () => void }) {
  const { t } = themesI18n.useT();
  const save = useSaveTheme();
  const setActive = async (active: boolean) => {
    try {
      await save.mutateAsync({ id: theme.id, draft: { active } });
      toast({ title: active ? t("config.restoredToast") : t("config.archivedToast"), description: theme.name });
    } catch (err) {
      toast({ title: t("config.failed"), description: saveError(err), variant: "destructive" });
    }
  };
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[var(--glass-hover-bg)]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={theme.name}>{theme.name}</p>
        <p className="truncate text-xs text-muted-foreground" title={theme.tickers.join(", ")}>{theme.tickers.join(" ")}</p>
      </div>
      {theme.active ? (
        <>
          <button type="button" className={ICON_BTN} onClick={onEdit} aria-label={t("config.editAria", { name: theme.name })} title={t("config.editAria", { name: theme.name })}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={ICON_BTN} disabled={save.isPending} onClick={() => void setActive(false)} aria-label={t("config.archiveAria", { name: theme.name })} title={t("config.archive")}>
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      ) : (
        <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => void setActive(true)} aria-label={t("config.restoreAria", { name: theme.name })}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t("config.restore")}
        </Button>
      )}
    </li>
  );
}

export function ThemeConfigSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = themesI18n.useT();
  const q = useThemeConfig(open);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const all = q.data ?? [];
  const active = all.filter((th) => th.active);
  const archived = all.filter((th) => !th.active);
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) setEditing(null); onOpenChange(o); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("config.title")}</SheetTitle>
          <SheetDescription>{t("config.desc")}</SheetDescription>
        </SheetHeader>

        {editing === "new" ? (
          <ThemeForm initial={null} onDone={() => setEditing(null)} />
        ) : (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" /> {t("config.add")}
          </Button>
        )}

        {q.isPending ? (
          <ListSkeleton rows={6} dense />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} title={t("config.loadFailed")} compact />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {active.map((th) =>
              editing === th.id ? (
                <li key={th.id}><ThemeForm initial={th} onDone={() => setEditing(null)} /></li>
              ) : (
                <ThemeLine key={th.id} theme={th} onEdit={() => setEditing(th.id)} />
              ),
            )}
          </ul>
        )}

        {archived.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Archive className="h-4 w-4" aria-hidden="true" /> {t("config.archivedTitle", { n: archived.length })}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="flex flex-col gap-0.5 pt-1">
                {archived.map((th) => <ThemeLine key={th.id} theme={th} />)}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </SheetContent>
    </Sheet>
  );
}
