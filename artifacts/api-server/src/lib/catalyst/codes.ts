/** Catalyst codes (stored as text + CHECK in catalyst_marks / playbook.formula, migration 0276; labels are i18n). */
export const DIRECTIONS = ["bull", "bear"] as const;
export const STRENGTHS = ["weak", "strong"] as const;
export const KINDS = ["earnings", "news", "fda", "offering", "corporate", "macro", "other"] as const;
export const MARK_SOURCES = ["plan", "watchlist"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type Strength = (typeof STRENGTHS)[number];
export type Kind = (typeof KINDS)[number];
export type MarkSource = (typeof MARK_SOURCES)[number];
