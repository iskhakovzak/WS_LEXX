/**
 * «Участники пилота» (setting usage.pilotUsers): pick traders from a searchable list instead of typing names.
 * The setting stays a comma-separated text of STORED names (the server matches stored or Latin names); this field
 * shows them as removable chips, adds through the people picker (Latin / Cyrillic search) and normalises a typed Latin
 * name to the stored one. A name that matches nobody stays visible, marked, so nothing is lost silently.
 */
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonSelect } from "@/components/people/person-select";
import { useAuth } from "@/contexts/auth-context";
import { personName } from "@/i18n";
import { deskSettingsI18n } from "@/i18n/ns/deskSettings";
import { cn } from "@/lib/utils";
import { matchTrader, parsePeopleList } from "./pilot-users-model";

const t = deskSettingsI18n.t;

export function PilotUsersField({ id, value, onValue, invalid }: { id: string; value: string; onValue: (v: string) => void; invalid?: boolean }) {
  const { dbUsers } = useAuth();
  const traders = dbUsers.filter((u) => u.active && !u.banned && u.role === "trader");
  const names = parsePeopleList(value);
  const picked = names.map((raw) => ({ raw, user: matchTrader(raw, traders) }));
  const stored = picked.map((p) => p.user?.name ?? p.raw);
  const options = traders.filter((u) => !stored.includes(u.name)).map((u) => u.name).sort((a, b) => personName(a).localeCompare(personName(b)));
  const save = (list: string[]) => onValue(list.join(", "));

  return (
    // `id` goes to the picker trigger so the row's <label htmlFor> focuses a real control (DEV-20).
    <div id={`${id}-box`} className={cn("flex w-80 max-w-full flex-col gap-2", invalid && "rounded-md ring-1 ring-down p-2")}>
      <div className="flex flex-wrap gap-1.5 md:justify-end" aria-live="polite">
        {picked.length === 0 && <span className="text-sm text-muted-foreground">{t("people.empty")}</span>}
        {picked.map((p) => {
          const shown = p.user ? personName(p.user.name) : p.raw;
          return (
            <span
              key={p.raw}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm",
                p.user ? "border-border bg-muted/40 text-foreground" : "border-warn/60 text-warn",
              )}
              title={p.user ? undefined : t("people.unknown")}
            >
              {shown}
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("people.remove", { name: shown })}
                onClick={() => save(stored.filter((n) => n !== (p.user?.name ?? p.raw)))}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>
      <PersonSelect
          id={id}
          value={null}
          onValueChange={(v) => v && save([...stored, v])}
          options={options}
          placeholder={t("people.add")}
          ariaLabel={t("people.add")}
          className="h-9 w-full"
        />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("people.count", { count: picked.length })}</span>
        {picked.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => save([])}>{t("people.clear")}</Button>
        )}
      </div>
    </div>
  );
}
