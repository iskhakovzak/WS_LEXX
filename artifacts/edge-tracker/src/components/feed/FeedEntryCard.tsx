import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bookmark, BookmarkCheck, Copy, Pencil, Trash2, TrendingUp, TrendingDown, Circle, CheckCheck, Hash, CheckCircle2, Crosshair, Eye, UserRound } from "lucide-react";
import { AddToPlaybookButton, type PlaybookPayload } from "@/components/add-to-playbook";
import { Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import { FeedGallery } from "./FeedGallery";
import { hasServerAcks, parseShots, parseTickers, pluralRu, splitList, type AckKind, type FeedEntry } from "./feed-utils";

/** «Принято» / «Торгую это» — per-trader acks from the server; names on hover. */
function AckChip({ kind, icon: Icon, label, acks, me, onAck }: {
  kind: Exclude<AckKind, "read">; icon: React.ElementType; label: string; acks: FeedEntry["acks"]; me: string; onAck?: (kind: Exclude<AckKind, "read">) => void;
}) {
  if (!acks) return null;
  const on = acks.mine.includes(kind);
  const n = acks.counts[kind] ?? 0;
  const users = acks.users[kind] ?? [];
  const others = users.filter((u) => u !== me);
  const title = n === 0 ? label : `${label}: ${[on ? "вы" : null, ...others].filter(Boolean).join(", ")}`;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!onAck}
      title={title}
      onClick={(e) => { e.stopPropagation(); onAck?.(kind); }}
      className={cn(
        "chip inline-flex min-h-7 items-center gap-1 px-2.5 text-xs disabled:cursor-default disabled:opacity-70",
        on && "border-primary/50 text-primary",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
      {n > 0 && <span className="tabular-nums text-muted-foreground">{n}</span>}
    </button>
  );
}

/** Highlights case-insensitive matches of `q` inside `text`. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) { parts.push(text.slice(i)); break; }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={k++} className="rounded-sm bg-primary/25 px-0.5 text-foreground">{text.slice(at, at + needle.length)}</mark>);
    i = at + needle.length;
  }
  return <>{parts}</>;
}

function IconBtn({ label, onClick, children, active, className }: {
  label: string; onClick: () => void; children: React.ReactNode; active?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "text-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Notes({ text, q }: { text: string; q: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split("\n").length > 5;
  return (
    <div>
      <p className={cn("whitespace-pre-wrap text-sm leading-relaxed text-foreground/90", !open && long && "line-clamp-4")}>
        <Hl text={text} q={q} />
      </p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs font-medium text-primary hover:underline">
          {open ? "Свернуть" : "Читать полностью"}
        </button>
      )}
    </div>
  );
}

export type FeedEntryCardProps = {
  feed: FeedEntry;
  unread: boolean;
  /** Signed-in trader (for «вы» in ack tooltips and the author chip). */
  me?: string;
  /** Toggle «Принято» / «Торгую это»; absent for read-only viewers. */
  onAck?: (kind: Exclude<AckKind, "read">) => void;
  /** Auto-mark as read after the card has been on screen for a moment. */
  autoRead?: boolean;
  bookmarked: boolean;
  query: string;
  activeTickers: string[];
  activeTags: string[];
  tradedTickers?: Map<string, number>;
  canEdit: boolean;
  focused?: boolean;
  playbookPayload: PlaybookPayload;
  onToggleTicker: (t: string) => void;
  onToggleTag: (t: string) => void;
  onBookmark: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onNotesChange: (notes: string[]) => void;
};

export function FeedEntryCard(p: FeedEntryCardProps) {
  const { feed, unread, query: q } = p;
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);
  const tickers = parseTickers(feed.bestTickers);
  const tags = splitList(feed.tags);
  const shots = parseShots(feed.screenshotUrl, feed.screenshotNotes);
  const acks = hasServerAcks(feed) ? feed.acks : undefined;
  const me = p.me ?? "";
  const readers = acks ? acks.users.read.filter((u) => u !== me && u !== feed.createdBy) : [];
  const time = (() => {
    try { return new Date(feed.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
  })();

  // Mark as read once the card has been at least half-visible for ~1.5s.
  const onMarkReadRef = useRef(p.onMarkRead);
  onMarkReadRef.current = p.onMarkRead;
  useEffect(() => {
    if (!unread || p.autoRead === false || !ref.current || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) timer = setTimeout(() => onMarkReadRef.current(), 1500);
      else if (timer) { clearTimeout(timer); timer = null; }
    }, { threshold: 0.5 });
    io.observe(ref.current);
    return () => { io.disconnect(); if (timer) clearTimeout(timer); };
  }, [unread, p.autoRead]);

  useEffect(() => {
    if (p.focused && ref.current) ref.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [p.focused, reduce]);

  return (
    <motion.article
      ref={ref}
      id={`feed-${feed.id}`}
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label={`Запись ленты: ${feed.marketTheme || "без темы"}`}
      className={cn(
        "glass-panel relative overflow-hidden rounded-2xl",
        unread && "ring-1 ring-primary/50",
        p.focused && "ring-2 ring-primary",
      )}
    >
      {unread && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" aria-hidden="true" />}

      {/* header */}
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {unread && <Pill tone="accent" dot>Новое</Pill>}
            {p.bookmarked && <Pill tone="warn"><Bookmark className="h-3 w-3" aria-hidden="true" />В закладках</Pill>}
            {time && <span className="text-xs tabular-nums text-muted-foreground">добавлено {time}</span>}
            {feed.createdBy && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Автор записи">
                <UserRound className="h-3 w-3" aria-hidden="true" />{feed.createdBy === me ? "вы" : feed.createdBy}
              </span>
            )}
            {readers.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`Прочитали: ${readers.join(", ")}`}>
                <Eye className="h-3 w-3" aria-hidden="true" />{readers.length} {pluralRu(readers.length, "прочитал", "прочитали", "прочитали")}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
            {feed.marketTheme ? <Hl text={feed.marketTheme} q={q} /> : <span className="text-muted-foreground">Без темы</span>}
          </h3>
        </div>
        <div className="-mr-1 flex shrink-0 items-center">
          <IconBtn label={p.bookmarked ? "Убрать из закладок" : "В закладки"} active={p.bookmarked} onClick={p.onBookmark}>
            {p.bookmarked ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </IconBtn>
          <IconBtn label={unread ? "Отметить прочитанным" : "Отметить непрочитанным"} onClick={unread ? p.onMarkRead : p.onMarkUnread}>
            {unread ? <CheckCheck className="h-4 w-4" /> : <Circle className="h-3.5 w-3.5" />}
          </IconBtn>
          <IconBtn label="Скопировать текстом" onClick={p.onCopy}><Copy className="h-4 w-4" /></IconBtn>
        </div>
      </div>

      <div className="space-y-4 px-4 pb-4 pt-3 sm:px-5 [overflow-wrap:anywhere]">
        {/* tickers */}
        {tickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Тикеры дня">
            {tickers.map((t) => {
              const traded = p.tradedTickers?.get(t);
              const active = p.activeTickers.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => p.onToggleTicker(t)}
                  title={traded ? `Команда торговала ${t} в этот день: ${traded}` : `Фильтр по ${t}`}
                  className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-sm font-semibold tabular-nums text-foreground"
                >
                  <Hl text={t} q={q} />
                  {traded ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-up/15 px-1.5 text-xs font-semibold text-up">
                      {traded}×
                      <span className="sr-only"> сделок</span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {/* works / doesn't */}
        {(feed.whatWorksNow || feed.whatDoesntWork) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {feed.whatWorksNow && (
              <div className="rounded-xl border border-up/25 bg-up/[0.06] p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-up">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Что работает
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground"><Hl text={feed.whatWorksNow} q={q} /></p>
              </div>
            )}
            {feed.whatDoesntWork && (
              <div className="rounded-xl border border-down/25 bg-down/[0.06] p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-down">
                  <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" /> Что не работает
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground"><Hl text={feed.whatDoesntWork} q={q} /></p>
              </div>
            )}
          </div>
        )}

        {feed.notes && <Notes text={feed.notes} q={q} />}

        {shots.length > 0 && (
          <FeedGallery shots={shots} onNotesChange={p.canEdit ? p.onNotesChange : undefined} />
        )}

        {/* footer: tags + acks + write actions */}
        {(tags.length > 0 || p.canEdit || acks) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {acks && (
                <span className="mr-1 inline-flex items-center gap-1" role="group" aria-label="Реакции команды">
                  <AckChip kind="ack" icon={CheckCircle2} label="Принято" acks={acks} me={me} onAck={p.onAck} />
                  <AckChip kind="trading_this" icon={Crosshair} label="Торгую это" acks={acks} me={me} onAck={p.onAck} />
                </span>
              )}
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={p.activeTags.includes(t)}
                  onClick={() => p.onToggleTag(t)}
                  aria-label={`Фильтр по тегу ${t}`}
                  className="chip inline-flex min-h-7 items-center gap-0.5 px-2.5 text-xs"
                >
                  <Hash className="h-3 w-3" aria-hidden="true" />
                  <Hl text={t} q={q} />
                </button>
              ))}
            </div>
            {p.canEdit && (
              <div className="ml-auto flex items-center gap-0.5">
                <span className="grid h-8 w-8 place-items-center"><AddToPlaybookButton payload={p.playbookPayload} size="icon" /></span>
                <IconBtn label="Редактировать запись" onClick={p.onEdit}><Pencil className="h-4 w-4" /></IconBtn>
                <IconBtn label="Удалить запись" onClick={p.onDelete} className="hover:text-down"><Trash2 className="h-4 w-4" /></IconBtn>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.article>
  );
}
