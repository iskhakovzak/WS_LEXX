/**
 * «Новая запись брифинга» (curators and seniors): a title, the recording — a file (the voice-note upload limit) or a
 * link (YouTube / Vimeo / Loom plays inline, any other link opens the internal file) — theme tags (the five desk themes
 * one tap away, own ones typed), playbook setups and «must watch». Two required fields; the rest is optional.
 */
import * as React from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ds";
import { SetupPicker } from "@/components/shared/setup-picker";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { briefingsI18n } from "@/i18n/ns/briefings";
import { MEDIA_MAX_MB, useBriefingMutations } from "./briefings-api";

const THEMES = ["tilt", "fomo", "g2r", "2ndday", "execution"] as const;
const tagsOf = (raw: string) => [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase().replace(/^#+/, "")).filter((s) => /^[a-z0-9][a-z0-9_-]{0,23}$/.test(s)))];

export function BriefingAdd({ onClose, initialTag }: { onClose: () => void; initialTag?: string | null }) {
  const { t } = briefingsI18n.useT();
  const { toast } = useToast();
  const mut = useBriefingMutations();
  const [title, setTitle] = React.useState("");
  const [mode, setMode] = React.useState<"upload" | "link">("link");
  const [link, setLink] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [tags, setTags] = React.useState<string[]>(initialTag ? [initialTag] : []);
  const [own, setOwn] = React.useState("");
  const [setups, setSetups] = React.useState<{ id: number; name: string }[]>([]);
  const [mustWatch, setMustWatch] = React.useState(false);
  const busy = mut.upload.isPending || mut.create.isPending;
  const hasSource = mode === "link" ? /^https?:\/\/\S+$/.test(link.trim()) : !!file && file.size <= MEDIA_MAX_MB * 1024 * 1024;
  const valid = !!title.trim() && hasSource;
  const toggleTag = (x: string) => setTags((cur) => (cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      const mediaId = mode === "upload" && file ? (await mut.upload.mutateAsync(file)).id : null;
      await mut.create.mutateAsync({
        title: title.trim(), tags: [...new Set([...tags, ...tagsOf(own)])], playbookIds: setups.map((s) => s.id), mustWatch,
        videoUrl: mode === "link" ? link.trim() : null, mediaId,
      });
      toast({ title: t("add.saved") });
      onClose();
    } catch (err) {
      toast({ title: t("add.saveFailed"), description: humanizeApiError(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="md">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader><DialogTitle>{t("add.title")}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="brief-title">{t("add.name")}</Label>
            <Input id="brief-title" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("add.source")}</span>
            <Segmented<"upload" | "link"> size="sm" ariaLabel={t("add.source")} value={mode} onChange={setMode}
              options={[{ value: "link", label: t("add.link") }, { value: "upload", label: t("add.upload") }]} />
            {mode === "link" ? (
              <Input value={link} maxLength={1000} placeholder={t("add.linkPlaceholder")} onChange={(e) => setLink(e.target.value)} aria-label={t("add.link")} />
            ) : (
              <>
                <Input type="file" accept="video/mp4,video/webm,video/quicktime,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={t("add.upload")} />
                <span className="text-xs text-muted-foreground">{t("add.file", { mb: MEDIA_MAX_MB })}</span>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("add.tags")}</span>
            <div className="flex flex-wrap gap-1">
              {THEMES.map((x) => (
                <button key={x} type="button" aria-pressed={tags.includes(x)} onClick={() => toggleTag(x)} className="chip inline-flex h-7 items-center px-2 text-xs font-medium">#{x}</button>
              ))}
              {tags.filter((x) => !(THEMES as readonly string[]).includes(x)).map((x) => (
                <button key={x} type="button" aria-pressed onClick={() => toggleTag(x)} className="chip inline-flex h-7 items-center px-2 text-xs font-medium">#{x}</button>
              ))}
            </div>
            <Input value={own} maxLength={120} placeholder={t("add.tagsHint")} onChange={(e) => setOwn(e.target.value)} aria-label={t("add.tagsHint")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("add.setups")}</span>
            <div className="flex flex-wrap items-center gap-1">
              {setups.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {s.name}
                  <button type="button" aria-label={s.name} onClick={() => setSetups((cur) => cur.filter((x) => x.id !== s.id))}><X className="h-3 w-3" aria-hidden="true" /></button>
                </span>
              ))}
              {setups.length < 10 && <SetupPicker value={null} onChange={(c) => c && setSetups((cur) => (cur.some((x) => x.id === c.id) ? cur : [...cur, c]))} />}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={mustWatch} onCheckedChange={(v) => setMustWatch(v === true)} />
            {t("add.mustWatch")}
          </label>
          {!hasSource && (link || file) && <p className="text-xs text-muted-foreground">{t("add.needSource")}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t("add.cancel")}</Button>
            <Button type="submit" disabled={!valid || busy}>{mut.upload.isPending ? t("add.uploading") : t("add.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
