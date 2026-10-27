// One empty-state component (mobile-empty wave): an engraved monochrome medallion, a one-line message, exactly one
// primary action and an optional quieter link; compact keeps the small one-row form.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Inbox } from "lucide-react";
import { EMPTY_ART, EngravedArt } from "./empty-art";
import { EmptyState, emptyActions } from "./empty-state";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("EmptyState", () => {
  it("full: engraved art (decorative, currentColor), the message, one primary action and a secondary link", () => {
    const out = html(createElement(EmptyState, {
      art: "amphora", icon: Inbox, title: "No trades yet", description: "They arrive after the session",
      action: createElement("a", { "data-primary": "", href: "/go" }, "Go"), secondaryAction: createElement("a", { href: "/x" }, "more"),
    }));
    expect(out).toContain('data-empty-state="full"');
    expect(out).toContain('data-art="amphora"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain("No trades yet");
    expect(out).toContain("They arrive after the session");
    expect(out.match(/data-primary/g)).toHaveLength(1);
    expect(out).toContain('href="/x"');
  });

  it("defaults to the column; compact has no medallion", () => {
    expect(html(createElement(EmptyState, { title: "x" }))).toContain('data-art="column"');
    const compact = html(createElement(EmptyState, { title: "x", icon: Inbox, compact: true }));
    expect(compact).toContain('data-empty-state="compact"');
    expect(compact).not.toContain("data-art");
  });

  it("every motif renders, monochrome (no fill colours other than currentColor / the hatch pattern)", () => {
    for (const art of EMPTY_ART) {
      const svg = html(createElement(EngravedArt, { art }));
      expect(svg).toContain(`data-art="${art}"`);
      expect(svg).not.toMatch(/fill="#|stroke="#|hsl\(/);
    }
  });

  it("emptyActions: the first applicable choice is the one primary button, the rest are quiet links", () => {
    const none = emptyActions([false, null]);
    expect(none).toEqual({});
    const one = emptyActions([false, { label: "All time", run: () => {} }]);
    expect(one.secondaryAction).toBeUndefined();
    const out = html(createElement(EmptyState, { title: "x", ...emptyActions([{ label: "All time", run: () => {} }, { label: "Team", run: () => {} }, false]) }));
    expect(out.indexOf("All time")).toBeLessThan(out.indexOf("Team"));
  });
});
