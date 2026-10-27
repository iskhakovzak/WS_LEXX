/**
 * People in the command palette: cross-script hits («zokir», «Rakhmatullo», a name typed in the other keyboard layout)
 * and what can be opened for a person given the viewer's role. Texts: shell `palette.people.*`.
 */
import * as React from "react";
import { CandlestickChart, FileText, NotebookPen, IdCard, StickyNote, UserRound, UsersRound } from "lucide-react";
import { personName } from "@/i18n";
import { shellI18n } from "@/i18n/ns/shell";
import { rankPeople, type DirectoryPerson, type SearchHit } from "@/components/people/search";

export type PersonAction = { id: string; label: string; icon: React.ElementType; path: string };

/** Hits for the typed text (name as shown, the other spelling, a strong curator match). */
export function usePeopleHits(directory: readonly DirectoryPerson[], raw: string, enabled: boolean): SearchHit<DirectoryPerson>[] {
  return React.useMemo(() => {
    if (!enabled || !raw.trim()) return [];
    // Field 0 is the name as shown (Latin in EN/UZ when set), field 1 the other spelling, field 2 the curator.
    const other = new Map<string, string>();
    for (const p of directory) {
      const shown = personName(p.name);
      const alt = shown !== p.name ? p.name : p.nameLatin;
      if (alt && alt !== shown) other.set(shown, alt);
    }
    return rankPeople(directory, raw, (p) => personName(p.name), other, (p) => [p.curator], 6)
      // a curator match (secondary field) only when it is a strong one
      .filter((h) => h.field !== 2 || h.tier === "exact" || h.tier === "prefix");
  }, [directory, raw, enabled]);
}

/** Curator → number of traders in their group. */
export function useGroupSizes(directory: readonly DirectoryPerson[]): Map<string, number> {
  return React.useMemo(() => {
    const m = new Map<string, number>();
    for (const p of directory) if (p.role === "trader" && p.curator) m.set(p.curator, (m.get(p.curator) ?? 0) + 1);
    return m;
  }, [directory]);
}

/** What the viewer may open for a person (the first one is the row's own target). */
export function personActions(p: DirectoryPerson, ctx: { isCurator: boolean; me: string | null; groupSize: Map<string, number> }): PersonAction[] {
  const t = shellI18n.t;
  const enc = encodeURIComponent;
  const isTrader = p.role === "trader";
  const self = p.name === ctx.me;
  const out: PersonAction[] = [];
  // The personal profile first: one's own, or anyone's for staff (staff are traders too). Others' profiles are closed.
  if (self) out.push({ id: "card", label: t("palette.people.card"), icon: IdCard, path: "/profile" });
  else if (ctx.isCurator) out.push({ id: "card", label: t("palette.people.card"), icon: IdCard, path: `/people/${p.id}` });
  if (ctx.isCurator && isTrader) out.push({ id: "profile", label: t("palette.people.profile"), icon: UserRound, path: `/curator?trader=${enc(p.name)}` });
  if (isTrader && (ctx.isCurator || self)) {
    out.push({ id: "trades", label: t("palette.people.trades"), icon: CandlestickChart, path: `/trades?trader=${enc(p.name)}` });
    out.push({ id: "day", label: t("palette.people.day"), icon: FileText, path: `/day-report?trader=${enc(p.name)}` });
    out.push({ id: "journal", label: t("palette.people.journal"), icon: NotebookPen, path: `/journal?trader=${enc(p.name)}` });
  }
  if (ctx.isCurator && isTrader) out.push({ id: "notes", label: t("palette.people.notes"), icon: StickyNote, path: `/curator?trader=${enc(p.name)}&tab=notes` });
  const size = ctx.groupSize.get(p.name) ?? 0;
  if (ctx.isCurator && !isTrader && size > 0) out.push({ id: "group", label: t("palette.people.groupCount", { count: size }), icon: UsersRound, path: `/curator?view=traders&group=${enc(p.name)}` });
  return out;
}

export function personSubtitle(p: DirectoryPerson): string {
  const t = shellI18n.t;
  const role = shellI18n.tryT(`palette.people.role.${p.role}`) ?? p.role;
  return [
    role,
    p.role === "trader" ? (p.curator ? t("palette.people.curatorOf", { name: personName(p.curator) }) : t("palette.people.noCurator")) : null,
    // The Latin alias only when it is not already the name shown (RU, or a Latin name that differs).
    p.nameLatin && p.nameLatin !== personName(p.name) ? t("palette.people.latin", { name: p.nameLatin }) : null,
  ].filter(Boolean).join(" · ");
}
