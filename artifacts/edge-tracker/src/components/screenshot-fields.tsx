import React, { useState, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Plus, X, ExternalLink, StickyNote, Pencil, Check, ChevronLeft, ChevronRight, ZoomIn, Maximize2 } from "lucide-react";

interface ScreenshotFieldsProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  notes?: string[];
  onNotesChange?: (notes: string[]) => void;
}

export function screenshotUrlsToString(urls: string[]): string {
  return urls.filter(Boolean).join("\n");
}

export function stringToScreenshotUrls(s: string | null | undefined): string[] {
  if (!s) return [""];
  const parsed = s.split("\n").map((u) => u.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : [""];
}

export function screenshotNotesToString(notes: string[]): string {
  return JSON.stringify(notes);
}

export function stringToScreenshotNotes(s: string | null | undefined, count: number): string[] {
  if (!s) return Array(count).fill("");
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      while (parsed.length < count) parsed.push("");
      return parsed.slice(0, count).map((n: unknown) => typeof n === "string" ? n : "");
    }
  } catch {}
  const legacy = s.split("\n");
  while (legacy.length < count) legacy.push("");
  return legacy.slice(0, count);
}

export function ScreenshotFields({ urls, onChange, notes, onNotesChange }: ScreenshotFieldsProps) {
  const notesList = notes || urls.map(() => "");

  function setUrl(idx: number, val: string) {
    const next = [...urls];
    next[idx] = val;
    onChange(next);
  }

  function setNote(idx: number, val: string) {
    if (!onNotesChange) return;
    const next = [...notesList];
    while (next.length <= idx) next.push("");
    next[idx] = val;
    onNotesChange(next);
  }

  function addField() {
    onChange([...urls, ""]);
    if (onNotesChange) onNotesChange([...notesList, ""]);
  }

  function removeField(idx: number) {
    const nextUrls = urls.filter((_, i) => i !== idx);
    onChange(nextUrls.length > 0 ? nextUrls : [""]);
    if (onNotesChange) {
      const nextNotes = notesList.filter((_, i) => i !== idx);
      onNotesChange(nextNotes.length > 0 ? nextNotes : [""]);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5">
        <Camera className="h-3 w-3" />Screenshots
      </Label>
      {urls.map((url, idx) => (
        <div key={idx} className="space-y-1">
          <div className="flex gap-1">
            <Input
              value={url}
              onChange={(e) => setUrl(idx, e.target.value)}
              placeholder="https://i.imgur.com/... or any URL"
              className="font-mono bg-background h-8 text-xs flex-1"
            />
            {urls.length > 1 && (
              <button
                type="button"
                onClick={() => removeField(idx)}
                className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {url && (
            <div className="flex items-start gap-2 ml-1">
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-[10px] shrink-0 mt-1">
                <ExternalLink className="h-2.5 w-2.5" /> Open
              </a>
              <img
                src={url}
                alt=""
                className="max-h-24 max-w-[200px] object-contain border border-border"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
          {onNotesChange && url && (
            <div className="ml-1">
              <textarea
                value={notesList[idx] || ""}
                onChange={(e) => setNote(idx, e.target.value)}
                rows={1}
                placeholder="Заметка к скриншоту..."
                className="w-full bg-background border border-border text-xs font-mono px-2 py-1 resize-none text-foreground"
              />
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addField}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-mono transition-colors"
      >
        <Plus className="h-3 w-3" /> Add screenshot
      </button>
    </div>
  );
}

function Lightbox({ urls, notes, initialIndex, onClose }: {
  urls: string[];
  notes: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initialIndex);

  const goNext = useCallback(() => setIdx((i) => (i + 1) % urls.length), [urls.length]);
  const goPrev = useCallback(() => setIdx((i) => (i - 1 + urls.length) % urls.length), [urls.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white z-10 p-2">
        <X className="h-6 w-6" />
      </button>

      <div className="absolute top-4 left-4 text-white/50 text-xs font-mono z-10">
        {idx + 1} / {urls.length}
      </div>

      {urls.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white p-3 bg-white/5 hover:bg-white/10 transition-colors z-10"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white p-3 bg-white/5 hover:bg-white/10 transition-colors z-10"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        </>
      )}

      <div className="flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img
          src={urls[idx]}
          alt={`Screenshot ${idx + 1}`}
          className="max-w-[90vw] max-h-[80vh] object-contain select-none"
          draggable={false}
        />
        {notes[idx] && (
          <div className="text-white/70 text-xs font-mono bg-white/5 border border-white/10 px-4 py-2 max-w-xl text-center">
            <StickyNote className="h-3 w-3 text-yellow-400 inline mr-1.5" />
            {notes[idx]}
          </div>
        )}
      </div>

      {urls.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          {urls.map((url, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setIdx(i); }}
              className={`w-12 h-8 border-2 overflow-hidden transition-all ${i === idx ? "border-primary opacity-100 scale-110" : "border-white/20 opacity-50 hover:opacity-80"}`}
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ScreenshotDisplayProps {
  urls: string;
  notes?: string | null;
  onNotesChange?: (notes: string) => void;
}

export function ScreenshotDisplay({ urls, notes, onNotesChange }: ScreenshotDisplayProps) {
  const list = urls.split("\n").map((u) => u.trim()).filter(Boolean);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  if (!list.length) return null;

  const notesList = stringToScreenshotNotes(notes, list.length);

  return (
    <>
      <div className="space-y-3">
        <div className="text-muted-foreground uppercase text-[10px] flex items-center gap-1 font-mono">
          <Camera className="h-3 w-3" />Screenshots ({list.length})
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((url, i) => (
            <ScreenshotItem
              key={i}
              url={url}
              index={i}
              note={notesList[i] || ""}
              onNoteChange={onNotesChange ? (newNote) => {
                const updated = [...notesList];
                updated[i] = newNote;
                onNotesChange(screenshotNotesToString(updated));
              } : undefined}
              onZoom={() => setLightboxIdx(i)}
            />
          ))}
        </div>
      </div>
      {lightboxIdx !== null && (
        <Lightbox
          urls={list}
          notes={notesList}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  );
}

function ScreenshotItem({ url, index, note, onNoteChange, onZoom }: {
  url: string;
  index: number;
  note: string;
  onNoteChange?: (note: string) => void;
  onZoom: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  function save() {
    onNoteChange?.(draft);
    setEditing(false);
  }

  function startEdit() {
    setDraft(note);
    setEditing(true);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-[10px]">
          <ExternalLink className="h-2.5 w-2.5" /> #{index + 1}
        </a>
        <button onClick={onZoom} className="text-muted-foreground hover:text-primary transition-colors" title="Увеличить">
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
      <div className="relative group cursor-pointer" onClick={onZoom}>
        <img
          src={url}
          alt={`Screenshot ${index + 1}`}
          className="max-h-64 w-full object-contain border border-border transition-all group-hover:border-primary/50"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-70 transition-opacity drop-shadow-lg" />
        </div>
      </div>
      {editing ? (
        <div className="flex gap-1 items-start mt-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
            className="flex-1 bg-background border border-border text-xs font-mono px-2 py-1 resize-none text-foreground"
            placeholder="Заметка к скриншоту..."
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
          />
          <button onClick={save} className="p-1 text-emerald-400 hover:text-emerald-300 shrink-0" title="Сохранить">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setEditing(false)} className="p-1 text-muted-foreground hover:text-foreground shrink-0" title="Отмена">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-1 mt-0.5 group/note">
          {note ? (
            <div className="flex-1 text-xs font-mono text-muted-foreground bg-muted/30 border border-border/50 px-2 py-1 flex items-start gap-1.5">
              <StickyNote className="h-3 w-3 text-yellow-400 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap flex-1">{note}</span>
              {onNoteChange && (
                <button onClick={startEdit} className="opacity-0 group-hover/note:opacity-100 p-0.5 text-muted-foreground hover:text-primary transition-opacity shrink-0">
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          ) : onNoteChange ? (
            <button onClick={startEdit} className="text-[10px] font-mono text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
              <StickyNote className="h-3 w-3" /> Добавить заметку
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
