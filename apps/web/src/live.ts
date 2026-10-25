import { useEffect, useRef, useState } from "react";
import type { DesignManifest, PageDocument } from "@weft/core";
import { PageSession, type MergeConflict } from "@weft/session";
import staticDesign from "virtual:weft-design";

export type DesignMode = "static" | "live";
export type DesignStatus = "static" | "connecting" | "live" | "disconnected";

interface WirePage {
  pageId: string;
  update: string;
}

interface DesignPayload {
  revision: number;
  manifest: DesignManifest;
  pages: WirePage[];
}

interface InitMessage extends DesignPayload {
  type: "init";
}

interface UpdateMessage {
  type: "update";
  revision: number;
  pageId: string;
  update: string;
}

interface ConflictMessage {
  type: "conflict";
  revision: number;
  pageId: string;
  conflicts: MergeConflict[];
}

interface ErrorMessage {
  type: "error";
  revision?: number;
  message: string;
}

type ServerMessage =
  | InitMessage
  | UpdateMessage
  | ConflictMessage
  | ErrorMessage
  | { type: "pong" };

export interface DesignSource {
  manifest: DesignManifest;
  pages: PageDocument[];
  mode: DesignMode;
  status: DesignStatus;
  revision: number | null;
  conflicts: number;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDesignPayload(value: unknown): value is DesignPayload {
  if (!isRecord(value)) return false;
  if (typeof value.revision !== "number") return false;
  if (!isRecord(value.manifest)) return false;
  return Array.isArray(value.pages);
}

function decodeUpdate(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Static preview by default. When served by `weft dev`, the bridge's
 * `/api/design` and `/api/live` endpoints replace the embedded design with a
 * live Yjs session and stream updates from the watched directory.
 */
export function useDesignSource(): DesignSource {
  const [manifest, setManifest] = useState<DesignManifest>(staticDesign.manifest);
  const [pages, setPages] = useState<PageDocument[]>(staticDesign.pages);
  const [mode, setMode] = useState<DesignMode>("static");
  const [status, setStatus] = useState<DesignStatus>("static");
  const [revision, setRevision] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sessionsRef = useRef<Map<string, PageSession>>(new Map());

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const destroySessions = (sessions: Map<string, PageSession>): void => {
      for (const session of sessions.values()) session.destroy();
      sessions.clear();
    };

    const applyPayload = (payload: DesignPayload): string | null => {
      const next = new Map<string, PageSession>();
      try {
        for (const wire of payload.pages) {
          if (!isRecord(wire) || typeof wire.pageId !== "string" || typeof wire.update !== "string") {
            throw new Error("Invalid page payload from the bridge.");
          }
          next.set(
            wire.pageId,
            PageSession.fromUpdate(decodeUpdate(wire.update), {
              tokens: payload.manifest.tokens,
              assets: payload.manifest.assets,
            }),
          );
        }

        const ordered: PageDocument[] = [];
        for (const ref of payload.manifest.pages) {
          const session = next.get(ref.id);
          if (!session) continue;
          ordered.push(session.toPage());
        }

        destroySessions(sessionsRef.current);
        sessionsRef.current = next;
        if (disposed) {
          destroySessions(next);
          return null;
        }

        setManifest(payload.manifest);
        setPages(ordered);
        setRevision(payload.revision);
        setConflicts(0);
        setError(null);
        return null;
      } catch (caught) {
        destroySessions(next);
        return messageOf(caught);
      }
    };

    const applyUpdate = (message: UpdateMessage): void => {
      const session = sessionsRef.current.get(message.pageId);
      if (!session) return;
      try {
        session.applyUpdate(decodeUpdate(message.update));
        const page = session.toPage();
        setPages((current) =>
          current.map((candidate) => (candidate.id === page.id ? page : candidate)),
        );
        setRevision(message.revision);
        setError(null);
      } catch (caught) {
        setError(messageOf(caught));
      }
    };

    const connect = (): void => {
      if (disposed) return;
      setStatus("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/live`);
      socket = ws;

      ws.addEventListener("message", (event) => {
        if (disposed) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        switch (message.type) {
          case "init": {
            const failure = applyPayload(message);
            if (failure) {
              setError(failure);
              setStatus("disconnected");
              ws.close();
              return;
            }
            setMode("live");
            setStatus("live");
            break;
          }
          case "update": {
            applyUpdate(message);
            break;
          }
          case "conflict": {
            setConflicts((count) => count + message.conflicts.length);
            setRevision(message.revision);
            break;
          }
          case "error": {
            setError(message.message);
            break;
          }
          case "pong":
            break;
        }
      });

      ws.addEventListener("close", () => {
        if (disposed) return;
        setStatus("disconnected");
        if (retry) clearTimeout(retry);
        retry = setTimeout(() => {
          retry = null;
          connect();
        }, 1200);
      });

      ws.addEventListener("error", () => {
        // The close event schedules the retry.
      });
    };

    const boot = async (): Promise<void> => {
      try {
        const response = await fetch("/api/design", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("application/json")) {
          if (!disposed) setStatus("static");
          return;
        }

        const payload = (await response.json()) as unknown;
        if (disposed) return;
        if (!isDesignPayload(payload)) {
          setStatus("static");
          return;
        }

        const failure = applyPayload(payload);
        if (failure) {
          setError(failure);
          setMode("live");
          setStatus("disconnected");
          return;
        }
        setMode("live");
        setStatus("connecting");
        connect();
      } catch {
        if (!disposed) setStatus("static");
      }
    };

    void boot();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      destroySessions(sessionsRef.current);
    };
  }, []);

  return { manifest, pages, mode, status, revision, conflicts, error };
}
