import { describe, expect, it } from "vitest";
import {
  collectTokenRefs,
  isTokenRef,
  listTokenPaths,
  lookupToken,
  parseTokenRef,
  resolveToken,
  type TokenTree,
} from "../src/index.js";

const tokens: TokenTree = {
  color: {
    surface: "#ffffff",
    ink: "#111111",
  },
  space: { md: 16, "2xl": 64 },
  radius: { pill: 999 },
};

describe("tokens", () => {
  it("parses token references", () => {
    expect(parseTokenRef("{color.surface}")).toBe("color.surface");
    expect(parseTokenRef("{space.2xl}")).toBe("space.2xl");
    expect(parseTokenRef("color.surface")).toBeNull();
    expect(parseTokenRef("{color.}")).toBeNull();
    expect(parseTokenRef("{color surface}")).toBeNull();
    expect(parseTokenRef("#ffffff")).toBeNull();
  });

  it("recognizes complete references", () => {
    expect(isTokenRef("{color.ink}")).toBe(true);
    expect(isTokenRef("{color.ink} ")).toBe(false);
    expect(isTokenRef(42)).toBe(false);
  });

  it("looks up nested values", () => {
    expect(lookupToken(tokens, "color.surface")).toBe("#ffffff");
    expect(lookupToken(tokens, "space.2xl")).toBe(64);
    expect(lookupToken(tokens, "color")).toBeUndefined();
    expect(lookupToken(tokens, "color.missing")).toBeUndefined();
    expect(lookupToken(undefined, "color.ink")).toBeUndefined();
  });

  it("resolves literals and references", () => {
    expect(resolveToken(tokens, "{color.ink}")).toBe("#111111");
    expect(resolveToken(tokens, "#ff0000")).toBe("#ff0000");
    expect(resolveToken(tokens, 12)).toBe(12);
    expect(resolveToken(tokens, "{color.missing}")).toBeUndefined();
  });

  it("lists leaf token paths", () => {
    expect(listTokenPaths(tokens)).toEqual([
      "color.surface",
      "color.ink",
      "space.md",
      "space.2xl",
      "radius.pill",
    ]);
    expect(listTokenPaths(undefined)).toEqual([]);
  });

  it("collects refs from nested values without duplicates", () => {
    const refs = collectTokenRefs({
      fill: "{color.surface}",
      nested: [{ color: "{color.ink}" }, "{color.surface}"],
      plain: "#000000",
    });
    expect(refs.sort()).toEqual(["color.ink", "color.surface"]);
  });
});
