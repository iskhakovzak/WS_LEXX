/**
 * «Вид» dialog: a live preview header (a big «Aa» in the chosen font, the day's number, a fan of the current
 * colours), undo / redo, «Сохранить образ», «Сбросить», five tabs and the saved looks. Changes apply instantly
 * (the page behind the dialog is the real preview) and are saved to the profile by contexts/appearance-context.
 * Lazy chunk: loaded the first time the dialog opens (components/appearance/appearance-host.tsx).
 */
import * as React from "react";
import { Redo2, RotateCcw, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAppearance, type AppearanceTab } from "@/contexts/appearance-context";
import { isDefault } from "@/lib/appearance/model";
import { cn } from "@/lib/utils";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { ThemesTab } from "./tab-themes";
import { ColorsTab } from "./tab-colors";
import { MoneyTab } from "./tab-money";
import { BackgroundTab } from "./tab-background";
import { DensityTab } from "./tab-density";
import { ChipsTab } from "./tab-chips";
import { LooksBar, SaveLookButton } from "./looks-bar";

const TABS: readonly AppearanceTab[] = ["themes", "colors", "money", "chips", "background", "density"];
/** The fan: CSS colours the page is using right now (live variables). */
const FAN = ["hsl(var(--primary))", "hsl(var(--up))", "hsl(var(--down))", "hsl(var(--be))", "hsl(var(--border))", "hsl(var(--foreground))"];

function PreviewHeader() {
  const { t } = appearanceI18n.useT();
  return (
    <div role="img" aria-label={t("preview.aria")} className="tile relative flex shrink-0 items-center gap-4 overflow-hidden px-4 py-3 sm:gap-5 sm:px-5 sm:py-4">
      <span className="font-sans text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-6xl" aria-hidden="true">Aa</span>
      <span className="min-w-0" aria-hidden="true">
        <span className="micro-label block">{t("preview.label")}</span>
        <span className="block text-3xl font-semibold leading-tight tracking-tight text-up tabular-nums">+$16,480</span>
        <span className="block text-sm tabular-nums text-muted-foreground">
          <span className="text-up">12W</span> · <span className="text-down">4L</span> · <span className="text-be">1BE</span>
        </span>
      </span>
      <span className="pointer-events-none relative ml-auto hidden h-20 w-36 shrink-0 sm:block" aria-hidden="true">
        {FAN.map((c, i) => (
          <span
            key={i}
            className="absolute bottom-0 left-1/2 h-20 w-7 origin-bottom rounded-full border border-[var(--field-border)] shadow-sm"
            style={{ background: c, transform: `translateX(-50%) rotate(${(i - (FAN.length - 1) / 2) * 14}deg)` }}
          />
        ))}
      </span>
    </div>
  );
}

function Toolbar() {
  const { t } = appearanceI18n.useT();
  const { undo, redo, canUndo, canRedo, reset, appearance, status } = useAppearance();
  const { toast } = useToast();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} aria-label={t("undo")} title={`${t("undo")} (Ctrl+Z)`}>
        <Undo2 aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} aria-label={t("redo")} title={`${t("redo")} (Ctrl+Shift+Z)`}>
        <Redo2 aria-hidden="true" />
      </Button>
      <span role="status" aria-live="polite" className={cn("min-w-0 truncate text-xs", status === "error" ? "text-down" : "text-muted-foreground")}>
        {status === "idle" ? "" : t(`status.${status}`)}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isDefault(appearance)}
          onClick={() => { reset(); toast({ title: t("resetDone") }); }}
        >
          <RotateCcw aria-hidden="true" />
          {t("reset")}
        </Button>
        <SaveLookButton />
      </span>
    </div>
  );
}

export default function AppearanceDialog() {
  const { t } = appearanceI18n.useT();
  const { open, setOpen, tab, setTab, undo, redo } = useAppearance();

  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable=true]")) return;
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onKeyDown={onKeyDown} className="flex max-h-[calc(100dvh-1.5rem)] max-w-4xl flex-col gap-4 overflow-hidden p-4 sm:p-6">
        <div className="shrink-0 pr-10">
          <DialogTitle className="type-display">{t("title")}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">{t("description")}</DialogDescription>
        </div>
        <PreviewHeader />
        <Toolbar />
        <Tabs value={tab} onValueChange={(v) => setTab(v as AppearanceTab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList aria-label={t("tabs.aria")} className="scrollbar-none max-w-full justify-start self-start overflow-x-auto">
            {TABS.map((id) => <TabsTrigger key={id} value={id}>{t(`tabs.${id}`)}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="themes" className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"><ThemesTab /></TabsContent>
          <TabsContent value="colors" className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"><ColorsTab /></TabsContent>
          <TabsContent value="money" className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"><MoneyTab /></TabsContent>
          <TabsContent value="chips" className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"><ChipsTab /></TabsContent>
          <TabsContent value="background" className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"><BackgroundTab /></TabsContent>
          <TabsContent value="density" className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"><DensityTab /></TabsContent>
        </Tabs>
        <div className="shrink-0 border-t border-[var(--glass-border)] pt-4">
          <LooksBar />
        </div>
      </DialogContent>
    </Dialog>
  );
}
