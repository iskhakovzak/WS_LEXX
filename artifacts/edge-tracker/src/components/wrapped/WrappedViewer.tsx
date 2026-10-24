/**
 * «Итоги недели / месяца» — full-screen story viewer. Cards are drawn on a 1080×1920 canvas (what you see is the PNG you
 * save); progress bars on top auto-advance (paused by press-and-hold, by the pause button and under reduced motion);
 * tap right / left, arrow keys and swipes move, swipe down or Escape closes. The bottom bar saves the current card
 * (1080×1920) or the whole recap (1080×1350) — download, copy, share — while the desk switch shareCards.enabled is on.
 * Opened lazily by WrappedLaunch.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Copy, Download, Loader2, Palette, Pause, Play, Share2, X } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { shareCardI18n } from "@/i18n/ns/shareCard";
import { wrappedI18n } from "@/i18n/ns/wrapped";
import { cn } from "@/lib/utils";
import { canvasPng, loadCardFonts } from "@/components/shared/share-canvas/canvas";
import { canShareFiles, copyPng, downloadBlob, sharePng } from "@/components/shared/share-canvas/export";
import { STORY_H, STORY_W, SUMMARY_H, SUMMARY_W, drawStory, drawSummary } from "./render";
import { fileNameOf, periodLabel, periodTitle, storyAlt } from "./texts";
import { STORY_THEMES, useWrappedStory } from "./use-wrapped-story";
import { useStoryPlayer } from "./use-story-player";
import type { PeriodKind } from "./period";

const CARD_MS = 6500;

/**
 * One bar per card; the current one fills over CARD_MS (Web Animations, paused with the story) and a timer for the
 * time left calls `onDone` when it is full (a timer, not the animation's finish event: that one waits for a frame).
 */
function StoryBars({ count, index, running, onDone }: { count: number; index: number; running: boolean; onDone: () => void }) {
  const fill = React.useRef<HTMLSpanElement | null>(null);
  const anim = React.useRef<Animation | null>(null);
  const done = React.useRef(onDone);
  done.current = onDone;
  React.useEffect(() => {
    const el = fill.current;
    if (!el || typeof el.animate !== "function") return;
    const a = el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: CARD_MS, fill: "forwards", easing: "linear" });
    a.pause();
    anim.current = a;
    return () => { a.cancel(); anim.current = null; };
  }, [index, count]);
  React.useEffect(() => {
    const a = anim.current;
    if (!a || !running) { a?.pause(); return; }
    a.play();
    const left = Math.max(0, CARD_MS - Number(a.currentTime ?? 0));
    const timer = window.setTimeout(() => done.current(), left);
    return () => { window.clearTimeout(timer); if (anim.current === a) a.pause(); };
  }, [running, index, count]);
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/25">
          {i < index && <span className="absolute inset-0 bg-white" />}
          {i === index && <span ref={fill} className="absolute inset-0 origin-left scale-x-0 bg-white" />}
        </span>
      ))}
    </div>
  );
}

const iconBtn = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40";
const pillBtn = "inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40";

export default function WrappedViewer({ kind, periodKey, open, onOpenChange }: { kind: PeriodKind; periodKey: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = wrappedI18n.useT();
  const { t: ts } = shareCardI18n.useT();
  const { toast } = useToast();
  const reduce = useReducedMotion();
  const story = useWrappedStory(kind, periodKey);
  const count = story.texts.length;
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const player = useStoryPlayer(count, close);
  const [auto, setAuto] = React.useState(!reduce);
  const [target, setTarget] = React.useState<"card" | "summary">("card");
  const [busy, setBusy] = React.useState(false);
  const [fontsReady, setFontsReady] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const blobs = React.useRef<{ card: Blob | null; summary: Blob | null }>({ card: null, summary: null });
  const shareable = React.useMemo(canShareFiles, []);
  const i = Math.min(player.index, Math.max(0, count - 1));
  const texts = story.texts[i] ?? null;

  // Fonts with the glyphs the cards use (the name, the UI language's letters).
  const glyphs = `${story.name ?? ""} ${story.texts.map((x) => `${x.kicker} ${x.sub ?? ""}`).join(" ").slice(0, 400)}`;
  React.useEffect(() => {
    let alive = true;
    void loadCardFonts(glyphs).then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, [glyphs]);

  const { preload } = story;
  React.useEffect(() => { if (count) preload([i, i + 1, -1]); }, [preload, i, count]);

  const { backdropOf } = story;
  const bg = React.useMemo(() => backdropOf(i), [backdropOf, i]);
  const needsSeries = texts?.kind === "best" && story.seriesLoading;
  const ready = fontsReady && !!texts && !!bg && !needsSeries;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !ready || !texts || !bg) return;
    blobs.current.card = null;
    try {
      drawStory(ctx, { texts, series: texts.kind === "best" ? story.series : null, backdrop: bg.backdrop, credit: bg.credit });
    } catch {
      toast({ title: ts("toast.renderFailed"), variant: "destructive" });
      return;
    }
    // Keep a ready PNG: the share sheet must open inside the click (iOS drops the gesture across an await).
    let alive = true;
    void canvasPng(canvas).then((b) => { if (alive) blobs.current.card = b; });
    return () => { alive = false; };
  }, [ready, texts, bg, story.series, toast, ts]);

  // The summary card: drawn off-screen when it is the export target.
  const summaryBg = React.useMemo(() => backdropOf(-1), [backdropOf]);
  React.useEffect(() => {
    blobs.current.summary = null;
    if (target !== "summary" || !story.summary || !summaryBg || !fontsReady) return;
    const c = document.createElement("canvas");
    c.width = SUMMARY_W;
    c.height = SUMMARY_H;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    drawSummary(ctx, story.summary, summaryBg.backdrop, summaryBg.credit);
    let alive = true;
    void canvasPng(c).then((b) => { if (alive) blobs.current.summary = b; });
    return () => { alive = false; };
  }, [target, story.summary, summaryBg, fontsReady]);

  const period = story.period;
  const fileName = period ? fileNameOf(period, target === "summary" ? "summary" : i + 1) : "WS_Desk.png";
  const pngNow = async (): Promise<Blob | null> => {
    if (target === "card") return blobs.current.card ?? (canvasRef.current ? canvasPng(canvasRef.current) : null);
    for (let k = 0; k < 20 && !blobs.current.summary; k++) await new Promise((r) => window.setTimeout(r, 50));
    return blobs.current.summary;
  };
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const download = async () => {
    const blob = await pngNow();
    if (!blob) { toast({ title: ts("toast.renderFailed"), variant: "destructive" }); return; }
    downloadBlob(blob, fileName);
    toast({ title: ts("toast.downloaded"), description: fileName });
  };
  const copy = async () => {
    const outcome = await copyPng(pngNow());
    if (outcome === "copied") toast({ title: ts("toast.copied") });
    else if (outcome === "unsupported") toast({ title: ts("toast.copyUnsupported") });
    else toast({ title: ts("toast.copyFailed"), description: ts("toast.copyUnsupported"), variant: "destructive" });
  };
  const share = async () => {
    const blob = await pngNow();
    if (!blob) { toast({ title: ts("toast.renderFailed"), variant: "destructive" }); return; }
    if ((await sharePng(blob, fileName, period ? `${periodTitle(period)} · WS_Desk` : "WS_Desk")) === "failed") toast({ title: ts("toast.shareFailed"), variant: "destructive" });
  };

  const title = period ? t("viewer.label", { title: periodTitle(period), period: periodLabel(period) }) : "";
  const nextTheme = STORY_THEMES[(STORY_THEMES.indexOf(story.theme) + 1) % STORY_THEMES.length]!;
  const running = auto && !player.held && ready && !busy && i < count - 1;
  const actionsOff = !ready || busy || (target === "summary" && !story.summary);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-black/90 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-modal flex flex-col items-center justify-center text-white focus:outline-none"
          onKeyDown={player.onKeyDown}
          aria-describedby="wrapped-hint"
        >
          {/* The card is sized by the height; the chrome around it (title, export switch, actions) gets at least 30rem, so the
              title is not cut to a few words and the actions stay on one row. */}
          <div className="flex h-full w-full max-w-[min(100vw,max(30rem,calc((100dvh-11rem)*0.5625)))] flex-col gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-0">
            <StoryBars count={Math.max(count, 1)} index={i} running={running} onDone={player.next} />
            <div className="flex items-center gap-1">
              <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description id="wrapped-hint" className="sr-only">{t("viewer.description")}</DialogPrimitive.Description>
              <button type="button" className={iconBtn} onClick={() => story.setTheme(nextTheme)} aria-label={t("viewer.theme", { name: ts(`themes.${nextTheme}`) })} title={t("viewer.theme", { name: ts(`themes.${story.theme}`) })}>
                <Palette className="h-5 w-5" aria-hidden="true" />
              </button>
              <button type="button" className={iconBtn} onClick={() => setAuto((v) => !v)} aria-label={auto ? t("viewer.pause") : t("viewer.play")} aria-pressed={!auto} disabled={count < 2}>
                {auto ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
              </button>
              <DialogPrimitive.Close className={iconBtn} aria-label={t("viewer.close")}>
                <X className="h-5 w-5" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>

            <div className="relative min-h-0 flex-1">
              <div
                className="absolute inset-0 flex touch-none select-none items-center justify-center"
                {...player.stage}
              >
                <canvas
                  ref={canvasRef}
                  width={STORY_W}
                  height={STORY_H}
                  role="img"
                  aria-label={texts ? storyAlt(texts) : t("viewer.loading")}
                  className={cn("block aspect-[9/16] max-h-full max-w-full rounded-2xl bg-neutral-900 shadow-2xl", !ready && "opacity-60")}
                />
                {(story.loading || !ready) && (
                  <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/85">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("viewer.loading")}
                  </span>
                )}
              </div>
              <button type="button" className={cn(iconBtn, "absolute left-1 top-1/2 hidden -translate-y-1/2 bg-black/30 md:inline-flex")} onClick={player.prev} disabled={i === 0} aria-label={t("viewer.prev")}>
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>
              <button type="button" className={cn(iconBtn, "absolute right-1 top-1/2 hidden -translate-y-1/2 bg-black/30 md:inline-flex")} onClick={player.next} disabled={i >= count - 1} aria-label={t("viewer.next")}>
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
            <p className="sr-only" aria-live="polite">{count ? t("viewer.card", { n: i + 1, total: count }) : ""}</p>
            {story.model && !story.model.hasTrades && <p className="text-center text-sm text-white/80">{t("viewer.empty")}</p>}

            {story.sharing.enabled ? (
              <div className="flex flex-col items-center gap-2 pb-[env(safe-area-inset-bottom)]">
                <div role="radiogroup" aria-label={t("viewer.exportLabel")} className="inline-flex rounded-full bg-white/10 p-1">
                  {(["card", "summary"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={target === k}
                      onClick={() => setTarget(k)}
                      className={cn("h-8 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", target === k ? "bg-white text-black" : "text-white/80 hover:text-white")}
                    >
                      {k === "card" ? t("viewer.exportCard") : t("viewer.exportSummary")}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" className={cn(pillBtn, "bg-white text-black hover:bg-white/90")} disabled={actionsOff} onClick={run(download)}>
                  <Download className="h-4 w-4" aria-hidden="true" /> {ts("actions.download")}
                </button>
                <button type="button" className={cn(pillBtn, "bg-white/10 text-white hover:bg-white/20")} disabled={actionsOff} onClick={run(copy)}>
                  <Copy className="h-4 w-4" aria-hidden="true" /> {ts("actions.copy")}
                </button>
                {shareable && (
                  <button type="button" className={cn(pillBtn, "bg-white/10 text-white hover:bg-white/20")} disabled={actionsOff} onClick={run(share)}>
                    <Share2 className="h-4 w-4" aria-hidden="true" /> {ts("actions.share")}
                  </button>
                )}
                </div>
              </div>
            ) : (
              <p className="pb-[env(safe-area-inset-bottom)] text-center text-xs text-white/70">{t("viewer.sharingOff")}</p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
