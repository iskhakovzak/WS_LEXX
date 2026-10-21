/**
 * «Моя тема» — create / edit one of the user's own themes (visible only to him): tickers (1–30) or a Finviz screener
 * (a sector pick prefills the name and the filter; or an industry filter / a pasted finviz.com link — only its filters
 * are kept). The screener takes the top 25 by market cap; without Finviz the theme waits for it. Prefilled when editing.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/ds";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { themesI18n } from "@/i18n/ns/themes";
import { useSaveMine, type MineDraft } from "./api";
import { MAX_SCREENER_FILTERS, MAX_TICKERS, SECTORS, parseScreenerInput, parseTickers, type BoardTheme } from "./model";

type Kind = "tickers" | "screener";
const sectorOf = (text: string) => SECTORS.find((s) => text.toLowerCase().split(/[\s,;]+/).includes(s.code)) ?? null;

function useScreenerProblem(text: string): { problem: string | null; ok: string | null } {
  const { t } = themesI18n.useT();
  const p = parseScreenerInput(text);
  if (p.ok) return { problem: null, ok: t("my.filterOk", { list: p.spec.filters.join(", ") }) };
  if (p.reason === "tooMany") return { problem: t("my.filterTooMany", { max: MAX_SCREENER_FILTERS }), ok: null };
  if (p.reason === "invalid") return { problem: t("my.filterInvalid", { list: (p.bad ?? []).join(", ") }), ok: null };
  return { problem: t("my.filterEmpty"), ok: null };
}

function MyThemeForm({ initial, boardId, finviz, onDone }: { initial: BoardTheme | null; boardId: number | null; finviz: boolean; onDone: () => void }) {
  const { t } = themesI18n.useT();
  const save = useSaveMine();
  const mine = initial?.mine ?? null;
  const [kind, setKind] = useState<Kind>(mine?.kind ?? "tickers");
  const [name, setName] = useState(initial?.name ?? "");
  const [tickersText, setTickersText] = useState(mine?.kind === "tickers" ? mine.tickers.join(", ") : "");
  const [filterText, setFilterText] = useState(mine?.screener ? mine.screener.filters.join(", ") : "");
  const [error, setError] = useState<string | null>(null);
  const tickers = parseTickers(tickersText);
  const screener = useScreenerProblem(filterText);
  const sector = sectorOf(filterText);

  const problem = !name.trim()
    ? t("config.nameRequired")
    : kind === "tickers"
      ? tickers.invalid.length ? t("config.invalid", { list: tickers.invalid.join(", ") })
        : !tickers.tickers.length ? t("config.needOne")
          : tickers.tickers.length > MAX_TICKERS ? t("config.tooMany", { max: MAX_TICKERS }) : null
      : screener.problem;

  const pickSector = (code: string) => {
    const next = SECTORS.find((s) => s.code === code);
    if (!next) return;
    const rest = filterText.split(/[\s,;]+/).filter((x) => x && !SECTORS.some((s) => s.code === x.toLowerCase()));
    setFilterText([next.code, ...rest].join(", "));
    // Prefill the name while it is empty or still the previous sector's name.
    if (!name.trim() || name === sector?.name) setName(next.name);
  };

  const submit = async () => {
    if (problem) return;
    setError(null);
    const draft: MineDraft = kind === "tickers"
      ? { name: name.trim(), kind, tickers: tickers.tickers }
      : { name: name.trim(), kind, screener: filterText, order: mine?.screener?.order ?? null };
    if (!initial && boardId != null) draft.boardId = boardId;
    try {
      await save.mutateAsync({ id: initial?.id ?? null, draft });
      toast({ title: initial ? t("config.saved") : t("config.created") });
      onDone();
    } catch (err) {
      setError(humanizeApiError(err, t("config.failed")));
    }
  };

  const hint = (text: string, bad: boolean) => <p className={cn("text-xs", bad ? "text-warn" : "text-muted-foreground")}>{text}</p>;

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Segmented
        ariaLabel={t("my.kindAria")}
        value={kind}
        onChange={setKind}
        options={[{ value: "tickers", label: t("my.kinds.tickers") }, { value: "screener", label: t("my.kinds.screener") }]}
      />
      {kind === "screener" && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("my.sector")}</Label>
          <Select value={sector?.code ?? ""} onValueChange={pickSector}>
            <SelectTrigger aria-label={t("my.sector")}><SelectValue placeholder={t("my.sectorPick")} /></SelectTrigger>
            <SelectContent>
              {SECTORS.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="my-theme-name">{t("config.name")}</Label>
        <Input id="my-theme-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </div>
      {kind === "tickers" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="my-theme-tickers">{t("config.tickers")}</Label>
          <Textarea id="my-theme-tickers" rows={3} className="font-mono text-sm uppercase" value={tickersText} onChange={(e) => setTickersText(e.target.value)} />
          {hint(problem && tickersText.trim() ? problem : `${t("config.tickersHint")} · ${commonI18n.t("units.tickers", { count: tickers.tickers.length })}`, !!problem && !!tickersText.trim())}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="my-theme-filter">{t("my.filter")}</Label>
          <Textarea id="my-theme-filter" rows={2} className="font-mono text-sm" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
          {hint(filterText.trim() ? (screener.problem ?? screener.ok ?? "") : t("my.filterHint"), !!filterText.trim() && !!screener.problem)}
          {!finviz && hint(t("my.needsFinviz"), true)}
        </div>
      )}
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

/** `editing`: undefined = closed, null = new theme (on `boardId`), a theme = edit it. */
export function MyThemeSheet({ editing, boardId, finviz, onClose }: { editing: BoardTheme | null | undefined; boardId: number | null; finviz: boolean; onClose: () => void }) {
  const { t } = themesI18n.useT();
  const mobile = useIsMobile();
  return (
    <Sheet open={editing !== undefined} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-4 overflow-y-auto p-4 sm:p-5", mobile ? "max-h-[92dvh] rounded-t-2xl" : "w-full sm:max-w-md")}
      >
        <SheetHeader>
          <SheetTitle>{editing ? t("my.titleEdit") : t("my.titleNew")}</SheetTitle>
          <SheetDescription>{t("my.desc")}</SheetDescription>
        </SheetHeader>
        {editing !== undefined && <MyThemeForm key={editing?.key ?? "new"} initial={editing} boardId={boardId} finviz={finviz} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
