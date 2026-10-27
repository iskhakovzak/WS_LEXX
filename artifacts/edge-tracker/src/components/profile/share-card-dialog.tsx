/**
 * «Карточка трейдера» dialog: renders the PNG once on open, shows it, offers download / copy / share. Own profile only
 * (the page decides); the desk rule (shareCards) can switch the cards off or drop the $ line.
 */
import * as React from "react";
import { Copy, Download, IdCard, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SkeletonBlock } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { canShareFiles, copyPng, downloadBlob, sharePng } from "@/components/shared/share-canvas/export";
import { sharePolicy } from "@/components/shared/share-canvas/policy";
import { personName } from "@/i18n";
import { profileI18n } from "@/i18n/ns/profile";
import type { ProfileResponse } from "./api";
import { tradingCardFileName, tradingCardPng } from "./trading-card";

export function ShareCardButton({ profile }: { profile: ProfileResponse }) {
  const { t } = profileI18n.useT();
  const { permissions } = useAuth();
  const policy = sharePolicy(permissions);
  const [open, setOpen] = React.useState(false);
  if (!policy.enabled) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <IdCard className="h-4 w-4" aria-hidden="true" />
        {t("share.button")}
      </Button>
      {open && <ShareCardDialog profile={profile} money={policy.money} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareCardDialog({ profile, money, onClose }: { profile: ProfileResponse; money: "usd" | "r_only"; onClose: () => void }) {
  const { t } = profileI18n.useT();
  const { toast } = useToast();
  const [blob, setBlob] = React.useState<Blob | null>(null);
  const [failed, setFailed] = React.useState(false);
  const url = React.useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  React.useEffect(() => {
    let live = true;
    tradingCardPng(profile, money)
      .then((b) => { if (live) { setBlob(b); setFailed(!b); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [profile, money]);

  const file = tradingCardFileName(profile);
  const copy = async () => {
    const r = await copyPng(Promise.resolve(blob));
    toast(r === "copied" ? { title: t("share.copied") } : { title: t("share.failed"), variant: "destructive" });
  };
  const share = async () => {
    if (!blob) return;
    const r = await sharePng(blob, file, t("share.title"));
    if (r === "failed") toast({ title: t("share.failed"), variant: "destructive" });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          <DialogDescription>{t("share.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {url ? (
            <img src={url} alt={t("share.alt", { name: personName(profile.person.name) })} className="aspect-[4/5] w-full max-w-sm rounded-xl shadow-lg" />
          ) : failed ? (
            <p role="alert" className="text-sm text-down">{t("share.failed")}</p>
          ) : (
            <div className="flex w-full max-w-sm flex-col items-center gap-2" aria-live="polite">
              <SkeletonBlock className="aspect-[4/5] w-full rounded-xl" />
              <span className="text-xs text-muted-foreground">{t("share.rendering")}</span>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" className="gap-2" disabled={!blob} onClick={() => blob && downloadBlob(blob, file)}>
              <Download className="h-4 w-4" aria-hidden="true" />{t("share.download")}
            </Button>
            <Button size="sm" variant="outline" className="gap-2" disabled={!blob} onClick={copy}>
              <Copy className="h-4 w-4" aria-hidden="true" />{t("share.copy")}
            </Button>
            {canShareFiles() && (
              <Button size="sm" variant="outline" className="gap-2" disabled={!blob} onClick={share}>
                <Share2 className="h-4 w-4" aria-hidden="true" />{t("share.share")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
