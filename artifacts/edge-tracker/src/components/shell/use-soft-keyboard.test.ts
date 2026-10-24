// Phone dock hides while the on-screen keyboard is open (use-soft-keyboard.ts).
import { describe, expect, it } from "vitest";
import { isTextEntry, keyboardFromViewport } from "./use-soft-keyboard";

describe("soft keyboard detection", () => {
  it("a visual viewport much shorter than the window means a keyboard; browser chrome moving does not", () => {
    expect(keyboardFromViewport(844, 500)).toBe(true);
    expect(keyboardFromViewport(844, 780)).toBe(false);
    expect(keyboardFromViewport(844, null)).toBe(false);
  });

  it("text fields bring up the keyboard; buttons, checkboxes and read-only fields do not", () => {
    const input = (type: string, extra: object = {}) => ({ tagName: "INPUT", type, ...extra });
    expect(isTextEntry(input("text"))).toBe(true);
    expect(isTextEntry(input("number"))).toBe(true);
    expect(isTextEntry(input("checkbox"))).toBe(false);
    expect(isTextEntry(input("text", { readOnly: true }))).toBe(false);
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
