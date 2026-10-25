import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandActor,
  DesignManifest,
  PageCommand,
  PageDocument,
} from "@weft/core";
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

interface CommandRequestMessage {
  type: "command";
  requestId: string;
  pageId: string;
  command: PageCommand;
  actor?: CommandActor;
}

interface CommandResultMessage {
  type: "commandResult";
  requestId: string;
  ok: boolean;
  pageId: string;
  revision?: number;
  commandId?: string;
  inverse?: PageCommand;
  createdNodeIds?: string[];
  actor?: CommandActor;
  error?: { code: string; message: string };
}

interface CommandBroadcastMessage {
  type: "command";
  revision: number;
  pageId: string;
  commandId: string;
  command: PageCommand;
  createdNodeIds: string[];
  actor?: CommandActor;
}

type ServerMessage =
  | InitMessage
  | UpdateMessage
  | ConflictMessage
  | ErrorMessage
  | CommandResultMessage
  | CommandBroadcastMessage
  | { type: "pong" };

type CommandKind = "normal" | "undo" | "redo";

interface PendingCommand {
  kind: CommandKind;
  label: string;
  pageId: string;
}

interface HistoryEntry {
  pageId: string;
  command: PageCommand;
  label: string;
}

export interface DesignSource {
  manifest: DesignManifest;
  pages: PageDocument[];
  mode: DesignMode;
  status: DesignStatus;
  revision: number | null;
  conflicts: number;
  error: string | null;
  editable: boolean;
  pending: number;
  canUndo: boolean;
  canRedo: boolean;
  lastActor: CommandActor | null;
  sendCommand(pageId: string, command: PageCommand, label?: string): void;
  undo(): void;
  redo(): void;
}

const LOCAL_ACTOR: CommandActor = { id: "browser", kind: "human", name: "You" };

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

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Static preview by default. When served by `weft dev`, the bridge's
 * `/api/design` and `/api/live` endpoints replace the embedded design with a
 * live Yjs session, stream updates, and accept commands with inverses.
 */
export function useDesignSource(): DesignSource {
  const [manifest, setManifest] = useState<DesignManifest>(staticDesign.manifest);
  const [pages, setPages] = useState<PageDocument[]>(staticDesign.pages);
  const [mode, setMode] = useState<DesignMode>("static");
  const [status, setStatus] = useState<DesignStatus>("static");
  const [revision, setRevision] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastActor, setLastActor] = useState<CommandActor | null>(null);
  const [pending, setPending] = useState(0);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  const sessionsRef = useRef<Map<string, PageSession>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingCommand>>(new Map());

  const dispatch = useCallback(
    (pageId: string, command: PageCommand, kind: CommandKind, label: string): void => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("The live bridge is not connected.");
        return;
      }
      const requestId = newRequestId();
      pendingRef.current.set(requestId, { kind, label, pageId });
      setPending((count) => count + 1);
      const message: CommandRequestMessage = {
        type: "command",
        requestId,
        pageId,
        command,
        actor: LOCAL_ACTOR,
      };
      ws.send(JSON.stringify(message));
    },
    [],
  );

  const sendCommand = useCallback(
    (pageId: string, command: PageCommand, label = command.type): void => {
      dispatch(pageId, command, "normal", label);
    },
    [dispatch],
  );

  const undo = useCallback((): void => {
    if (pendingRef.current.size > 0) return;
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((current) => current.slice(0, -1));
    dispatch(entry.pageId, entry.command, "undo", entry.label);
  }, [dispatch, undoStack]);

  const redo = useCallback((): void => {
    if (pendingRef.current.size > 0) return;
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setRedoStack((current) => current.slice(0, -1));
    dispatch(entry.pageId, entry.command, "redo", entry.label);
  }, [dispatch, redoStack]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const destroySessions = (sessions: Map<string, PageSession>): void => {
      for (const session of sessions.values()) session.destroy();
      sessions.clear();
    };

    const clearHistory = (): void => {
      pendingRef.current.clear();
      setPending(0);
      setUndoStack([]);
      setRedoStack([]);
      setLastActor(null);
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
        clearHistory();
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

    const handleCommandResult = (message: CommandResultMessage): void => {
      const entry = pendingRef.current.get(message.requestId);
      if (entry) pendingRef.current.delete(message.requestId);
      setPending((count) => Math.max(0, count - 1));
      if (message.revision !== undefined) setRevision(message.revision);
      if (message.actor) setLastActor(message.actor);

      if (!message.ok) {
        setError(message.error?.message ?? "The bridge rejected the command.");
        return;
      }
      setError(null);
      if (!message.inverse || !entry) return;

      const history: HistoryEntry = {
        pageId: entry.pageId,
        command: message.inverse,
        label: entry.label,
      };
      if (entry.kind === "normal") {
        setUndoStack((current) => [...current, history]);
        setRedoStack([]);
      } else if (entry.kind === "undo") {
        setRedoStack((current) => [...current, history]);
      } else {
        setUndoStack((current) => [...current, history]);
      }
    };

    const connect = (): void => {
      if (disposed) return;
      setStatus("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/live`);
      socket = ws;
      socketRef.current = ws;

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
          case "commandResult": {
            handleCommandResult(message);
            break;
          }
          case "command": {
            if (message.actor) setLastActor(message.actor);
            setRevision(message.revision);
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
        if (socketRef.current === ws) socketRef.current = null;
        if (disposed) return;
        pendingRef.current.clear();
        setPending(0);
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
      socketRef.current = null;
      if (retry) clearTimeout(retry);
      socket?.close();
      destroySessions(sessionsRef.current);
    };
  }, []);

  const editable = mode === "live" && status === "live";
  return {
    manifest,
    pages,
    mode,
    status,
    revision,
    conflicts,
    error,
    editable,
    pending,
    canUndo: editable && pending === 0 && undoStack.length > 0,
    canRedo: editable && pending === 0 && redoStack.length > 0,
    lastActor,
    sendCommand,
    undo,
    redo,
  };
}
