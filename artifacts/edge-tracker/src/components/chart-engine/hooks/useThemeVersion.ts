import * as React from "react";

/** Increments when the html class / data-theme changes, so the chart re-reads CSS tokens. */
export function useThemeVersion(): number {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => setV((x) => x + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => obs.disconnect();
  }, []);
  return v;
}
