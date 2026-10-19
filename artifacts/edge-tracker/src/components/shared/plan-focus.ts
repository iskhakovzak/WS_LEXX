/**
 * «Фокус дня» of a plan (desk or personal): preset quick rules (keys, labelled in the reader's language) + free text.
 * Shared by the plan editor / viewer (components/game-plan, which re-exports these) and the playbook «Сегодня» strip.
 */
import { gpI18n } from "@/i18n/ns/gamePlan";

export const FOCUS_RULE_KEYS = ["a", "b", "c", "d", "e"] as const;
export type FocusRuleKey = (typeof FOCUS_RULE_KEYS)[number];

/** Preset label of a quick rule in the UI language. */
export const focusRuleLabel = (k: FocusRuleKey): string => gpI18n.t(`editor.focusChips.${k}`);

/**
 * Split a stored focus into preset keys + free text. Older plans stored the preset's text in one language inside
 * `focus` (UMID-13); a preset text found there (in the UI language) becomes its key again.
 */
export function splitFocus(focus: string, stored: readonly unknown[] | null | undefined): { rules: FocusRuleKey[]; text: string } {
  const rules = new Set<FocusRuleKey>((stored ?? []).filter((k): k is FocusRuleKey => (FOCUS_RULE_KEYS as readonly unknown[]).includes(k)));
  let text = focus;
  for (const k of FOCUS_RULE_KEYS) {
    const label = focusRuleLabel(k);
    if (label && text.includes(label)) {
      rules.add(k);
      text = text.replace(label, "");
    }
  }
  text = text.replace(/^[\s;·.]+|[\s;·]+$/g, "").replace(/\s*;\s*(;\s*)+/g, "; ");
  return { rules: FOCUS_RULE_KEYS.filter((k) => rules.has(k)), text };
}

/** The focus line as a reader sees it: the picked presets in the reader's language, then the free text. */
export function focusText(doc: { focus?: unknown; focusRules?: readonly unknown[] | null } | null | undefined): string {
  const { rules, text } = splitFocus(typeof doc?.focus === "string" ? doc.focus : "", Array.isArray(doc?.focusRules) ? doc.focusRules : null);
  return [...rules.map(focusRuleLabel), text].filter((x) => x.trim()).join("; ");
}
