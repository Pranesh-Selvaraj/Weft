import type { DesignManifest } from "@weft/core";
import type { MergeConflict } from "@weft/session";

export interface WirePage {
  pageId: string;
  /** Base64-encoded Yjs state update for this page. */
  update: string;
}

export interface DesignPayload {
  revision: number;
  manifest: DesignManifest;
  pages: WirePage[];
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

export type BridgeMessage =
  | InitMessage
  | UpdateMessage
  | ConflictMessage
  | ErrorMessage
  | PongMessage;

export interface ClientMessage {
  type: "ping" | "refresh";
}

/** Encode a Yjs update for the JSON transport used by the local bridge. */
export function encodeUpdate(update: Uint8Array): string {
  return Buffer.from(update).toString("base64");
}
