import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateDiscussion, getListDiscussionsQueryKey } from "@workspace/api-client-react";
import { Eye, PencilLine, Sparkles, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ds";
import { TagSelector } from "@/components/tag-selector";
import { VoiceRecorder } from "@/components/voice-recorder";
import { ScreenshotFields } from "@/components/screenshot-fields";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { RichText } from "./RichText";
import { AudiencePicker } from "./AudiencePicker";
import { sortTokens, useAudienceOptions } from "./audience";
import { Pill } from "@/components/ds";
import { TYPES, TYPE_LABELS, TEMPLATES, type Thread, type ThreadContext, splitNotes, joinNotes, userTags, hasTag, TAG_PINNED, TAG_RESOLVED } from "./lib";

type FormState = { topic: string; type: string; ticker: string; notes: string; tags: string[]; screenshotUrls: string[]; audience: string[] };

const blank = (ticker = "", type = "general"): FormState => ({ topic: "", type, ticker, notes: "", tags: [], screenshotUrls: [""], audience: [] });

function contextLabel(c: ThreadContext | undefined): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.tradeId) parts.push(`сделка #${c.tradeId}`);
  if (c.eventId) parts.push(`событие #${c.eventId}`);
  if (c.ideaId) parts.push(`идея #${c.ideaId}`);
  if (c.playbookId) parts.push(`сетап #${c.playbookId}`);
  if (c.journalDate) parts.push(`день ${c.journalDate}`);
  return parts.length ? parts.join(" · ") : null;
}

export function ThreadFormDialog({ open, editing, author, defaultTicker, defaultType, context, knownTickers, onClose, onSaved }: {
  open: boolean;
  editing: Thread | null;
  author: string;
  defaultTicker?: string;
  defaultType?: string;
  /** Contextual thread: ids from `?tradeId=` etc. — sent on create, shown as a pill. */
  context?: ThreadContext;
  knownTickers: Set<string>;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = React.useState<FormState>(blank());
  const [preview, setPreview] = React.useState<"write" | "preview">("write");
  const [patching, setPatching] = React.useState(false);
  const audienceQ = useAudienceOptions(open);

  React.useEffect(() => {
    if (!open) return;
    setPreview("write");
    if (editing) {
      const { text, images } = splitNotes(editing.notes);
      setForm({
        topic: editing.topic,
        type: editing.type || "general",
        ticker: editing.ticker ?? "",
        notes: text,
        tags: userTags(editing.tags),
        screenshotUrls: images.length ? images : [""],
        audience: sortTokens(editing.audience ?? []),
      });
    } else {
      setForm(blank(defaultTicker ?? "", defaultType && (TYPES as readonly string[]).includes(defaultType) ? defaultType : context?.tradeId ? "review_request" : "general"));
    }
  }, [open, editing, defaultTicker, defaultType, context?.tradeId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListDiscussionsQueryKey() });
    qc.invalidateQueries({ queryKey: ["discussions-tickers"] });
    qc.invalidateQueries({ queryKey: ["shell", "discussions-unread"] });
  };

  const createMut = useCreateDiscussion({
    mutation: {
      onSuccess: (d) => { invalidate(); toast({ title: "Тема создана" }); onSaved(d.id); onClose(); },
      onError: (e: unknown) => toast({ title: "Ошибка", description: (e as { data?: { error?: string } })?.data?.error ?? String(e), variant: "destructive" }),
    },
  });

  const busy = createMut.isPending || patching;
  const topic = form.topic.trim();
  const canSave = !!topic && topic.length <= 300 && !busy;

  async function save() {
    if (!canSave) return;
    const notes = joinNotes(form.notes, form.screenshotUrls) || null;
    const ticker = form.ticker.trim().toUpperCase() || null;
    if (!editing) {
      // Author is always the signed-in user (server ignores any claimed `trader`); context ids are extra fields.
      const ctx = context ? Object.fromEntries(Object.entries(context).filter(([, v]) => v != null && v !== "")) : {};
      createMut.mutate({ data: { topic, type: form.type, ticker, notes, tags: form.tags.join(", ") || null, audience: form.audience, ...ctx } as Parameters<typeof createMut.mutate>[0]["data"] });
      return;
    }
    // Keep reserved flags (pinned/resolved) when editing user tags.
    const flags = [hasTag(editing.tags, TAG_PINNED) && TAG_PINNED, hasTag(editing.tags, TAG_RESOLVED) && TAG_RESOLVED].filter(Boolean) as string[];
    setPatching(true);
    try {
      const r = await fetch(`${BASE}/api/discussions/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, type: form.type, ticker, notes, tags: [...form.tags, ...flags].join(", "), audience: form.audience }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "Не удалось сохранить");
      invalidate();
      toast({ title: "Тема обновлена" });
      onSaved(editing.id);
      onClose();
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setPatching(false);
    }
  }

  function applyTemplate() {
    const tpl = TEMPLATES[form.type] ?? "";
    if (!tpl) return;
    set("notes", form.notes.trim() ? `${form.notes.trim()}\n\n${tpl}` : tpl);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактировать тему" : "Новая тема"}</DialogTitle>
          <DialogDescription>Автор: {editing?.trader ?? author}. Используйте $TICKER и @имя — они станут ссылками; @упоминание придёт в уведомления.</DialogDescription>
          {!editing && contextLabel(context) && <Pill tone="accent" className="w-fit text-2xs">Контекст: {contextLabel(context)}</Pill>}
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="disc-topic" className="text-xs text-muted-foreground">Тема</Label>
            <Input id="disc-topic" autoFocus value={form.topic} maxLength={300} onChange={(e) => set("topic", e.target.value)} placeholder="NVDA: фиксировать перед отчётом?" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
            <div className="min-w-0 space-y-1.5">
              <span className="block text-xs text-muted-foreground" id="disc-type-label">Тип</span>
              <Segmented
                ariaLabel="Тип темы"
                size="sm"
                value={form.type}
                onChange={(v) => set("type", v)}
                options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disc-ticker" className="text-xs text-muted-foreground">Тикер</Label>
              <Input id="disc-ticker" value={form.ticker} maxLength={10} list="disc-known-tickers" onChange={(e) => set("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, ""))} placeholder="NVDA" className="uppercase tabular-nums" />
              <datalist id="disc-known-tickers">{Array.from(knownTickers).map((t) => <option key={t} value={t} />)}</datalist>
            </div>
          </div>
          <AudiencePicker
            value={form.audience}
            onChange={(v) => set("audience", v)}
            options={audienceQ.data}
            me={editing?.trader ?? author}
            loading={audienceQ.isLoading}
          />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="disc-notes" className="text-xs text-muted-foreground">Описание</Label>
              <div className="flex items-center gap-1.5">
                {TEMPLATES[form.type] && (
                  <Button type="button" variant="ghost" size="sm" onClick={applyTemplate} className="gap-1"><Sparkles className="h-3.5 w-3.5" />Шаблон «{TYPE_LABELS[form.type]}»</Button>
                )}
                <VoiceRecorder onTranscript={(text) => set("notes", form.notes ? `${form.notes}\n${text}` : text)} />
                <Segmented<"write" | "preview">
                  ariaLabel="Режим описания"
                  size="sm"
                  value={preview}
                  onChange={setPreview}
                  options={[
                    { value: "write", label: <><PencilLine className="h-3.5 w-3.5" aria-hidden="true" />Текст</> },
                    { value: "preview", label: <><Eye className="h-3.5 w-3.5" aria-hidden="true" />Просмотр</> },
                  ]}
                />
              </div>
            </div>
            {preview === "write" ? (
              <Textarea id="disc-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={6} placeholder={"Контекст, уровни, вопрос к команде…\n**жирный**, `код`, > цитата, - список"}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }} />
            ) : (
              <div className="glass-field min-h-[150px] rounded-xl px-3.5 py-2.5">
                {form.notes.trim() ? <RichText text={form.notes} knownTickers={knownTickers} me={author} /> : <p className="text-sm text-muted-foreground">Нечего показать</p>}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Tag className="h-3 w-3" aria-hidden="true" />Теги</span>
            <TagSelector selectedTags={form.tags} onChange={(tags) => set("tags", tags)} />
          </div>
          <ScreenshotFields urls={form.screenshotUrls} onChange={(urls) => set("screenshotUrls", urls)} />
          <DialogFooter className="gap-2">
            <span className="mr-auto hidden self-center text-xs text-muted-foreground sm:inline">Ctrl+Enter — сохранить</span>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
            <Button type="submit" disabled={!canSave}>{busy ? "Сохраняем…" : editing ? "Сохранить" : "Создать тему"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
