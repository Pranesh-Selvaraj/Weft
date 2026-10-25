import { ExtractError } from "./errors.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Parse and validate a loopback capture origin (scheme + host + port). */
export function normalizeOrigin(value: string, label = "origin"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExtractError("extract.origin", `${label} must be an absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractError("extract.origin", `${label} must use http or https.`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ExtractError(
      "extract.origin",
      `${label} must use a loopback host (127.0.0.1, localhost or ::1).`,
    );
  }
  if (url.username || url.password) {
    throw new ExtractError("extract.origin", `${label} must not contain credentials.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ExtractError("extract.origin", `${label} must be an origin, without a path, query or fragment.`);
  }
  return url.origin;
}

/**
 * Refuse a capture URL whose origin is not in the project allowlist. The
 * returned URL is absolute and credential-free.
 */
export function assertAllowedUrl(
  value: string,
  allowedOrigins: readonly string[],
): { url: string; origin: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExtractError("extract.url", "Capture URL must be absolute.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractError("extract.url", "Capture URL must use http or https.");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ExtractError(
      "extract.origin",
      "Capture URL must use a loopback host (127.0.0.1, localhost or ::1).",
    );
  }
  if (url.username || url.password) {
    throw new ExtractError("extract.url", "Capture URL must not contain credentials.");
  }

  const allowed = new Set(
    allowedOrigins.map((origin) => normalizeOrigin(origin, "extract.origins entry")),
  );
  if (!allowed.has(url.origin)) {
    throw new ExtractError(
      "extract.origin",
      `Capture origin ${url.origin} is not in extract.origins for this project.`,
    );
  }
  return { url: url.toString(), origin: url.origin };
}
