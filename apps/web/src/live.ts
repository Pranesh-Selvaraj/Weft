import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPage as createEmptyPage,
  nextPageFile,
  type CommandActor,
  type DesignManifest,
  type DocumentCommand,
  type PageCommand,
  type PageDocument,
} from "@weft/core";
import type { SnapshotPayload } from "@weft/render";
import { PageSession, type MergeConflict } from "@weft/session";
import staticDesign from "virtual:weft-design";

export type DesignMode = "static" | "live";
export type DesignStatus = "static" | "connecting" | "live" | "disconnected";

interface WirePage {
  pageId: string;
  update: string;
}

export interface BridgeInfo {
  url: string;
  host: string;
  port: number;
  designPath: string;
  designName: string;
  projectPath: string | null;
  projectName: string | null;
  workspaceFile: string | null;
  mode: "single" | "workspace";
}

export type FrontendStatus = "idle" | "checking" | "reachable" | "error";

export interface FrontendSnapshot {
  url: string | null;
  origin: string | null;
  status: FrontendStatus;
  httpStatus: number | null;
  checkedAt: string | null;
  error: { code: string; message: string } | null;
}

export interface CaptureFrontendRequest {
  pageId: string;
  selector?: string;
  viewport?: { width: number; height: number };
  name?: string;
}

export interface CaptureFrontendResult {
  nodeId: string;
  pageId: string;
  pageFile: string;
  warnings: string[];
}

export type CaptureFrontendOutcome =
  | { ok: true; capture: CaptureFrontendResult }
  | { ok: false; error: string };

const EMPTY_FRONTEND: FrontendSnapshot = {
  url: null,
  origin: null,
  status: "idle",
  httpStatus: null,
  checkedAt: null,
  error: null,
};

const FRONTEND_STORAGE_KEY = "weft.frontend.url";

export interface WorkspaceDesignInfo {
  path: string;
  name: string;
  projectPath: string;
  projectName: string;
}

export interface WorkspaceProjectInfo {
  path: string;
  name: string;
  exists: boolean;
  designs: WorkspaceDesignInfo[];
  error?: string;
}

type DevServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface DevServerLogEntry {
  at: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

interface DevServerProblem {
  code: string;
  message: string;
}

export interface DevServerSnapshot {
  projectPath: string;
  projectName: string;
  configPath: string | null;
  configured: boolean;
  mode: "managed" | "attach" | null;
  status: DevServerStatus;
  url: string | null;
  pid: number | null;
  startedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: DevServerProblem | null;
  configError: DevServerProblem | null;
  logs: DevServerLogEntry[];
}

export interface WorkspacePayload {
  file: string;
  activeDesignPath: string;
  projects: WorkspaceProjectInfo[];
  servers: DevServerSnapshot[];
}

interface DesignPayload {
  revision: number;
  manifest: DesignManifest;
  pages: WirePage[];
  snapshots: Record<string, SnapshotPayload>;
  workspace?: WorkspacePayload;
  bridge?: BridgeInfo;
  frontend?: FrontendSnapshot;
}

interface InitMessage extends DesignPayload {
  type: "init";
  reason?: "designCommand";
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

interface DocumentCommandRequestMessage {
  type: "designCommand";
  requestId: string;
  command: DocumentCommand;
  actor?: CommandActor;
}

interface DocumentCommandResultMessage {
  type: "designCommandResult";
  requestId: string;
  ok: boolean;
  revision: number;
  commandId?: string;
  inverse?: DocumentCommand;
  createdPageIds?: string[];
  removedPageIds?: string[];
  actor?: CommandActor;
  error?: { code: string; message: string };
}

interface DocumentCommandBroadcastMessage {
  type: "designCommand";
  revision: number;
  commandId: string;
  command: DocumentCommand;
  createdPageIds: string[];
  removedPageIds: string[];
  actor?: CommandActor;
}

interface DevServerMessage {
  type: "dev";
  server: DevServerSnapshot;
}

interface FrontendMessage {
  type: "frontend";
  frontend: FrontendSnapshot;
}

type ServerMessage =
  | InitMessage
  | UpdateMessage
  | ConflictMessage
  | ErrorMessage
  | DevServerMessage
  | FrontendMessage
  | CommandResultMessage
  | CommandBroadcastMessage
  | DocumentCommandResultMessage
  | DocumentCommandBroadcastMessage
  | { type: "pong" };

type CommandKind = "normal" | "undo" | "redo";

interface PendingCommand {
  kind: CommandKind;
  label: string;
  pageId: string;
}

interface PageHistoryEntry {
  kind: "page";
  pageId: string;
  command: PageCommand;
  label: string;
}

interface DocumentHistoryEntry {
  kind: "design";
  command: DocumentCommand;
  label: string;
}

type HistoryEntry = PageHistoryEntry | DocumentHistoryEntry;

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
  snapshots: Record<string, SnapshotPayload>;
  assetUrl(assetId: string): string | undefined;
  workspace: WorkspacePayload | null;
  bridge: BridgeInfo | null;
  frontend: FrontendSnapshot;
  frontendBusy: boolean;
  frontendError: string | null;
  captureBusy: boolean;
  switching: boolean;
  devError: string | null;
  serverBusy: string | null;
  sendCommand(pageId: string, command: PageCommand, label?: string): void;
  undo(): void;
  redo(): void;
  openDesign(designPath: string): void;
  createPage(name?: string): string | null;
  deletePage(pageId: string): void;
  renamePage(pageId: string, name: string): void;
  movePage(pageId: string, index: number): void;
  startServer(projectPath: string): void;
  stopServer(projectPath: string): void;
  attachFrontend(url: string): void;
  detachFrontend(): void;
  refreshFrontend(): void;
  captureFrontend(request: CaptureFrontendRequest): Promise<CaptureFrontendOutcome>;
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
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotPayload>>(
    staticDesign.snapshots ?? {},
  );
  const [staticAssetUrls] = useState<Record<string, string>>(
    staticDesign.assetUrls ?? {},
  );
  const [mode, setMode] = useState<DesignMode>("static");
  const [status, setStatus] = useState<DesignStatus>("static");
  const [revision, setRevision] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastActor, setLastActor] = useState<CommandActor | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  const [frontend, setFrontend] = useState<FrontendSnapshot>(EMPTY_FRONTEND);
  const [frontendBusy, setFrontendBusy] = useState(false);
  const [frontendError, setFrontendError] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);
  const [serverBusy, setServerBusy] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  const sessionsRef = useRef<Map<string, PageSession>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingCommand>>(new Map());
  const pendingDesignRef = useRef<Map<string, { kind: CommandKind; label: string }>>(new Map());
  const autoFrontendRef = useRef(false);

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

  const dispatchDesign = useCallback(
    (command: DocumentCommand, kind: CommandKind, label: string): void => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("The live bridge is not connected.");
        return;
      }
      const requestId = newRequestId();
      pendingDesignRef.current.set(requestId, { kind, label });
      setPending((count) => count + 1);
      const message: DocumentCommandRequestMessage = {
        type: "designCommand",
        requestId,
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
    if (pendingRef.current.size > 0 || pendingDesignRef.current.size > 0) return;
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((current) => current.slice(0, -1));
    if (entry.kind === "design") {
      dispatchDesign(entry.command, "undo", entry.label);
    } else {
      dispatch(entry.pageId, entry.command, "undo", entry.label);
    }
  }, [dispatch, dispatchDesign, undoStack]);

  const redo = useCallback((): void => {
    if (pendingRef.current.size > 0 || pendingDesignRef.current.size > 0) return;
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setRedoStack((current) => current.slice(0, -1));
    if (entry.kind === "design") {
      dispatchDesign(entry.command, "redo", entry.label);
    } else {
      dispatch(entry.pageId, entry.command, "redo", entry.label);
    }
  }, [dispatch, dispatchDesign, redoStack]);

  const createPage = useCallback(
    (name?: string): string | null => {
      if (pendingRef.current.size > 0 || pendingDesignRef.current.size > 0) return null;
      if (mode !== "live" || status !== "live") {
        setError("The live bridge is not connected.");
        return null;
      }
      const pageName = name?.trim() || `Page ${manifest.pages.length + 1}`;
      const page = createEmptyPage({ name: pageName });
      const command: DocumentCommand = {
        type: "page.create",
        page,
        file: nextPageFile(manifest, page.name),
      };
      dispatchDesign(command, "normal", "Create page");
      return page.id;
    },
    [dispatchDesign, manifest, mode, status],
  );

  const deletePage = useCallback(
    (pageId: string): void => {
      if (pendingRef.current.size > 0 || pendingDesignRef.current.size > 0) return;
      if (mode !== "live" || status !== "live") {
        setError("The live bridge is not connected.");
        return;
      }
      dispatchDesign({ type: "page.remove", pageId }, "normal", "Delete page");
    },
    [dispatchDesign, mode, status],
  );

  const renamePage = useCallback(
    (pageId: string, name: string): void => {
      if (pendingRef.current.size > 0 || pendingDesignRef.current.size > 0) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      if (mode !== "live" || status !== "live") {
        setError("The live bridge is not connected.");
        return;
      }
      dispatchDesign(
        { type: "page.rename", pageId, name: trimmed },
        "normal",
        "Rename page",
      );
    },
    [dispatchDesign, mode, status],
  );

  const movePage = useCallback(
    (pageId: string, index: number): void => {
      if (pendingRef.current.size > 0 || pendingDesignRef.current.size > 0) return;
      if (!Number.isInteger(index) || index < 0) return;
      if (mode !== "live" || status !== "live") {
        setError("The live bridge is not connected.");
        return;
      }
      dispatchDesign({ type: "page.move", pageId, index }, "normal", "Move page");
    },
    [dispatchDesign, mode, status],
  );

  const assetUrl = useCallback(
    (assetId: string): string | undefined => {
      if (mode === "live" && manifest.assets?.some((asset) => asset.id === assetId)) {
        return `/api/asset/${encodeURIComponent(assetId)}?v=${revision ?? 0}`;
      }
      return staticAssetUrls[assetId];
    },
    [manifest.assets, mode, revision, staticAssetUrls],
  );

  const openDesign = useCallback((designPath: string): void => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("The live bridge is not connected.");
      return;
    }
    if (switching) return;
    setSwitching(true);
    setError(null);

    void fetch("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ designPath }),
    })
      .then(async (response) => {
        if (response.ok) return;
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? "Could not open the design.");
      })
      .catch((caught: unknown) => {
        setError(messageOf(caught));
      })
      .finally(() => {
        setSwitching(false);
      });
  }, [switching]);

  const updateServer = useCallback((server: DevServerSnapshot): void => {
    setWorkspace((current) => {
      if (!current) return current;
      const servers = current.servers.some(
        (candidate) => candidate.projectPath === server.projectPath,
      )
        ? current.servers.map((candidate) =>
            candidate.projectPath === server.projectPath ? server : candidate,
          )
        : [...current.servers, server];
      return { ...current, servers };
    });
  }, []);

  const changeServer = useCallback(
    (projectPath: string, action: "start" | "stop"): void => {
      if (serverBusy) return;
      setServerBusy(projectPath);
      setDevError(null);

      void fetch(`/api/dev/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath }),
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as
            | { server?: DevServerSnapshot; error?: { message?: string } }
            | null;
          if (!response.ok || !payload?.server) {
            setDevError(payload?.error?.message ?? "The project server request failed.");
            return;
          }
          updateServer(payload.server);
        })
        .catch((caught: unknown) => {
          setDevError(messageOf(caught));
        })
        .finally(() => {
          setServerBusy(null);
        });
    },
    [serverBusy, updateServer],
  );

  const startServer = useCallback(
    (projectPath: string): void => changeServer(projectPath, "start"),
    [changeServer],
  );

  const stopServer = useCallback(
    (projectPath: string): void => changeServer(projectPath, "stop"),
    [changeServer],
  );

  const attachFrontend = useCallback(
    (url: string): void => {
      if (frontendBusy) return;
      if (mode !== "live" || status !== "live") {
        setFrontendError("Start the live bridge to attach a local frontend.");
        return;
      }
      setFrontendBusy(true);
      setFrontendError(null);
      void fetch("/api/frontend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as
            | { frontend?: FrontendSnapshot; error?: { message?: string } }
            | null;
          if (!response.ok || !payload?.frontend) {
            setFrontendError(payload?.error?.message ?? "Could not attach the frontend.");
            return;
          }
          setFrontend(payload.frontend);
          try {
            window.localStorage.setItem(
              FRONTEND_STORAGE_KEY,
              payload.frontend.url ?? url,
            );
          } catch {
            // Storage is optional.
          }
        })
        .catch((caught: unknown) => {
          setFrontendError(messageOf(caught));
        })
        .finally(() => {
          setFrontendBusy(false);
        });
    },
    [frontendBusy, mode, status],
  );

  const detachFrontend = useCallback((): void => {
    if (frontendBusy) return;
    setFrontendBusy(true);
    setFrontendError(null);
    void fetch("/api/frontend", { method: "DELETE" })
      .then(async (response) => {
        if (!response.ok) {
          setFrontendError("Could not detach the frontend.");
          return;
        }
        setFrontend(EMPTY_FRONTEND);
        try {
          window.localStorage.removeItem(FRONTEND_STORAGE_KEY);
        } catch {
          // Storage is optional.
        }
      })
      .catch((caught: unknown) => {
        setFrontendError(messageOf(caught));
      })
      .finally(() => {
        setFrontendBusy(false);
      });
  }, [frontendBusy]);

  const refreshFrontend = useCallback((): void => {
    if (frontend.url) attachFrontend(frontend.url);
  }, [attachFrontend, frontend.url]);

  const captureFrontend = useCallback(
    async (request: CaptureFrontendRequest): Promise<CaptureFrontendOutcome> => {
      if (captureBusy) return { ok: false, error: "A capture is already running." };
      if (!frontend.url) {
        return { ok: false, error: "Attach a local frontend first." };
      }
      setCaptureBusy(true);
      try {
        const response = await fetch("/api/frontend/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              capture?: CaptureFrontendResult;
              error?: { message?: string };
            }
          | null;
        if (!response.ok || !payload?.capture) {
          return {
            ok: false,
            error: payload?.error?.message ?? "Could not capture the frontend.",
          };
        }
        return { ok: true, capture: payload.capture };
      } catch (caught) {
        return { ok: false, error: messageOf(caught) };
      } finally {
        setCaptureBusy(false);
      }
    },
    [captureBusy, frontend.url],
  );

  useEffect(() => {
    if (status === "disconnected") autoFrontendRef.current = false;
  }, [status]);

  useEffect(() => {
    if (
      autoFrontendRef.current ||
      mode !== "live" ||
      status !== "live" ||
      !bridge ||
      frontend.url
    ) {
      return;
    }
    autoFrontendRef.current = true;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(FRONTEND_STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (saved) attachFrontend(saved);
  }, [attachFrontend, bridge, frontend.url, mode, status]);

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
      pendingDesignRef.current.clear();
      setPending(0);
      setUndoStack([]);
      setRedoStack([]);
      setLastActor(null);
    };

    const applyPayload = (payload: DesignPayload, preserveHistory = false): string | null => {
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
        setSnapshots(payload.snapshots ?? {});
        setWorkspace(
          payload.workspace
            ? { ...payload.workspace, servers: payload.workspace.servers ?? [] }
            : null,
        );
        setBridge(payload.bridge ?? null);
        setFrontend(payload.frontend ?? EMPTY_FRONTEND);
        setRevision(payload.revision);
        setConflicts(0);
        setError(null);
        setFrontendError(null);
        setDevError(null);
        setServerBusy(null);
        setSwitching(false);
        if (!preserveHistory) clearHistory();
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

      const history: PageHistoryEntry = {
        kind: "page",
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

    const handleDocumentCommandResult = (message: DocumentCommandResultMessage): void => {
      const entry = pendingDesignRef.current.get(message.requestId);
      if (entry) pendingDesignRef.current.delete(message.requestId);
      setPending((count) => Math.max(0, count - 1));
      if (message.revision !== undefined) setRevision(message.revision);
      if (message.actor) setLastActor(message.actor);

      if (!message.ok) {
        setError(message.error?.message ?? "The bridge rejected the page command.");
        return;
      }
      setError(null);
      if (!message.inverse || !entry) return;

      const history: DocumentHistoryEntry = {
        kind: "design",
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
            const preserveHistory =
              message.reason === "designCommand" && pendingDesignRef.current.size > 0;
            const failure = applyPayload(message, preserveHistory);
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
          case "dev": {
            updateServer(message.server);
            break;
          }
          case "frontend": {
            setFrontend(message.frontend);
            break;
          }
          case "commandResult": {
            handleCommandResult(message);
            break;
          }
          case "designCommandResult": {
            handleDocumentCommandResult(message);
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
        pendingDesignRef.current.clear();
        setPending(0);
        setSwitching(false);
        setServerBusy(null);
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
    snapshots,
    assetUrl,
    workspace,
    switching,
    devError,
    serverBusy,
    sendCommand,
    undo,
    redo,
    openDesign,
    createPage,
    deletePage,
    renamePage,
    movePage,
    startServer,
    stopServer,
    bridge,
    frontend,
    frontendBusy,
    frontendError,
    captureBusy,
    attachFrontend,
    detachFrontend,
    refreshFrontend,
    captureFrontend,
  };
}
