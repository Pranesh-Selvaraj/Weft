/// <reference types="vite/client" />

declare module "virtual:weft-design" {
  const design: {
    manifest: import("@weft/core").DesignManifest;
    pages: import("@weft/core").PageDocument[];
    snapshots: Record<string, import("@weft/render").SnapshotPayload>;
  };
  export default design;
}
