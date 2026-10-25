import { describe, expect, it } from "vitest";
import { idPrefix, isId, newId, newUlid } from "../src/index.js";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe("ids", () => {
  it("creates prefixed ULIDs", () => {
    const id = newId("nd");
    expect(id).toMatch(/^nd_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ULID_RE.test(id.slice(3))).toBe(true);
  });

  it("creates unique ids", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId("nd")));
    expect(ids.size).toBe(2000);
  });

  it("is monotonic within one millisecond", () => {
    const ids = Array.from({ length: 100 }, () => newId("nd", 1_700_000_000_000));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("clamps a backwards clock instead of ordering backwards", () => {
    const first = newUlid(1_700_000_000_000);
    const second = newUlid(1_600_000_000_000);
    expect(second > first).toBe(true);
  });

  it("validates prefixes", () => {
    const id = newId("pg");
    expect(isId(id)).toBe(true);
    expect(isId(id, "pg")).toBe(true);
    expect(isId(id, "nd")).toBe(false);
    expect(isId("pg_not-a-ulid")).toBe(false);
    expect(isId("xx_01JAV3Q8ZK4M2TP9W6XH5NR7BC")).toBe(false);
    expect(isId(null)).toBe(false);
    expect(idPrefix(id)).toBe("pg");
  });

  it("does not accept lowercase ULIDs", () => {
    expect(isId("nd_01jav3q8zk4m2tp9w6xh5nr7bc")).toBe(false);
  });
});
