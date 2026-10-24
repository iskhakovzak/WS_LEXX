import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chartLabI18n } from "@/i18n/ns/chartLab";
import type { LabFacets, LabPick } from "./api";

const ALL = "__all__";
export const encodePick = (p: LabPick) => (p ? `${p.kind}:${p.name}` : ALL);
export function decodePick(v: string | null | undefined): LabPick {
  if (!v || v === ALL) return null;
  const i = v.indexOf(":");
  const kind = v.slice(0, i);
  const name = v.slice(i + 1);
  return (kind === "setup" || kind === "ticker") && name ? { kind, name } : null;
}

/** The trader's most traded setup, else ticker — the prefill when nothing is picked yet. */
export function defaultPick(f: LabFacets | undefined): LabPick {
  if (!f) return null;
  if (f.setups[0]) return { kind: "setup", name: f.setups[0].name };
  if (f.tickers[0]) return { kind: "ticker", name: f.tickers[0].name };
  return null;
}

/** Setup or ticker of the trader (with trade counts); `allowAll` adds «все сетапы» (the exit table groups per setup). */
export function LabPicker({ facets, value, onChange, allowAll = false }: { facets: LabFacets | undefined; value: LabPick; onChange: (p: LabPick) => void; allowAll?: boolean }) {
  const { t } = chartLabI18n.useT();
  return (
    <Select value={encodePick(value)} onValueChange={(v) => onChange(decodePick(v))}>
      <SelectTrigger className="h-9 w-auto min-w-[12rem] max-w-[18rem] rounded-full" aria-label={t("views.pickAria")}>
        <SelectValue placeholder={t("views.pick")} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>{t("views.allSetups")}</SelectItem>}
        {!!facets?.setups.length && (
          <SelectGroup>
            <SelectLabel>{t("views.setups")}</SelectLabel>
            {facets.setups.map((s) => <SelectItem key={`s${s.name}`} value={`setup:${s.name}`}>{s.name} · {s.n}</SelectItem>)}
          </SelectGroup>
        )}
        {!!facets?.tickers.length && (
          <SelectGroup>
            <SelectLabel>{t("views.tickers")}</SelectLabel>
            {facets.tickers.map((s) => <SelectItem key={`t${s.name}`} value={`ticker:${s.name}`}>{s.name} · {s.n}</SelectItem>)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
