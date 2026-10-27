/**
 * «Вид» dialog. Four tabs, each with its 3–6 most useful choices up front and one «Ещё настройки» for the rest:
 *   Тема   — «Выбрать тему» + the current background with «Выбрать фон»;
 *   Фон    — «Выбрать фон» (grouped gallery) + «Яркость фона»;
 *   Цвета  — accent + font;
 *   Детали — money-colour presets, chips on / off + presets, density.
 * One compact strip on top: a live sample (the font and money colours in use) and undo / redo / reset / «Сохранить
 * образ»; the saved looks are a single row at the bottom. Changes apply instantly (the page behind the dialog is the
 * real preview) and are saved to the profile by contexts/appearance-context.
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
import { BackgroundTab } from "./tab-background";
import { DetailsTab } from "./tab-details";
import { LooksBar, SaveLookButton } from "./looks-bar";

const TABS: readonly AppearanceTab[] = ["themes", "background", "colors", "details"];

/** The live sample: «Aa» in the font in use, today's number in the win colour, W / L / BE in the money colours. */
function Sample() {
  const { t } = appearanceI18n.useT();
  return (
    <div role="img" aria-label={t("preview.aria")} className="flex min-w-0 items-center gap-3">
      <span className="font-sans text-3xl font-semibold leading-none tracking-tight text-foreground" aria-hidden="true">Aa</span>
      <span className="min-w-0" aria-hidden="true">
        <span className="block text-lg font-semibold leading-tight tracking-tight text-up tabular-nums">+$16,480</span>
        <span className="block text-xs tabular-nums text-muted-foreground">
          <span className="text-up">12W</span> · <span className="text-down">4L</span> · <span className="text-be">1BE</span>
        </span>
      </span>
    </div>
  );
}

function Toolbar() {
  const { t } = appearanceI18n.useT();
  const { undo, redo, canUndo, canRedo, reset, appearance, status } = useAppearance();
  const { toast } = useToast();
  return (
    <div className="tile flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <Sample />
      <span role="status" aria-live="polite" className={cn("min-w-0 flex-1 truncate text-xs", status === "error" ? "text-down" : "text-muted-foreground")}>
        {status === "idle" ? "" : t(`status.${status}`)}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} aria-label={t("undo")} title={`${t("undo")} (Ctrl+Z)`}>
          <Undo2 aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} aria-label={t("redo")} title={`${t("redo")} (Ctrl+Shift+Z)`}>
          <Redo2 aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={isDefault(appearance)}
          aria-label={t("reset")}
          title={t("reset")}
          onClick={() => { reset(); toast({ title: t("resetDone") }); }}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
        <SaveLookButton />
      </span>
    </div>
  );
}

/** A tab body: scrolls on its own on tall screens, flows into the scrolling card on short ones. */
const tabBody = "-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1 [@media(max-height:50rem)]:flex-none [@media(max-height:50rem)]:overflow-visible max-sm:flex-none max-sm:overflow-visible";

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
      {/* Tall screens: the strip, tabs and looks stay, only the tab body scrolls. Short or narrow ones (< 50rem tall, a 1280×720 laptop;
          phones): the tab body would shrink to a sliver, so the whole card scrolls instead. */}
      <DialogContent onKeyDown={onKeyDown} size="xl" className="flex max-h-[calc(100dvh-1.5rem)] flex-col gap-3 overflow-hidden p-4 sm:p-6 max-sm:overflow-y-auto [@media(max-height:50rem)]:overflow-y-auto">
        <div className="shrink-0 pr-10">
          <DialogTitle className="type-display">{t("title")}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">{t("description")}</DialogDescription>
        </div>
        <Toolbar />
        <Tabs value={tab} onValueChange={(v) => setTab(v as AppearanceTab)} className="flex min-h-0 flex-1 flex-col max-sm:flex-none [@media(max-height:50rem)]:flex-none">
          <TabsList aria-label={t("tabs.aria")} className="scrollbar-none max-w-full shrink-0 justify-start self-start overflow-x-auto">
            {TABS.map((id) => <TabsTrigger key={id} value={id}>{t(`tabs.${id}`)}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="themes" className={tabBody}><ThemesTab /></TabsContent>
          <TabsContent value="background" className={tabBody}><BackgroundTab /></TabsContent>
          <TabsContent value="colors" className={tabBody}><ColorsTab /></TabsContent>
          <TabsContent value="details" className={tabBody}><DetailsTab /></TabsContent>
        </Tabs>
        <div className="shrink-0 border-t border-[var(--glass-border)] pt-3">
          <LooksBar />
        </div>
      </DialogContent>
    </Dialog>
  );
}
