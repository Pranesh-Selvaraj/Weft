import type { CommandActor, DesignManifest, DocumentCommand, PageCommand } from "@weft/core";
import type { SnapshotPayload } from "@weft/design-io";
import type { DevServerSnapshot } from "@weft/dev-server";
import type { MergeConflict } from "@weft/session";
import type { FrontendSnapshot } from "./frontend.js";

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

export interface WirePage {
  pageId: string;
  /** Base64-encoded Yjs state update for this page. */
  update: string;
}

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

export interface WorkspacePayload {
  file: string;
  activeDesignPath: string;
  projects: WorkspaceProjectInfo[];
  servers: DevServerSnapshot[];
}

export interface DesignPayload {
  revision: number;
  manifest: DesignManifest;
  pages: WirePage[];
  /** Sanitized HTML/CSS for each snapshot node that has payload files. */
  snapshots: Record<string, SnapshotPayload>;
  workspace?: WorkspacePayload;
  /** Runtime endpoints and active paths for the live panel. */
  bridge?: BridgeInfo;
  /** The explicitly attached local frontend target, if any. */
  frontend?: FrontendSnapshot;
}

export interface OpenDesignRequest {
  designPath: string;
}

export interface InitMessage extends DesignPayload {
  type: "init";
  /** Marks a rebuild caused by a document command so the initiator can keep its history. */
  reason?: "designCommand";
}

export interface UpdateMessage {
  type: "update";
  revision: number;
  pageId: string;
  update: string;
}

export interface ConflictMessage {
  type: "conflict";
  revision: number;
  pageId: string;
  conflicts: MergeConflict[];
}

export interface ErrorMessage {
  type: "error";
  revision?: number;
  message: string;
}

export interface PongMessage {
  type: "pong";
}

export interface DevServerMessage {
  type: "dev";
  server: DevServerSnapshot;
}

export interface FrontendMessage {
  type: "frontend";
  frontend: FrontendSnapshot;
}

export interface CommandRequestMessage {
  type: "command";
  requestId: string;
  pageId: string;
  command: PageCommand;
  actor?: CommandActor;
}

export interface CommandResultMessage {
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

export interface CommandBroadcastMessage {
  type: "command";
  revision: number;
  pageId: string;
  commandId: string;
  command: PageCommand;
  createdNodeIds: string[];
  actor?: CommandActor;
}

export interface DocumentCommandRequestMessage {
  type: "designCommand";
  requestId: string;
  command: DocumentCommand;
  actor?: CommandActor;
}

export interface DocumentCommandResultMessage {
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

export interface DocumentCommandBroadcastMessage {
  type: "designCommand";
  revision: number;
  commandId: string;
  command: DocumentCommand;
  createdPageIds: string[];
  removedPageIds: string[];
  actor?: CommandActor;
}

export type BridgeMessage =
  | InitMessage
  | UpdateMessage
  | ConflictMessage
  | ErrorMessage
  | PongMessage
  | DevServerMessage
  | FrontendMessage
  | CommandResultMessage
  | CommandBroadcastMessage
  | DocumentCommandResultMessage
  | DocumentCommandBroadcastMessage;

export type ClientMessage =
  | { type: "ping" | "refresh" }
  | CommandRequestMessage
  | DocumentCommandRequestMessage;

/** Encode a Yjs update for the JSON transport used by the local bridge. */
export function encodeUpdate(update: Uint8Array): string {
  return Buffer.from(update).toString("base64");
}
