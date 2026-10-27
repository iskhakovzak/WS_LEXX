/** «Образы»: up to 5 saved looks (theme + every setting) — apply in one click, delete, save the current one. */
import * as React from "react";
import { Bookmark, X } from "lucide-react";
import { useAppearance } from "@/contexts/appearance-context";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { LOOK_NAME_MAX, MAX_LOOKS, accentHex, type Look } from "@/lib/appearance/model";
import { appearanceI18n } from "@/i18n/ns/appearance";

function lookDot(l: Look): string {
  return accentHex(l.settings.accent) ?? (l.theme === "light" || l.theme === "platinum" ? "#171717" : "#f2f2f2");
}

/** «Сохранить образ» with an inline name field. */
export function SaveLookButton() {
  const { t } = appearanceI18n.useT();
  const { looks, saveLook } = useAppearance();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const full = looks.length >= MAX_LOOKS;
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim() || t("looks.defaultName", { n: looks.length + 1 });
    const look = saveLook(n);
    if (!look) return;
    setOpen(false);
    setName("");
    toast({ title: t("looks.savedToast", { name: look.name }) });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="secondary" disabled={full} title={full ? t("looks.limit") : undefined}>
          <Bookmark aria-hidden="true" />
          {t("saveLook")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="look-name" className="text-xs font-medium text-muted-foreground">{t("looks.name")}</label>
          <Input id="look-name" autoFocus maxLength={LOOK_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("looks.placeholder")} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("looks.cancel")}</Button>
            <Button type="submit" size="sm">{t("looks.save")}</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function LooksBar() {
  const { t } = appearanceI18n.useT();
  const { looks, applyLook, deleteLook, appearance } = useAppearance();
  const { theme, themeLabels } = useTheme();
  const current = JSON.stringify(appearance);
  return (
    <section aria-label={t("looks.title")} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h3 className="text-sm font-semibold text-foreground" title={t("looks.hint")}>
        {t("looks.title")} <span className="text-xs font-normal tabular-nums text-muted-foreground">{looks.length}/{MAX_LOOKS}</span>
      </h3>
      {looks.length === 0 && <p className="min-w-0 text-xs text-muted-foreground">{t("looks.empty")}</p>}
      {looks.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-2">
          {looks.map((l) => {
            const active = l.theme === theme && JSON.stringify(l.settings) === current;
            return (
              <li key={l.id} className={cn("chip inline-flex items-center gap-1 py-0.5 pl-1 pr-1", active && "border-foreground/60")}>
                <button
                  type="button"
                  onClick={() => applyLook(l.id)}
                  aria-label={t("looks.apply", { name: l.name })}
                  aria-pressed={active}
                  title={`${l.name} · ${themeLabels[l.theme]}`}
                  className="inline-flex min-h-8 items-center gap-2 rounded-full px-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border border-[var(--field-border)]" style={{ background: lookDot(l) }} />
                  <span className="max-w-32 truncate">{l.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteLook(l.id)}
                  aria-label={t("looks.remove", { name: l.name })}
                  title={t("looks.remove", { name: l.name })}
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
