/**
 * «+ Доска» / «Изменить доску» — a small dialog: the kind (themes or tickers), a name, and for a tickers board its
 * source: a ticker list (paste, or «добавить всю тему» from a shared theme — prefills the name) or a Finviz screener
 * (a sector pick prefills the name and the filter; or an industry filter / a pasted finviz.com link — only its filters
 * are kept), top 25 / 50. A themes board starts empty: own themes are added on it, shared themes pinned from their card.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/ds";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { themesI18n } from "@/i18n/ns/themes";
import { useSaveBoard, type BoardDraft } from "./api";
import {
  MAX_BOARD_TICKERS, MAX_SCREENER_FILTERS, SECTORS, parseScreenerInput, parseTickers, themeTickerList, type BoardKind, type BoardMeta, type ThemeOut,
} from "./model";

export type BoardPrefill = { name: string; tickers: string[] };
type Source = "tickers" | "screener";

const sectorOf = (text: string) => SECTORS.find((s) => text.toLowerCase().split(/[\s,;]+/).includes(s.code)) ?? null;

function BoardForm({ initial, prefill, themes, finviz, onDone }: {
  initial: BoardMeta | null; prefill: BoardPrefill | null; themes: readonly ThemeOut[]; finviz: boolean; onDone: (b: BoardMeta | null) => void;
}) {
  const { t } = themesI18n.useT();
  const save = useSaveBoard();
  const src = initial?.source ?? null;
  const [kind, setKind] = useState<BoardKind>(initial?.kind ?? (prefill ? "tickers" : "themes"));
  const [name, setName] = useState(initial?.name ?? prefill?.name ?? "");
  const [source, setSource] = useState<Source>(src?.kind ?? "tickers");
  const [list, setList] = useState(src?.kind === "tickers" ? src.tickers.join(", ") : (prefill?.tickers.join(", ") ?? ""));
  const [filter, setFilter] = useState(src?.kind === "screener" ? src.screener.filters.join(", ") : "");
  const [top, setTop] = useState<"25" | "50">(src?.kind === "screener" ? (String(src.top) as "25" | "50") : "25");
  const [error, setError] = useState<string | null>(null);
  const tickers = parseTickers(list);
  const screener = parseScreenerInput(filter);
  const sector = sectorOf(filter);

  const problem = !name.trim() ? t("config.nameRequired")
    : kind === "themes" ? null
      : source === "tickers"
        ? tickers.invalid.length ? t("config.invalid", { list: tickers.invalid.join(", ") })
          : !tickers.tickers.length ? t("config.needOne")
            : tickers.tickers.length > MAX_BOARD_TICKERS ? t("config.tooMany", { max: MAX_BOARD_TICKERS }) : null
        : screener.ok ? null
          : screener.reason === "tooMany" ? t("my.filterTooMany", { max: MAX_SCREENER_FILTERS })
            : screener.reason === "invalid" ? t("my.filterInvalid", { list: (screener.bad ?? []).join(", ") }) : t("my.filterEmpty");

  const pickSector = (code: string) => {
    const next = SECTORS.find((s) => s.code === code);
    if (!next) return;
    const rest = filter.split(/[\s,;]+/).filter((x) => x && !SECTORS.some((s) => s.code === x.toLowerCase()));
    setFilter([next.code, ...rest].join(", "));
    if (!name.trim() || name === sector?.name) setName(next.name);
  };
  const addTheme = (id: string) => {
    const th = themes.find((x) => String(x.id) === id);
    if (!th) return;
    setList([...new Set([...tickers.tickers, ...themeTickerList(th)])].join(", "));
    if (!name.trim()) setName(th.name);
  };

  const submit = async () => {
    if (problem) return;
    setError(null);
    const draft: BoardDraft = { name: name.trim() };
    if (!initial) draft.kind = kind;
    if (kind === "tickers") {
      if (source === "tickers") draft.tickers = tickers.tickers;
      else Object.assign(draft, { screener: filter, order: src?.kind === "screener" ? src.screener.order : null, top: Number(top) as 25 | 50 });
    }
    try {
      const saved = await save.mutateAsync({ id: initial?.id ?? null, draft });
      onDone(saved);
    } catch (err) {
      setError(humanizeApiError(err, t("config.failed")));
    }
  };

  const hint = (text: string, bad = false) => <p className={cn("text-xs", bad ? "text-warn" : "text-muted-foreground")}>{text}</p>;

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {!initial && (
        <Segmented ariaLabel={t("boards.kindAria")} value={kind} onChange={setKind}
          options={[{ value: "themes", label: t("boards.kinds.themes") }, { value: "tickers", label: t("boards.kinds.tickers") }]} />
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="board-name">{t("config.name")}</Label>
        <Input id="board-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus={!initial && !prefill} />
      </div>
      {kind === "themes" ? hint(t("boards.themesHint")) : (
        <>
          <Segmented size="sm" ariaLabel={t("boards.sourceAria")} value={source} onChange={setSource}
            options={[{ value: "tickers", label: t("boards.sources.tickers") }, { value: "screener", label: t("boards.sources.screener") }]} />
          {source === "tickers" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="board-tickers">{t("config.tickers")}</Label>
              <Textarea id="board-tickers" rows={3} className="font-mono text-sm uppercase" value={list} onChange={(e) => setList(e.target.value)} />
              {hint(problem && list.trim() ? problem : t("boards.tickersHint", { n: tickers.tickers.length, max: MAX_BOARD_TICKERS }), !!problem && !!list.trim())}
              {themes.length > 0 && (
                <Select value="" onValueChange={addTheme}>
                  <SelectTrigger aria-label={t("boards.addTheme")} className="h-8 text-xs"><SelectValue placeholder={t("boards.addTheme")} /></SelectTrigger>
                  <SelectContent>{themes.map((th) => <SelectItem key={th.id} value={String(th.id)}>{th.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Select value={sector?.code ?? ""} onValueChange={pickSector}>
                <SelectTrigger aria-label={t("my.sector")}><SelectValue placeholder={t("my.sectorPick")} /></SelectTrigger>
                <SelectContent>{SECTORS.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              <Label htmlFor="board-filter">{t("my.filter")}</Label>
              <Textarea id="board-filter" rows={2} className="font-mono text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} />
              {hint(filter.trim() ? (problem ?? t("my.filterOk", { list: screener.ok ? screener.spec.filters.join(", ") : "" })) : t("boards.screenerHint"), !!filter.trim() && !!problem)}
              <Segmented size="sm" ariaLabel={t("boards.topAria")} value={top} onChange={setTop}
                options={[{ value: "25", label: t("boards.top", { n: 25 }) }, { value: "50", label: t("boards.top", { n: 50 }) }]} />
              {!finviz && hint(t("my.needsFinviz"), true)}
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-xs text-down">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone(null)}>{commonI18n.t("actions.cancel")}</Button>
        <Button type="submit" size="sm" disabled={!!problem || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {initial ? commonI18n.t("actions.save") : t("boards.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** `editing`: undefined = closed, null = a new board (optionally prefilled), a board = edit it. */
export function BoardDialog({ editing, prefill, themes, finviz, onClose }: {
  editing: BoardMeta | null | undefined; prefill: BoardPrefill | null; themes: readonly ThemeOut[]; finviz: boolean; onClose: (saved: BoardMeta | null) => void;
}) {
  const { t } = themesI18n.useT();
  return (
    <Dialog open={editing !== undefined} onOpenChange={(o) => { if (!o) onClose(null); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t("boards.editTitle") : t("boards.newTitle")}</DialogTitle>
          <DialogDescription>{t("boards.desc")}</DialogDescription>
        </DialogHeader>
        {editing !== undefined && <BoardForm key={editing?.id ?? `new-${prefill?.name ?? ""}`} initial={editing} prefill={prefill} themes={themes} finviz={finviz} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
