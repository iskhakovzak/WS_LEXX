/**
 * Design tokens of a theme read straight from the app stylesheet (the custom properties declared for its selectors,
 * in cascade order). Theme previews (Settings → Внешний вид, «Вид» → Темы) render a miniature with a theme's real
 * tokens, independent of the theme currently on <html>.
 */
import type * as React from "react";
import type { ThemeId } from "@/lib/appearance/model";

/** Selectors that make up each theme, in cascade order (index.css). */
export const THEME_SELECTORS: Record<ThemeId, string[]> = {
  dark: [":root", ".dark"],
  dim: [":root", ".dark", ".dim"],
  platinum: [":root", ".platinum"],
  light: [":root"],
};

export function readThemeTokens(selectors: string[]): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const sel of selectors) {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSStyleRule) {
            const parts = rule.selectorText.split(",").map((s) => s.trim());
            if (!parts.includes(sel)) continue;
            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];
              if (prop.startsWith("--")) out[prop] = rule.style.getPropertyValue(prop).trim();
            }
          } else if ("cssRules" in rule && !(rule instanceof CSSMediaRule)) {
            // @layer / @supports blocks
            try { walk((rule as CSSGroupingRule).cssRules); } catch { /* ignore */ }
          }
        }
      };
      walk(rules);
    }
  }
  return out as React.CSSProperties;
}
