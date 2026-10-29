const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const MAX_URL_LENGTH = 2_048;
const PROBE_TIMEOUT_MS = 3_000;

export type FrontendStatus = "idle" | "checking" | "reachable" | "error";

export interface FrontendProblem {
  code: string;
  message: string;
}

export interface FrontendSnapshot {
  url: string | null;
  origin: string | null;
  status: FrontendStatus;
  httpStatus: number | null;
  checkedAt: string | null;
  error: FrontendProblem | null;
}

export class FrontendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FrontendError";
    this.code = code;
  }
}

export function idleFrontend(): FrontendSnapshot {
  return {
    url: null,
    origin: null,
    status: "idle",
    httpStatus: null,
    checkedAt: null,
    error: null,
  };
}

/** Parse a user-supplied local frontend URL. Only loopback HTTP(S) is allowed. */
export function normalizeFrontendUrl(value: unknown): { url: string; origin: string } {
  if (typeof value !== "string") {
    throw new FrontendError("frontend.url", "Frontend URL must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new FrontendError("frontend.url", "Frontend URL is required.");
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new FrontendError("frontend.url", "Frontend URL is too long.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new FrontendError("frontend.url", "Frontend URL must be an absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FrontendError("frontend.url", "Frontend URL must use http or https.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new FrontendError(
      "frontend.loopback",
      "Frontend URL must use a loopback host (127.0.0.1, localhost or ::1).",
    );
  }
  if (parsed.username || parsed.password) {
    throw new FrontendError("frontend.url", "Frontend URL must not contain credentials.");
  }
  if (parsed.hash) {
    throw new FrontendError("frontend.url", "Frontend URL must not contain a fragment.");
  }
  return { url: parsed.toString(), origin: parsed.origin };
}

export interface FrontendProbeResult {
  ok: boolean;
  httpStatus: number | null;
  error: FrontendProblem | null;
}

/**
 * Probe a loopback frontend without following redirects or reading its body.
 * Any response below 500 proves a server is listening; 401/403/404 are still
 * considered reachable because the app may sit behind auth or use a router.
 */
export async function probeFrontend(url: string): Promise<FrontendProbeResult> {
  // Re-validate at the network boundary, not only in the route. The probe
  // targets the origin root so a user-supplied path/query never becomes the
  // request URL. The host and scheme are constants selected from the
  // loopback allowlist; encodeURIComponent clears the dynamic port.
  const target = normalizeFrontendUrl(url);
  const parsed = new URL(target.url);
  const scheme = parsed.protocol === "https:" ? "https:" : "http:";
  const host = parsed.hostname.startsWith("[")
    ? "[::1]"
    : parsed.hostname.toLowerCase() === "localhost"
      ? "localhost"
      : "127.0.0.1";
  const port = parsed.port ? `:${encodeURIComponent(parsed.port)}` : "";
  const probeUrl = `${scheme}//${host}${port}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.1",
        "user-agent": "Weft frontend probe",
      },
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 500) {
      return {
        ok: false,
        httpStatus: response.status,
        error: {
          code: "frontend.unhealthy",
          message: `Frontend answered with HTTP ${response.status}. Check its logs and try again.`,
        },
      };
    }
    return { ok: true, httpStatus: response.status, error: null };
  } catch (error) {
    const aborted =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      ok: false,
      httpStatus: null,
      error: {
        code: aborted ? "frontend.timeout" : "frontend.unreachable",
        message: aborted
          ? "The frontend did not answer within 3 seconds."
          : "No HTTP server answered at this URL. Start the local frontend and try again.",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
