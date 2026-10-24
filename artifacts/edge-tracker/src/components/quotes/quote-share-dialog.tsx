/**
 * «Картинка с цитатой»: live preview of the quote card on an «Олимп» artwork, an artwork strip, and the actions of the
 * trade share card (download PNG, copy the image, the system share sheet). Drawn in the browser; nothing is uploaded.
 * Lazy chunk (opened from the dashboard card).
 */
import * as React from "react";
import { Copy, Download, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { citationOf, quoteMarks } from "@/lib/quotes/library";
import type { Quote, QuoteLang } from "@/lib/quotes/types";
import { OLYMP_ART, artOf, artThumbUrl, loadArt, type LoadedImage } from "@/components/shared/share-canvas/art";
import { canvasPng } from "@/components/shared/share-canvas/canvas";
import { canShareFiles, copyPng, downloadBlob, sharePng } from "@/components/shared/share-canvas/export";
import { quotesI18n } from "@/i18n/ns/quotes";
import { shareCardI18n } from "@/i18n/ns/shareCard";
import { QUOTE_CARD_H, QUOTE_CARD_W, drawQuoteCard, loadQuoteFonts } from "./quote-render";

/** A fitting default artwork per category (the reader can pick any). */
const DEFAULT_ART: Record<Quote["cat"], string> = {
  olympus: "zeus-ingres",
  philosophy: "athena-stuck",
  discipline: "farnese-hercules",
  trading: "atlas-globe",
  psychology: "phaeton-rubens",
};

export default function QuoteShareDialog({ quote, lang, open, onOpenChange }: { quote: Quote; lang: QuoteLang; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = quotesI18n.useT();
  const { t: ts } = shareCardI18n.useT();
  const { toast } = useToast();
  const [artId, setArtId] = React.useState(() => DEFAULT_ART[quote.cat]);
  const art = artOf(artId);
  const [img, setImg] = React.useState<LoadedImage | null>(null);
  const [fontsReady, setFontsReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const blobRef = React.useRef<Blob | null>(null);
  const shareable = React.useMemo(canShareFiles, []);
  const ready = fontsReady && img != null;

  React.useEffect(() => {
    let alive = true;
    void loadQuoteFonts(`${quote.text} ${quote.authorName}`).then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, [quote.text, quote.authorName]);

  React.useEffect(() => {
    let alive = true;
    setImg(null);
    void loadArt(art.id).then((i) => { if (alive) setImg(i); });
    return () => { alive = false; };
  }, [art.id]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !ready) return;
    blobRef.current = null;
    try {
      drawQuoteCard(ctx, {
        text: quote.text,
        marks: quoteMarks(lang),
        author: quote.authorName,
        citation: citationOf(quote),
        category: t(`cat.${quote.cat}`),
        attributed: quote.rel === "attributed" ? t("rel.attributed") : null,
        image: img?.image ?? null,
        imageSize: img ? { w: img.w, h: img.h } : null,
        credit: art.credit,
      });
    } catch {
      toast({ title: ts("toast.renderFailed"), variant: "destructive" });
      return;
    }
    // A ready PNG: the share sheet must open inside the click (iOS drops the gesture across an await).
    let alive = true;
    void canvasPng(canvas).then((b) => { if (alive) blobRef.current = b; });
    return () => { alive = false; };
  }, [ready, quote, lang, img, art.credit, t, ts, toast]);

  const fileName = `ws-quote-${quote.id}.png`;
  const pngNow = async (): Promise<Blob | null> => blobRef.current ?? (canvasRef.current ? canvasPng(canvasRef.current) : null);
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  async function download() {
    const blob = await pngNow();
    if (!blob) { toast({ title: ts("toast.renderFailed"), variant: "destructive" }); return; }
    downloadBlob(blob, fileName);
    toast({ title: ts("toast.downloaded"), description: fileName });
  }
  async function copy() {
    const outcome = await copyPng(pngNow());
    if (outcome === "copied") toast({ title: ts("toast.copied") });
    else if (outcome === "unsupported") toast({ title: ts("toast.copyUnsupported") });
    else toast({ title: ts("toast.copyFailed"), description: ts("toast.copyUnsupported"), variant: "destructive" });
  }
  async function share() {
    const blob = blobRef.current ?? (await pngNow());
    if (!blob) { toast({ title: ts("toast.renderFailed"), variant: "destructive" }); return; }
    if ((await sharePng(blob, fileName, `${quote.authorName} · WS_Desk`)) === "failed") toast({ title: ts("toast.shareFailed"), variant: "destructive" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0 md:grid-cols-[minmax(0,1fr)_300px]" onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}>
        <DialogHeader className="px-5 pb-3 pr-14 pt-5 md:col-span-2">
          <DialogTitle>{t("shareDialog.title")}</DialogTitle>
          <DialogDescription>{t("shareDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="relative flex items-center justify-center bg-black/30 p-3 md:rounded-bl-2xl md:p-5">
          <canvas
            ref={canvasRef}
            width={QUOTE_CARD_W}
            height={QUOTE_CARD_H}
            role="img"
            aria-label={t("shareDialog.previewAlt", { author: quote.authorName })}
            className="block h-auto w-full max-w-[min(100%,calc(66dvh*0.8))] rounded-xl shadow-2xl"
            data-testid="quote-share-canvas"
          />
          {!ready && (
            <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("shareDialog.drawing")}
            </span>
          )}
        </div>
        <div className="space-y-4 px-5 pb-5 pt-4">
          <div className="space-y-2">
            <p className="micro-label">{t("shareDialog.background")}</p>
            <div role="radiogroup" aria-label={t("shareDialog.background")} className="grid grid-cols-3 gap-2">
              {OLYMP_ART.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === art.id}
                  aria-label={a.credit}
                  title={a.credit}
                  onClick={() => setArtId(a.id)}
                  className={cn(
                    "relative block aspect-[4/5] overflow-hidden rounded-lg ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    a.id === art.id && "ring-2 ring-primary",
                  )}
                >
                  <img src={artThumbUrl(a.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
            <p className="text-2xs text-muted-foreground">{art.credit}</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
            <Button className="flex-1 gap-1.5" disabled={!ready || busy} onClick={run(download)}><Download className="h-4 w-4" aria-hidden="true" /> {ts("actions.download")}</Button>
            <Button variant="outline" className="gap-1.5" disabled={!ready || busy} onClick={run(copy)}><Copy className="h-4 w-4" aria-hidden="true" /> {ts("actions.copy")}</Button>
            {shareable && <Button variant="outline" className="gap-1.5" disabled={!ready || busy} onClick={run(share)}><Share2 className="h-4 w-4" aria-hidden="true" /> {ts("actions.share")}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
