// Kept apart from language-switcher.tsx (top bar, entry bundle): the Radix select ships only with Settings.
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGS, LANG_META, useLang, type Lang } from ".";
import { choose } from "./language-switcher";

/** Settings → Профиль: a labelled select. */
export function LanguageSelect({ id, className }: { id?: string; className?: string }) {
  const lang = useLang();
  return (
    <Select value={lang} onValueChange={(v) => choose(v as Lang, id ? `#${id}` : undefined)}>
      <SelectTrigger id={id} className={cn("w-full sm:w-56", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGS.map((l) => (
          <SelectItem key={l} value={l} lang={l}>
            {LANG_META[l].native}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
