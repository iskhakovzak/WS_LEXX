/** Small shared pieces of the learning UI: item icons/status, video player, attachments, setup → lessons link. */
import { BookOpen, CheckCircle2, CircleDashed, CircleDot, ClipboardCheck, ExternalLink, GraduationCap, ListChecks, Paperclip, PlayCircle } from "lucide-react";
import { Link } from "wouter";
import { Pill, type Tone } from "@/components/ds";
import { cn } from "@/lib/utils";
import { KIND_LABEL, useSetupLessons, type Attachment, type ItemKind, type ItemStatus, type SubmissionStatus, type VideoEmbed } from "./api";
import { academyLinks } from "./links";
import { PROVIDER_LABEL } from "./video";

export const KIND_ICON: Record<ItemKind, typeof BookOpen> = { lesson: BookOpen, quiz: ListChecks, assignment: ClipboardCheck };

export function KindIcon({ kind, className }: { kind: ItemKind; className?: string }) {
  const I = KIND_ICON[kind];
  return <I className={cn("h-4 w-4", className)} aria-label={KIND_LABEL[kind]} />;
}

const STATUS_META: Record<ItemStatus, { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  completed: { label: "Пройдено", tone: "up", icon: CheckCircle2 },
  in_progress: { label: "В процессе", tone: "warn", icon: CircleDot },
  not_started: { label: "Не начато", tone: "neutral", icon: CircleDashed },
};

export function StatusIcon({ status, className }: { status: ItemStatus; className?: string }) {
  const m = STATUS_META[status];
  const I = m.icon;
  return (
    <I
      className={cn("h-4 w-4 shrink-0", status === "completed" ? "text-up" : status === "in_progress" ? "text-[hsl(var(--chart-3))]" : "text-muted-foreground", className)}
      aria-label={m.label}
      role="img"
    />
  );
}

export function StatusPill({ status }: { status: ItemStatus }) {
  const m = STATUS_META[status];
  return <Pill tone={m.tone} dot>{m.label}</Pill>;
}

export const SUBMISSION_META: Record<SubmissionStatus, { label: string; tone: Tone }> = {
  submitted: { label: "На проверке", tone: "accent" },
  graded: { label: "Проверено", tone: "up" },
  returned: { label: "На доработке", tone: "warn" },
};

export function SubmissionPill({ status, passed }: { status: SubmissionStatus; passed?: boolean | null }) {
  if (status === "graded" && passed === false) return <Pill tone="down" dot>Не зачтено</Pill>;
  const m = SUBMISSION_META[status];
  return <Pill tone={m.tone} dot>{status === "graded" ? "Зачтено" : m.label}</Pill>;
}

export function VideoPlayer({ video, title }: { video: VideoEmbed; title: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-black/40">
      <div className="relative aspect-video w-full">
        <iframe
          src={video.embedUrl}
          title={`Видео: ${title}`}
          className="absolute inset-0 h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />{PROVIDER_LABEL[video.provider]}</span>
        <a href={video.watchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
          Открыть на {PROVIDER_LABEL[video.provider]} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}

export function AttachmentList({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Материалы урока">
      {items.map((a, i) => (
        <li key={i}>
          <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="glass-field inline-flex max-w-full items-center gap-2 px-3 py-1.5 text-sm hover:text-primary">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{a.title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Drop-in for the trade sheet / playbook card: «Как торговать этот сетап» — lessons linked to a playbook setup
 * (by playbook id, or by setup name). Renders nothing when there are no linked lessons.
 * Usage: <SetupLessonsLink playbookId={trade.playbookId} setup={trade.setup} />
 */
export function SetupLessonsLink({ playbookId, setup, className, compact = false }: { playbookId?: number | null; setup?: string | null; className?: string; compact?: boolean }) {
  const q = useSetupLessons(playbookId ?? null, setup ?? null);
  const lessons = q.data?.lessons ?? [];
  if (!lessons.length) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {!compact && (
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" /> Как торговать этот сетап
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {lessons.slice(0, compact ? 2 : 5).map((l) => (
          <li key={l.id}>
            <Link href={academyLinks.item("lesson", l.id)} className="chip inline-flex min-h-7 items-center gap-1.5 px-2.5 text-xs font-medium" title={`${l.programTitle}${l.summary ? ` — ${l.summary}` : ""}`}>
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {l.title}
              {l.durationMin ? <span className="tabular-nums text-muted-foreground">{l.durationMin} мин</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PctBar({ pct, className, label }: { pct: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label ?? "Прогресс"}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", v >= 100 ? "bg-up" : "bg-primary")} style={{ width: `${v}%` }} />
    </div>
  );
}

export const fmtMoney = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtR = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "R —" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}R`);
export const toneOfNum = (v: number | null | undefined): Tone => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");
