import { describe, expect, it } from "vitest";
import {
  parseJson,
  serialize,
  WeftParseError,
  WeftSerializeError,
} from "../src/index.js";

describe("deterministic serialization", () => {
  it("sorts object keys and ends with a newline", () => {
    expect(serialize({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });

  it("produces the same bytes for differently constructed objects", () => {
    const first = { z: 1, a: { y: 2, x: 3 } };
    const second = { a: { x: 3, y: 2 }, z: 1 };
    expect(serialize(first)).toBe(serialize(second));
  });

  it("preserves array order", () => {
    expect(serialize([3, 1, 2], { indent: 0 })).toBe("[3,1,2]\n");
  });

  it("rounds numbers to three decimals", () => {
    expect(serialize(1.23456, { indent: 0 })).toBe("1.235\n");
    expect(serialize(0.1 + 0.2, { indent: 0 })).toBe("0.3\n");
    expect(serialize(-0, { indent: 0 })).toBe("0\n");
    expect(serialize(-1.2345, { indent: 0 })).toBe("-1.235\n");
    expect(serialize(1.2345, { indent: 0 })).toBe("1.235\n");
    expect(serialize(12, { indent: 0 })).toBe("12\n");
  });

  it("honours a custom precision", () => {
    expect(serialize(1.267, { indent: 0, precision: 1 })).toBe("1.3\n");
    expect(serialize(1.5, { indent: 0, precision: 0 })).toBe("2\n");
  });

  it("omits undefined object properties", () => {
    expect(serialize({ a: 1, b: undefined }, { indent: 0 })).toBe('{"a":1}\n');
  });

  it("rejects JSON-hostile values instead of dropping them silently", () => {
    expect(() => serialize({ a: undefined })).not.toThrow();
    expect(() => serialize([undefined])).toThrow(WeftSerializeError);
    expect(() => serialize({ a: Number.NaN })).toThrow(WeftSerializeError);
    expect(() => serialize({ a: Number.POSITIVE_INFINITY })).toThrow(WeftSerializeError);
    expect(() => serialize({ a: 1n })).toThrow(WeftSerializeError);
    expect(() => serialize({ a: () => 1 })).toThrow(WeftSerializeError);
    expect(() => serialize(new Date())).toThrow(WeftSerializeError);
  });

  it("rejects circular references", () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;
    expect(() => serialize(value)).toThrow(/Circular/);
  });

  it("allows the same object in two places when it is not a cycle", () => {
    const shared = { a: 1 };
    expect(serialize({ left: shared, right: shared }, { indent: 0 })).toBe(
      '{"left":{"a":1},"right":{"a":1}}\n',
    );
  });

  it("is idempotent", () => {
    const value = { b: [{ d: 2, c: 1 }], a: "x" };
    const once = serialize(value);
    const twice = serialize(parseJson(once));
    expect(twice).toBe(once);
  });

  it("rejects an invalid indent", () => {
    expect(() => serialize({}, { indent: -1 })).toThrow(WeftSerializeError);
    expect(() => serialize({}, { indent: 1.5 })).toThrow(WeftSerializeError);
  });

  it("wraps JSON parse errors", () => {
    expect(() => parseJson("{")).toThrow(WeftParseError);
    expect(() => parseJson("{ nope }")).toThrow(/Invalid JSON/);
  });
});
