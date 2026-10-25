/**
 * Stable identifiers.
 *
 * Every entity id is a prefixed ULID: 48 bits of time followed by 80 bits of
 * randomness, encoded in Crockford base32. The time prefix makes ids naturally
 * sortable; the prefix makes the entity type readable in a JSON file without
 * looking at the surrounding object.
 */

export type IdPrefix = "ds" | "pg" | "nd" | "as" | "cm";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = "[0-9A-HJKMNP-TV-Z]{26}";
const ANY_ID_RE = new RegExp(`^(?:ds|pg|nd|as|cm)_${ULID_RE}$`);
const PREFIX_RE: Record<IdPrefix, RegExp> = {
  ds: new RegExp(`^ds_${ULID_RE}$`),
  pg: new RegExp(`^pg_${ULID_RE}$`),
  nd: new RegExp(`^nd_${ULID_RE}$`),
  as: new RegExp(`^as_${ULID_RE}$`),
  cm: new RegExp(`^cm_${ULID_RE}$`),
};

const MAX_RANDOM = (1n << 80n) - 1n;
const RANDOM_BYTES = 10;

let lastTime = -1;
let lastRandom = 0n;

function randomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Weft requires the Web Crypto API to generate ids.");
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function encodeTime(time: number): string {
  let value = Math.max(0, Math.floor(time));
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(value: bigint): string {
  let remaining = value & MAX_RANDOM;
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    out = CROCKFORD[Number(remaining & 31n)] + out;
    remaining >>= 5n;
  }
  return out;
}

/**
 * Generate a monotonic ULID. Two calls in the same millisecond sort in call
 * order. A backwards system clock is clamped rather than producing a smaller
 * id, which keeps ids unique under clock adjustments.
 */
export function newUlid(now: number = Date.now()): string {
  const time = Math.max(0, Math.floor(now));
  if (time <= lastTime) {
    lastRandom = (lastRandom + 1n) & MAX_RANDOM;
    if (lastRandom === 0n) {
      lastTime += 1;
    }
  } else {
    lastTime = time;
    lastRandom = bytesToBigInt(randomBytes(RANDOM_BYTES));
  }
  return encodeTime(lastTime) + encodeRandom(lastRandom);
}

/** Generate a prefixed id, for example `nd_01JAV3Q8ZK4M2TP9W6XH5NR7BC`. */
export function newId(prefix: IdPrefix, now: number = Date.now()): string {
  return `${prefix}_${newUlid(now)}`;
}

/** Type guard for a prefixed id, optionally restricted to one prefix. */
export function isId(value: unknown, prefix?: IdPrefix): value is string {
  if (typeof value !== "string") return false;
  return (prefix ? PREFIX_RE[prefix] : ANY_ID_RE).test(value);
}

/** Return the prefix of a valid id, or `null` if the value is not an id. */
export function idPrefix(value: unknown): IdPrefix | null {
  if (typeof value !== "string") return null;
  const match = /^(ds|pg|nd|as|cm)_/.exec(value);
  if (!match || !ANY_ID_RE.test(value)) return null;
  return match[1] as IdPrefix;
}
