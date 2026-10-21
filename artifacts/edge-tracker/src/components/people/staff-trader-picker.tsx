/**
 * The staff trader picker (owner rule 2026-10-21, staff = traders + extras): «Мои сделки (Имя)» first, then
 * «Вся команда» (TEAM, when the page has a desk view), then everyone with trades — traders, curators and admins.
 *
 *   <StaffTraderPicker value={scopePickerValue(scope)} onChange={pick} me={me} names={facets.traders} />
 */
import * as React from "react";
import { PersonSelect } from "./person-select";
import { TEAM, traderChoices } from "./staff-scope";
import { commonI18n } from "@/i18n/ns/common";
import { personName } from "@/i18n";

export function StaffTraderPicker({
  value, onChange, me, names, team = true, teamLabel, icon, ariaLabel, className, align,
}: {
  /** A name, or TEAM. */
  value: string;
  onChange: (value: string) => void;
  me: string | null | undefined;
  /** People with trades in the viewer's scope (e.g. the book facets' traders). */
  names: readonly (string | null | undefined)[];
  /** Offer «Вся команда» (false where the page has no desk view, e.g. /behavior). */
  team?: boolean;
  teamLabel?: string;
  icon?: React.ElementType;
  ariaLabel?: string;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const { t } = commonI18n.useT();
  const own = me?.trim() || null;
  const lead = React.useMemo(() => (own ? { value: own, label: t("people.myTradesOf", { name: personName(own) }) } : undefined), [own, t]);
  const options = React.useMemo(() => traderChoices(names, own, value), [names, own, value]);
  return (
    <PersonSelect
      value={value}
      onValueChange={onChange}
      options={options}
      lead={lead}
      allValue={TEAM}
      allLabel={team ? teamLabel ?? t("people.wholeTeam") : undefined}
      icon={icon}
      ariaLabel={ariaLabel ?? t("fields.trader")}
      className={className}
      align={align}
    />
  );
}
