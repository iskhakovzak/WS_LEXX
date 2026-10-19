// «Топ дня» avatar: initials for staff (name known), a person icon for an alias — never the alias number, which read as a
// second rank next to the place (OWNER-24).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AliasBadge } from "../TopLists";

describe("AliasBadge", () => {
  it("initials when the name is known, an icon for an alias, «Я» for the viewer", () => {
    expect(renderToStaticMarkup(createElement(AliasBadge, { row: { me: false, alias: 13, name: "Кирилл Б." } }))).toContain(">КБ<");
    const alias = renderToStaticMarkup(createElement(AliasBadge, { row: { me: false, alias: 13, name: null } }));
    expect(alias).not.toContain(">13<");
    expect(alias).toContain("<svg");
    expect(renderToStaticMarkup(createElement(AliasBadge, { row: { me: true, alias: 13 } }))).toContain(">Я<");
  });
});
