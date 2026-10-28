/** How a library quote is written out: citation, quotation marks, the clipboard text. Pure. */
import { QUOTE_LANGS, type Quote, type QuoteLang } from "./types";

export function asQuoteLang(v: string | null | undefined): QuoteLang {
  return (QUOTE_LANGS as readonly string[]).includes(v ?? "") ? (v as QuoteLang) : "ru";
}

/** «Гомер, «Илиада», 9.312» — the work and the locator. */
export function citationOf(q: Pick<Quote, "workName" | "loc">): string {
  return q.loc ? `${q.workName}, ${q.loc}` : q.workName;
}

/** Quotation marks of a language: “…” in English, «…» in ru / uk / uz. */
export function quoteMarks(lang: QuoteLang): readonly [string, string] {
  return lang === "en" ? ["“", "”"] : ["«", "»"];
}

/** Plain text for the clipboard: «text» — author · source. */
export function quotePlainText(q: Quote, lang: QuoteLang): string {
  const [o, c] = quoteMarks(lang);
  return `${o}${q.text}${c}\n— ${q.authorName} · ${citationOf(q)}`;
}
