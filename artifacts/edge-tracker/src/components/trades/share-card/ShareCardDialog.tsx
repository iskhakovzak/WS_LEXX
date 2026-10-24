/**
 * «Картинка сделки»: a live preview of the share card + themes, toggles and the actions (download PNG, copy the image,
 * share the file — on phones that is the system sheet with Telegram). Everything is drawn and kept in the browser;
 * the user's photo is never uploaded. Opened lazily by ShareCardButton.
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { Copy, Download, Loader2, Share2 } from "lucide-react";
import { usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { personName } from "@/i18n";
import { shareCardI18n } from "@/i18n/ns/shareCard";
import { CARD_H, CARD_W, DEFAULT_PREFS, cardFileName, cardTexts, parsePrefs, pickMode, resultModes, shareTradeOf, sharePolicy, toneOf, type SharePrefs } from "./model";
import { canvasPng, drawShareCard, loadCardFonts } from "./render";
import { artOf } from "./themes";
import { loadArt, loadPhoto, useCardSeries, type LoadedImage } from "./use-card-data";
import { ArtPicker, PhotoPicker, ResultSwitch, ThemePicker, ToggleRow } from "./ShareCardControls";
import { canShareFiles, copyPng, downloadBlob, sharePng } from "@/components/shared/share-canvas/export";
import { sharePrefsKey } from "@/components/shared/share-canvas/policy";

export default function ShareCardDialog({ trade, open, onOpenChange }: { trade: Trade; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = shareCardI18n.useT();
  const { toast } = useToast();
  const { user, permissions } = useAuth();
  const policy = sharePolicy(permissions);
  const [rawPrefs, setRawPrefs] = usePersistentState<SharePrefs>(sharePrefsKey(user?.traderName), DEFAULT_PREFS);
  const prefs = parsePrefs(rawPrefs);
  const [theme, setTheme] = React.useState(prefs.theme);
  const set = (patch: Partial<SharePrefs>) => setRawPrefs({ ...prefs, ...patch });

  const st = React.useMemo(() => shareTradeOf(trade), [trade]);
  const modes = React.useMemo(() => resultModes(st, policy.money), [st, policy.money]);
  const mode = pickMode(prefs.mode, modes);
  const art = artOf(prefs.art);
  const { series, loading } = useCardSeries(trade, st.entry, st.exit);

  const [fontsReady, setFontsReady] = React.useState(false);
  const [artImg, setArtImg] = React.useState<LoadedImage | null>(null);
  const [photo, setPhoto] = React.useState<(LoadedImage & { url: string }) | null>(null);
  const [photoFailed, setPhotoFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const blobRef = React.useRef<Blob | null>(null);
  const shareable = React.useMemo(canShareFiles, []);
  const name = prefs.showName && trade.trader ? personName(trade.trader) : null;

  React.useEffect(() => {
    let alive = true;
    void loadCardFonts(name ?? "").then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, [name]);

  React.useEffect(() => {
    if (theme !== "olymp") return;
    let alive = true;
    void loadArt(art.id).then((img) => { if (alive) setArtImg(img); });
    return () => { alive = false; };
  }, [theme, art.id]);

  // The photo's preview URL lives only while the dialog does.
  React.useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const image = theme === "olymp" ? artImg : theme === "photo" ? photo : null;
  const ready = fontsReady && !loading && (theme !== "olymp" || artImg != null) && mode != null;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !ready || !mode) return;
    blobRef.current = null;
    try {
      drawShareCard(ctx, {
        texts: cardTexts(st, { mode, money: policy.money, showPrices: prefs.showPrices, name }),
        series, tone: toneOf(st), theme,
        image: image?.image ?? null, imageSize: image ? { w: image.w, h: image.h } : null,
        credit: theme === "olymp" ? art.credit : null,
        seed: st.id,
      });
    } catch {
      toast({ title: t("toast.renderFailed"), variant: "destructive" });
      return;
    }
    // Keep a ready PNG: the share sheet must open inside the click (iOS drops the gesture across an await).
    let alive = true;
    void canvasPng(canvas).then((b) => { if (alive) blobRef.current = b; });
    return () => { alive = false; };
  }, [ready, st, mode, policy.money, prefs.showPrices, name, series, theme, image, art.credit, toast, t]);

  const pngNow = async (): Promise<Blob | null> => blobRef.current ?? (canvasRef.current ? canvasPng(canvasRef.current) : null);
  const fileName = cardFileName(st);

  async function download() {
    const blob = await pngNow();
    if (!blob) { toast({ title: t("toast.renderFailed"), variant: "destructive" }); return; }
    downloadBlob(blob, fileName);
    toast({ title: t("toast.downloaded"), description: fileName });
  }

  async function copy() {
    const outcome = await copyPng(pngNow());
    if (outcome === "copied") toast({ title: t("toast.copied") });
    else if (outcome === "unsupported") toast({ title: t("toast.copyUnsupported") });
    else toast({ title: t("toast.copyFailed"), description: t("toast.copyUnsupported"), variant: "destructive" });
  }

  async function share() {
    const blob = blobRef.current ?? (await pngNow());
    if (!blob) { toast({ title: t("toast.renderFailed"), variant: "destructive" }); return; }
    if ((await sharePng(blob, fileName, `${st.ticker} · WS_LEXX`)) === "failed") toast({ title: t("toast.shareFailed"), variant: "destructive" });
  }

  async function onPhoto(file: File) {
    setPhotoFailed(false);
    const img = await loadPhoto(file);
    if (!img) { setPhotoFailed(true); return; }
    setPhoto({ ...img, url: URL.createObjectURL(file) });
    setTheme("photo");
  }

  const run = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const pickTheme = (k: SharePrefs["theme"]) => { setTheme(k); if (k !== "photo") set({ theme: k }); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Page hotkeys (trades list j / k / Enter …) listen on window: keep them away while the dialog is open. Escape
          still reaches Radix (it listens on document) so the dialog closes as usual. */}
      <DialogContent className="max-w-5xl gap-0 p-0 md:grid-cols-[minmax(0,1fr)_340px]" onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}>
        <DialogHeader className="px-5 pb-3 pr-14 pt-5 md:col-span-2">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { ticker: st.ticker })}</DialogDescription>
        </DialogHeader>
        <div className="relative flex items-center justify-center bg-black/30 p-3 md:rounded-bl-2xl md:p-5">
          <canvas
            ref={canvasRef}
            width={CARD_W}
            height={CARD_H}
            role="img"
            aria-label={t("previewAlt", { ticker: st.ticker })}
            className="block h-auto w-full max-w-[min(100%,calc(68dvh*0.8))] rounded-xl shadow-2xl"
          />
          {!ready && (
            <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("drawing")}
            </span>
          )}
        </div>
        <div className="space-y-4 px-5 pb-5 pt-4 md:max-h-[calc(100dvh-10rem)] md:overflow-y-auto">
          <ThemePicker theme={theme} art={art.id} photoUrl={photo?.url ?? null} onTheme={pickTheme} />
          {theme === "olymp" && <ArtPicker art={art.id} onArt={(id) => set({ art: id })} />}
          {theme === "photo" && <PhotoPicker hasPhoto={!!photo} failed={photoFailed} onFile={(f) => void onPhoto(f)} />}
          <ResultSwitch mode={mode} modes={modes} rOnly={policy.money === "r_only"} onMode={(m) => set({ mode: m })} />
          <div className="space-y-3">
            <ToggleRow id={`share-name-${st.id}`} label={t("toggles.showName")} checked={prefs.showName} onChange={(v) => set({ showName: v })} />
            <ToggleRow id={`share-prices-${st.id}`} label={t("toggles.showPrices")} checked={prefs.showPrices} onChange={(v) => set({ showPrices: v })} />
          </div>
          {!loading && series?.synthetic && <p className="text-xs text-muted-foreground">{t("chart.fallback")}</p>}
          {!loading && !series && <p className="text-xs text-muted-foreground">{t("chart.none")}</p>}
          <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
            <Button className="flex-1 gap-1.5" disabled={!ready || busy} onClick={run(download)}><Download className="h-4 w-4" aria-hidden="true" /> {t("actions.download")}</Button>
            <Button variant="outline" className="gap-1.5" disabled={!ready || busy} onClick={run(copy)}><Copy className="h-4 w-4" aria-hidden="true" /> {t("actions.copy")}</Button>
            {shareable && <Button variant="outline" className="gap-1.5" disabled={!ready || busy} onClick={run(share)}><Share2 className="h-4 w-4" aria-hidden="true" /> {t("actions.share")}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
