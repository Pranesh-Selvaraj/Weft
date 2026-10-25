import type { CommandActor, DesignManifest, PageCommand } from "@weft/core";
import type { MergeConflict } from "@weft/session";

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
}

export interface DesignPayload {
  revision: number;
  manifest: DesignManifest;
  pages: WirePage[];
  workspace?: WorkspacePayload;
}

export interface OpenDesignRequest {
  designPath: string;
}

export interface InitMessage extends DesignPayload {
  type: "init";
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

export type BridgeMessage =
  | InitMessage
  | UpdateMessage
  | ConflictMessage
  | ErrorMessage
  | PongMessage
  | CommandResultMessage
  | CommandBroadcastMessage;

export type ClientMessage =
  | { type: "ping" | "refresh" }
  | CommandRequestMessage;

/** Encode a Yjs update for the JSON transport used by the local bridge. */
export function encodeUpdate(update: Uint8Array): string {
  return Buffer.from(update).toString("base64");
}
