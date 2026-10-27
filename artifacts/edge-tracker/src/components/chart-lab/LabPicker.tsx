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

/** A setup with at least this many trades is the prefill; else the most traded ticker (a picture of 2 entries says little). */
export const MIN_PREFILL = 10;

/** The prefill when nothing is picked yet: the most traded setup when it has enough trades, else the most traded ticker. */
export function defaultPick(f: LabFacets | undefined): LabPick {
  if (!f) return null;
  const s = f.setups[0], k = f.tickers[0];
  if (s && (s.n >= MIN_PREFILL || !k)) return { kind: "setup", name: s.name };
  if (k) return { kind: "ticker", name: k.name };
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
