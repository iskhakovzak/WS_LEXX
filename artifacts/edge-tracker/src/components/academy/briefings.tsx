/**
 * «Брифинги» in /academy/learn: the Academy's briefing recordings (lessons with a recording, theme tags and «must
 * watch» — api routes/academy-briefings.ts). A junior sees «must watch: N left» first and marks a recording watched
 * (the lesson's own progress); curators see per recording how many juniors watched it and who did not. Tag chips
 * filter (the five desk themes first); curators and seniors add a recording.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, ExternalLink, Plus, Video } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { personName } from "@/i18n";
import { briefingsI18n } from "@/i18n/ns/briefings";
import { VideoPlayer } from "./content/bits";
import { BriefingAdd } from "./briefing-add";
import { briefingsQuery, mediaUrlQuery, useBriefingMutations, type Briefing, type WatchRow } from "./briefings-api";

function MediaPlayer({ id, title }: { id: number; title: string }) {
  const q = useQuery(mediaUrlQuery(id));
  if (!q.data) return <div className="aspect-video w-full animate-pulse rounded-2xl bg-[var(--glass-bg)] motion-reduce:animate-none" aria-hidden="true" />;
  return <video src={q.data.url} controls preload="metadata" className="aspect-video w-full rounded-2xl bg-black/40" aria-label={title} />;
}

function Item({ b, progress }: { b: Briefing; progress: WatchRow | null }) {
  const { t } = briefingsI18n.useT();
  const mut = useBriefingMutations();
  const [open, setOpen] = React.useState(false);
  return (
    <li className={cn("rounded-xl border border-[var(--glass-border)] p-3", b.watched && "opacity-75")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{b.title}</button>
        {b.mustWatch && <Pill tone="warn">{t("must")}</Pill>}
        {b.watched && <span className="inline-flex items-center gap-1 text-xs text-up"><Check className="h-3.5 w-3.5" aria-hidden="true" />{t("watched")}</span>}
        {b.durationMin != null && <span className="text-xs text-muted-foreground">{b.durationMin}′</span>}
        <span className="ml-auto flex flex-wrap gap-1">{b.tags.map((x) => <span key={x} className="text-xs text-primary">#{x}</span>)}</span>
      </div>
      {b.summary && <p className="mt-1 text-sm text-muted-foreground">{b.summary}</p>}
      {b.setups.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
          {b.setups.map((s) => <Link key={s.id} href={links.setup(s.id)} className="rounded-md border border-border px-1.5 py-0.5 hover:bg-[var(--glass-hover-bg)]">{s.name}</Link>)}
        </p>
      )}
      {progress && (
        <p className="mt-1 text-xs text-muted-foreground" title={progress.missing.length ? t("missing", { names: progress.missing.map(personName).join(", ") }) : undefined}>
          {t("progress", { watched: progress.watched, total: progress.juniors })}
          {progress.missing.length > 0 && progress.missing.length <= 6 && ` · ${t("missing", { names: progress.missing.map(personName).join(", ") })}`}
        </p>
      )}
      {open && (
        <div className="mt-2">
          {b.video ? <VideoPlayer video={b.video} title={b.title} /> : b.mediaId != null ? <MediaPlayer id={b.mediaId} title={b.title} /> : null}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {b.mediaLink && (
          <Button size="sm" variant="outline" asChild>
            <a href={b.mediaLink} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{t("openFile")}</a>
          </Button>
        )}
        {!b.mediaLink && !open && (b.video || b.mediaId != null) && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Video aria-hidden="true" />{t("openFile")}</Button>
        )}
        <Button size="sm" variant={b.watched ? "ghost" : "default"} disabled={mut.watched.isPending} onClick={() => mut.watched.mutate({ lessonId: b.lessonId, completed: !b.watched })}>
          {b.watched ? t("unmarkWatched") : t("markWatched")}
        </Button>
      </div>
    </li>
  );
}

export function BriefingsLibrary() {
  const { t } = briefingsI18n.useT();
  const [tag, setTag] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const q = useQuery(briefingsQuery(tag));
  const data = q.data;
  const progress = React.useMemo(() => new Map((data?.progress ?? []).map((p) => [p.lessonId, p])), [data]);
  const tags = (data?.tags ?? []).filter((x) => x.count > 0 || ["tilt", "fomo", "g2r", "2ndday", "execution"].includes(x.tag));
  return (
    <Panel
      icon={Video}
      title={t("title")}
      description={t("description")}
      actions={data?.canAdd ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t("add.open")}</Button> : undefined}
    >
      {data && !data.progress && (
        <p className={cn("mb-3 rounded-xl px-3 py-2 text-sm", data.mustWatchLeft ? "bg-[hsl(var(--chart-3)/0.12)] text-foreground" : "bg-[var(--glass-bg)] text-muted-foreground")}>
          {data.mustWatchLeft ? t("mustLeft", { count: data.mustWatchLeft }) : t("mustDone")}
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label={t("add.tags")}>
        <button type="button" aria-pressed={tag == null} onClick={() => setTag(null)} className="chip inline-flex h-7 items-center px-2 text-xs font-medium">{t("allTags")}</button>
        {tags.map((x) => (
          <button key={x.tag} type="button" aria-pressed={tag === x.tag} onClick={() => setTag(tag === x.tag ? null : x.tag)} className="chip inline-flex h-7 items-center px-2 text-xs font-medium">
            #{x.tag}{x.count ? ` · ${x.count}` : ""}
          </button>
        ))}
      </div>
      {q.isLoading ? <ListSkeleton rows={3} /> : q.isError ? (
        <ErrorState compact error={q.error} onRetry={q.refetch} title={t("loadFailed")} />
      ) : !data?.items.length ? (
        <EmptyState compact icon={Video} title={data?.canAdd ? t("emptyStaff") : t("empty")} action={data?.canAdd ? <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t("add.open")}</Button> : undefined} />
      ) : (
        <ul className="flex flex-col gap-2">{data.items.map((b) => <Item key={b.lessonId} b={b} progress={progress.get(b.lessonId) ?? null} />)}</ul>
      )}
      {adding && <BriefingAdd onClose={() => setAdding(false)} initialTag={tag} />}
    </Panel>
  );
}
