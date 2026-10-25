import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  applyDesignCommand,
  applyDocumentCommand,
  createCommandEnvelope,
  createPage,
  getPage,
  getPageRef,
  isId,
  newId,
  nextPageFile,
  parseJson,
  readDocumentCommand,
  readPageCommand,
  validateDesign,
  WeftCommandError,
  WeftOperationError,
  WeftParseError,
  WeftValidationError,
  type CommandActor,
  type DocumentCommand,
  type IdPrefix,
  type ValidationIssue,
} from "@weft/core";
import {
  formatDesign,
  initDesign,
  inspectDesign,
  readDesign,
  summarizeDesign,
  writeDesign,
  writeDocumentCommand,
  WeftIoError,
  type DesignInspection,
  type DesignSummary,
} from "@weft/design-io";
import { startBridge, WeftBridgeError, type WeftBridge } from "@weft/bridge";
import { extractSnapshot, ExtractError } from "@weft/extract";
import {
  addProject,
  listProjects,
  readWorkspace,
  removeProject,
  workspaceFilePath,
  writeWorkspace,
  WorkspaceError,
  type ProjectListing,
} from "@weft/workspace";
import { VERSION } from "./version.js";

export interface CliIO {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Reads the command payload when `--command` is omitted or is `-`. */
  stdin?: () => Promise<string>;
}

interface Parsed {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

type Writer = (line: string) => void;
type StdinReader = () => Promise<string>;
type OptionConfig = Record<string, { type: "string" | "boolean" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAIN_USAGE = `weft — agent-native design files

Usage:
  weft <command> <directory> [options]

Commands:
  init      Create a new design directory
  validate  Validate a design directory
  fmt       Rewrite the manifest and pages in canonical form
  inspect   Show pages, nodes, tokens and validation status
  apply     Apply a JSON command to a page
  get       Print a page or node as JSON
  id        Generate Weft ids for new entities or commands
  extract   Capture an allowlisted running page into a snapshot frame
  page      Create, remove or apply a page-level document command
  dev       Serve the live preview and watch a design directory
  workspace Register local projects and discover their designs
  help      Show help

Options:
  --json     Machine-readable output (where supported)
  --help     Show help
  --version  Show the version

Examples:
  weft init designs/marketing --name "Marketing"
  weft validate designs/marketing
  weft fmt designs/marketing --check
  weft inspect designs/marketing --json
  weft get designs/marketing --page Landing
  weft apply designs/marketing --command change.json
  weft extract designs/marketing http://127.0.0.1:3000/ --project ~/projects/marketing
  weft page create designs/marketing --name About
  weft dev designs/marketing
  weft workspace add ~/projects/marketing
  weft workspace list`;

const INIT_USAGE = `Usage: weft init <directory> [options]

Create weft.json and the first page for a new design.

Options:
  --name <name>   Design name (default: "Untitled design")
  --page <name>   First page name (default: "Page 1")
  --force         Replace weft.json and page files in a non-empty directory
  --json          Machine-readable output
  --help          Show this help`;

const VALIDATE_USAGE = `Usage: weft validate <directory> [options]

Validate the manifest, every page, cross-page ids, tokens, assets and snapshot
file references. Exits 1 when the design has issues.

Options:
  --no-files      Skip checks for asset and snapshot files on disk
  --json          Machine-readable output
  --help          Show this help`;

const FMT_USAGE = `Usage: weft fmt <directory> [options]

Rewrite weft.json and every page file in canonical form so identical designs
produce identical bytes.

Options:
  --check         Report files that need formatting; do not write
  --json          Machine-readable output
  --help          Show this help`;

const INSPECT_USAGE = `Usage: weft inspect <directory> [options]

Print a summary of the design, its pages, node counts, tokens and assets.

Options:
  --no-files      Skip checks for asset and snapshot files on disk
  --json          Machine-readable output
  --help          Show this help`;

const APPLY_USAGE = `Usage: weft apply <directory> [options]

Apply one JSON command to a page and write the design atomically. The input is
{"pageId":"pg_...","command":{...}}; read it from --command or stdin. The output
is always JSON and includes the inverse command for undo.

Options:
  --command <path>  Read the command from a file; "-" or omitted reads stdin
  --dry-run         Apply in memory, validate, and report the inverse without writing
  --help            Show this help`;

const GET_USAGE = `Usage: weft get <directory> (--page <id|name> | --node <id>) [options]

Print a page document or a node with its page context as JSON. The output is
always JSON so it can be piped into another tool.

Options:
  --page <id|name>  Print one page document
  --node <id>       Print one node and the page it belongs to
  --help            Show this help`;

const ID_USAGE = `Usage: weft id [options]

Generate new Weft ids. Node ids are printed by default.

Options:
  --prefix <p>   ds, pg, nd, as or cm (default: nd)
  --count <n>    Number of ids to generate, 1-100 (default: 1)
  --json         Machine-readable output
  --help         Show this help`;

const EXTRACT_USAGE = `Usage: weft extract <design.weft> <url> --project <root> [options]

Capture one allowlisted loopback page into a snapshot frame. The project's
weft.project.json must list the URL origin in extract.origins. The captured
markup is sanitized, scripts are removed, and images are inlined as data URLs.

Options:
  --project <root>     Registered project root containing weft.project.json
  --page <id|name>     Target page (default: the first page)
  --selector <css>     Element to capture (default: the page body)
  --viewport <WxH>     Capture viewport (default: 1440x900)
  --name <name>        Snapshot layer name
  --x <n> --y <n>      Snapshot position (default: below the page)
  --browser <path>     Chromium/Chrome executable (or WEFT_CHROMIUM)
  --timeout <ms>       Navigation/capture timeout (default: 30000)
  --max-asset-bytes <n> Per-image data URL cap (default: 2097152)
  --json               Machine-readable output
  --help               Show this help`;

const PAGE_USAGE = `Usage: weft page <create|remove|apply> <directory> [options]

Create, remove or apply a page-level document command. Page commands update the
manifest and page files and return an inverse, like node commands.

Commands:
  create    Create an empty page (--name)
  remove    Remove a page (--page <id|name>)
  apply     Apply a document command JSON file (--command; "-" or omitted reads stdin)

Options:
  --name <name>     Page name for "create"
  --page <id|name>  Page selector for "remove"
  --command <path>  Document command JSON for "apply"
  --json            Machine-readable output
  --help            Show this help`;

const DEV_USAGE = `Usage: weft dev <directory> [options]

Serve the built web preview and watch the design directory. The bridge streams
live page updates over WebSocket while a design file changes on disk.

Requires the web app to be built once with \`pnpm build\`.

Options:
  --port <n>   Port to listen on (default: 5250)
  --host <h>   Loopback host to bind: 127.0.0.1, localhost or ::1
               (default: 127.0.0.1)
  --help       Show this help`;

const WORKSPACE_USAGE = `Usage: weft workspace <command> [options]

Register local project roots so a Weft workspace can discover their designs.
The registry is an explicit allowlist; Weft does not scan your home directory.

Commands:
  init                    Create the workspace file if it does not exist
  add <project>           Register a project root
  list                    List registered projects and discovered designs
  remove <project|name>   Unregister a project
  dev                     Serve the live app with the registered workspace

Options:
  --file <path>     Workspace file (default: $WEFT_WORKSPACE or ~/.weft/workspace.json)
  --name <name>     Display name for "add"
  --design <path>   Initial design for "dev" (path or unique name)
  --port <n>        Port for "dev" (default: 5250)
  --host <h>        Loopback host for "dev" (default: 127.0.0.1)
  --json            Machine-readable output for init/add/list/remove
  --help            Show this help`;

const USAGE_BY_COMMAND: Record<string, string> = {
  init: INIT_USAGE,
  validate: VALIDATE_USAGE,
  fmt: FMT_USAGE,
  inspect: INSPECT_USAGE,
  apply: APPLY_USAGE,
  get: GET_USAGE,
  id: ID_USAGE,
  extract: EXTRACT_USAGE,
  page: PAGE_USAGE,
  dev: DEV_USAGE,
  workspace: WORKSPACE_USAGE,
};

const JSON_OPTION = { json: { type: "boolean" as const }, help: { type: "boolean" as const } };
const INIT_OPTIONS: OptionConfig = {
  name: { type: "string" },
  page: { type: "string" },
  force: { type: "boolean" },
  ...JSON_OPTION,
};
const FILE_OPTIONS: OptionConfig = {
  "no-files": { type: "boolean" },
  ...JSON_OPTION,
};
const FMT_OPTIONS: OptionConfig = {
  check: { type: "boolean" },
  ...JSON_OPTION,
};
const APPLY_OPTIONS: OptionConfig = {
  command: { type: "string" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean" },
};
const GET_OPTIONS: OptionConfig = {
  page: { type: "string" },
  node: { type: "string" },
  help: { type: "boolean" },
};
const ID_OPTIONS: OptionConfig = {
  prefix: { type: "string" },
  count: { type: "string" },
  ...JSON_OPTION,
};
const EXTRACT_OPTIONS: OptionConfig = {
  project: { type: "string" },
  page: { type: "string" },
  selector: { type: "string" },
  viewport: { type: "string" },
  name: { type: "string" },
  x: { type: "string" },
  y: { type: "string" },
  browser: { type: "string" },
  timeout: { type: "string" },
  "max-asset-bytes": { type: "string" },
  ...JSON_OPTION,
};
const PAGE_OPTIONS: OptionConfig = {
  name: { type: "string" },
  page: { type: "string" },
  command: { type: "string" },
  ...JSON_OPTION,
};
const DEV_OPTIONS: OptionConfig = {
  port: { type: "string" },
  host: { type: "string" },
  help: { type: "boolean" },
};
const WORKSPACE_OPTIONS: OptionConfig = {
  file: { type: "string" },
  name: { type: "string" },
  ...JSON_OPTION,
};
const WORKSPACE_DEV_OPTIONS: OptionConfig = {
  file: { type: "string" },
  design: { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  help: { type: "boolean" },
};
const ID_PREFIXES: IdPrefix[] = ["ds", "pg", "nd", "as", "cm"];

function emitJson(write: Writer, value: unknown): void {
  write(JSON.stringify(value, null, 2));
}

function printIssues(write: Writer, issues: ValidationIssue[]): void {
  for (const issue of issues) {
    write(`${issue.path || "<root>"} [${issue.code}] ${issue.message}`);
  }
}

function parseCommand(
  argv: string[],
  options: OptionConfig,
  usage: string,
  err: Writer,
): Parsed | null {
  try {
    return parseArgs({
      args: argv,
      options,
      allowPositionals: true,
      strict: true,
    }) as Parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err(message);
    err(usage);
    return null;
  }
}

function directoryFrom(
  positionals: string[],
  cwd: string,
  usage: string,
  err: Writer,
): string | null {
  if (positionals.length !== 1 || positionals[0].length === 0) {
    err("Expected exactly one <directory>.");
    err(usage);
    return null;
  }
  return resolve(cwd, positionals[0]);
}

function handleError(
  error: unknown,
  json: boolean,
  out: Writer,
  err: Writer,
): number {
  if (error instanceof WeftValidationError) {
    if (json) emitJson(out, { ok: false, issues: error.issues });
    else printIssues(err, error.issues);
    return 1;
  }
  if (
    error instanceof WeftIoError ||
    error instanceof WeftCommandError ||
    error instanceof WeftOperationError ||
    error instanceof WeftBridgeError ||
    error instanceof WorkspaceError ||
    error instanceof ExtractError
  ) {
    if (json) emitJson(out, { ok: false, error: { code: error.code, message: error.message } });
    else err(`${error.code}: ${error.message}`);
    return 1;
  }
  if (error instanceof WeftParseError) {
    if (json) emitJson(out, { ok: false, error: { code: "json.invalid", message: error.message } });
    else err(error.message);
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (json) emitJson(out, { ok: false, error: { code: "error", message } });
  else err(message);
  return 1;
}

function summaryLine(summary: DesignSummary): string {
  const types = Object.entries(summary.nodeTypes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
  return `${summary.pageCount} page(s), ${summary.nodeCount} node(s)${types ? ` (${types})` : ""}`;
}

function printInspectionSummary(write: Writer, summary: DesignSummary): void {
  write(`${summary.name} (${summary.id})`);
  write("Pages:");
  for (const page of summary.pages) {
    write(`  ${page.name}  ${page.id}  ${page.nodeCount} node(s)  ${page.file}`);
  }
  write(`Nodes: ${summary.nodeCount}`);
  write(`Tokens: ${summary.tokenCount}  Assets: ${summary.assetCount}  Snapshots: ${summary.snapshotCount}`);
}

function inspectionPayload(inspection: DesignInspection): {
  summary?: DesignSummary;
  issues: ValidationIssue[];
  ok: boolean;
} {
  return {
    summary: inspection.manifest
      ? summarizeDesign(inspection.manifest, inspection.pages, inspection.pageFiles)
      : undefined,
    issues: inspection.issues,
    ok: inspection.issues.length === 0,
  };
}

async function initCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, INIT_OPTIONS, INIT_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(INIT_USAGE);
    return 0;
  }
  const directory = directoryFrom(parsed.positionals, cwd, INIT_USAGE, err);
  if (!directory) return 2;
  const json = parsed.values.json === true;

  try {
    const result = await initDesign(directory, {
      name: typeof parsed.values.name === "string" ? parsed.values.name : undefined,
      pageName: typeof parsed.values.page === "string" ? parsed.values.page : undefined,
      force: parsed.values.force === true,
    });
    const summary = summarizeDesign(result.design.manifest, result.design.pages);
    if (json) {
      emitJson(out, { ok: true, directory: result.directory, summary });
    } else {
      const page = result.design.manifest.pages[0];
      out(`Created ${JSON.stringify(result.design.manifest.name)} at ${result.directory} (page ${page.file}).`);
    }
    return 0;
  } catch (error) {
    return handleError(error, json, out, err);
  }
}

async function validateCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, FILE_OPTIONS, VALIDATE_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(VALIDATE_USAGE);
    return 0;
  }
  const directory = directoryFrom(parsed.positionals, cwd, VALIDATE_USAGE, err);
  if (!directory) return 2;
  const json = parsed.values.json === true;

  try {
    const inspection = await inspectDesign(directory, {
      requireFiles: parsed.values["no-files"] !== true,
    });
    const payload = inspectionPayload(inspection);
    if (json) {
      emitJson(out, { ...payload, directory: inspection.directory });
    } else if (payload.ok && payload.summary) {
      out(`Valid: ${payload.summary.name} — ${summaryLine(payload.summary)}.`);
    } else {
      printIssues(err, inspection.issues);
      err(`${inspection.issues.length} issue(s).`);
    }
    return payload.ok ? 0 : 1;
  } catch (error) {
    return handleError(error, json, out, err);
  }
}

async function fmtCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, FMT_OPTIONS, FMT_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(FMT_USAGE);
    return 0;
  }
  const directory = directoryFrom(parsed.positionals, cwd, FMT_USAGE, err);
  if (!directory) return 2;
  const json = parsed.values.json === true;
  const check = parsed.values.check === true;

  try {
    const inspection = await inspectDesign(directory, { requireFiles: false });
    if (inspection.issues.length > 0) {
      if (json) emitJson(out, { ok: false, directory: inspection.directory, issues: inspection.issues });
      else {
        printIssues(err, inspection.issues);
        err(`${inspection.issues.length} issue(s); nothing was written.`);
      }
      return 1;
    }

    const result = await formatDesign(directory, { write: !check });
    const ok = !check || result.changed.length === 0;
    if (json) {
      emitJson(out, {
        ok,
        directory: result.directory,
        check,
        changed: result.changed,
        files: result.files,
        issues: [],
      });
    } else if (result.changed.length === 0) {
      out("Already canonical.");
    } else if (check) {
      out("Needs formatting:");
      for (const file of result.changed) out(`  ${file}`);
    } else {
      out("Formatted:");
      for (const file of result.changed) out(`  ${file}`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    return handleError(error, json, out, err);
  }
}

async function inspectCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, FILE_OPTIONS, INSPECT_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(INSPECT_USAGE);
    return 0;
  }
  const directory = directoryFrom(parsed.positionals, cwd, INSPECT_USAGE, err);
  if (!directory) return 2;
  const json = parsed.values.json === true;

  try {
    const inspection = await inspectDesign(directory, {
      requireFiles: parsed.values["no-files"] !== true,
    });
    const payload = inspectionPayload(inspection);
    if (json) {
      emitJson(out, { ...payload, directory: inspection.directory });
    } else if (payload.summary) {
      printInspectionSummary(out, payload.summary);
      out(`Status: ${payload.ok ? "valid" : `${inspection.issues.length} issue(s)`}`);
      if (!payload.ok) printIssues(err, inspection.issues);
    } else {
      printIssues(err, inspection.issues);
    }
    return payload.ok ? 0 : 1;
  } catch (error) {
    return handleError(error, json, out, err);
  }
}

async function readStdinDefault(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Uint8Array | string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseActor(value: unknown): CommandActor | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new WeftCommandError("command.actor", "actor must be a JSON object.");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new WeftCommandError("command.actor", "actor.id must be a non-empty string.");
  }
  if (value.kind !== "human" && value.kind !== "agent" && value.kind !== "system") {
    throw new WeftCommandError(
      "command.actor",
      'actor.kind must be "human", "agent" or "system".',
    );
  }
  if (value.name !== undefined && typeof value.name !== "string") {
    throw new WeftCommandError("command.actor", "actor.name must be a string when present.");
  }
  return {
    id: value.id,
    kind: value.kind,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
  };
}

interface ApplyInput {
  pageId: string;
  command: ReturnType<typeof readPageCommand>;
  actor?: CommandActor;
  id?: string;
  timestamp?: string;
}

function parseApplyInput(text: string): ApplyInput {
  const raw = parseJson(text);
  if (!isRecord(raw)) {
    throw new WeftCommandError("command.input", "Command input must be a JSON object.");
  }
  if (typeof raw.pageId !== "string" || !isId(raw.pageId, "pg")) {
    throw new WeftCommandError("command.page", "pageId must be a pg_ ULID.");
  }
  const command = readPageCommand(raw.command);
  const actor = parseActor(raw.actor);
  let id: string | undefined;
  if (raw.id !== undefined) {
    if (typeof raw.id !== "string" || !isId(raw.id, "cm")) {
      throw new WeftCommandError("command.id", "id must be a cm_ ULID when present.");
    }
    id = raw.id;
  }
  let timestamp: string | undefined;
  if (raw.timestamp !== undefined) {
    if (typeof raw.timestamp !== "string" || Number.isNaN(Date.parse(raw.timestamp))) {
      throw new WeftCommandError("command.timestamp", "timestamp must be an ISO date string.");
    }
    timestamp = raw.timestamp;
  }
  return { pageId: raw.pageId, command, actor, id, timestamp };
}

async function readCommandText(
  option: string | boolean | undefined,
  cwd: string,
  stdin: StdinReader,
): Promise<string> {
  if (typeof option === "string" && option !== "-") {
    const path = resolve(cwd, option);
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WeftIoError("command.read", path, `Could not read command file: ${message}`);
    }
  }
  return stdin();
}

async function applyCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
  stdin: StdinReader,
): Promise<number> {
  const parsed = parseCommand(argv, APPLY_OPTIONS, APPLY_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(APPLY_USAGE);
    return 0;
  }
  const directory = directoryFrom(parsed.positionals, cwd, APPLY_USAGE, err);
  if (!directory) return 2;

  try {
    const text = await readCommandText(parsed.values.command, cwd, stdin);
    const request = parseApplyInput(text);
    const design = await readDesign(directory, { requireFiles: false });
    const envelope = createCommandEnvelope({
      pageId: request.pageId,
      command: request.command,
      actor: request.actor,
      id: request.id,
      timestamp: request.timestamp,
    });
    const result = applyDesignCommand(design, envelope.pageId, envelope.command);
    const dryRun = parsed.values["dry-run"] === true;
    let written: string[] = [];

    if (dryRun) {
      const issues = validateDesign(result.design.manifest, result.design.pages);
      if (issues.length > 0) throw new WeftValidationError(issues);
    } else {
      const writeResult = await writeDesign(directory, result.design);
      written = writeResult.written;
    }

    emitJson(out, {
      ok: true,
      commandId: envelope.id,
      pageId: envelope.pageId,
      applied: envelope.command,
      inverse: result.inverse,
      createdNodeIds: result.createdNodeIds,
      dryRun,
      written,
    });
    return 0;
  } catch (error) {
    return handleError(error, true, out, err);
  }
}

async function getCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, GET_OPTIONS, GET_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(GET_USAGE);
    return 0;
  }
  const hasPage = typeof parsed.values.page === "string";
  const hasNode = typeof parsed.values.node === "string";
  if (hasPage === hasNode) {
    err("Pass exactly one of --page or --node.");
    err(GET_USAGE);
    return 2;
  }
  const directory = directoryFrom(parsed.positionals, cwd, GET_USAGE, err);
  if (!directory) return 2;

  try {
    const design = await readDesign(directory, { requireFiles: false });
    if (hasPage) {
      const page = getPage(design, parsed.values.page as string);
      if (!page) {
        throw new WeftCommandError(
          "page.missing",
          `No page matches ${JSON.stringify(parsed.values.page)}.`,
        );
      }
      emitJson(out, page);
      return 0;
    }

    const nodeId = parsed.values.node as string;
    for (const page of design.pages) {
      const node = page.nodes[nodeId];
      if (!node) continue;
      const ref = getPageRef(design.manifest, page.id);
      emitJson(out, { pageId: page.id, pageFile: ref?.file ?? "", node });
      return 0;
    }
    throw new WeftCommandError("node.missing", `No node matches ${JSON.stringify(nodeId)}.`);
  } catch (error) {
    return handleError(error, true, out, err);
  }
}

async function idCommand(
  argv: string[],
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, ID_OPTIONS, ID_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(ID_USAGE);
    return 0;
  }
  if (parsed.positionals.length !== 0) {
    err("weft id does not take a directory.");
    err(ID_USAGE);
    return 2;
  }

  const prefix = typeof parsed.values.prefix === "string" ? parsed.values.prefix : "nd";
  if (!ID_PREFIXES.includes(prefix as IdPrefix)) {
    err(`Unknown prefix ${JSON.stringify(prefix)}.`);
    err(ID_USAGE);
    return 2;
  }
  const count = parsed.values.count === undefined ? 1 : Number(parsed.values.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    err("--count must be an integer between 1 and 100.");
    return 2;
  }

  const ids = Array.from({ length: count }, () => newId(prefix as IdPrefix));
  if (parsed.values.json === true) {
    emitJson(out, { ok: true, ids });
  } else {
    for (const id of ids) out(id);
  }
  return 0;
}

function parseViewport(value: string | undefined): { width: number; height: number } | null {
  if (value === undefined) return { width: 1440, height: 900 };
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return null;
  }
  return { width, height };
}

function optionalNumber(
  value: string | boolean | undefined,
  label: string,
  err: Writer,
): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    err(`${label} requires a number.`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    err(`${label} must be a finite number.`);
    return null;
  }
  return parsed;
}

async function extractCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, EXTRACT_OPTIONS, EXTRACT_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(EXTRACT_USAGE);
    return 0;
  }
  if (parsed.positionals.length !== 2) {
    err("Expected <design.weft> and <url>.");
    out(EXTRACT_USAGE);
    return 2;
  }
  const projectValue = parsed.values.project;
  if (typeof projectValue !== "string" || projectValue.length === 0) {
    err("--project <root> is required.");
    out(EXTRACT_USAGE);
    return 2;
  }
  const viewport = parseViewport(
    typeof parsed.values.viewport === "string" ? parsed.values.viewport : undefined,
  );
  if (!viewport) {
    err("--viewport must look like 1440x900.");
    return 2;
  }
  const x = optionalNumber(parsed.values.x, "--x", err);
  if (x === null) return 2;
  const y = optionalNumber(parsed.values.y, "--y", err);
  if (y === null) return 2;
  let timeoutMs: number | undefined;
  if (parsed.values.timeout !== undefined) {
    const parsedTimeout = optionalNumber(parsed.values.timeout, "--timeout", err);
    if (parsedTimeout === null) return 2;
    if (parsedTimeout === undefined || !Number.isInteger(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
      err("--timeout must be an integer between 1000 and 120000.");
      return 2;
    }
    timeoutMs = parsedTimeout;
  }
  let maxAssetBytes: number | undefined;
  if (parsed.values["max-asset-bytes"] !== undefined) {
    const parsedMax = optionalNumber(
      parsed.values["max-asset-bytes"],
      "--max-asset-bytes",
      err,
    );
    if (parsedMax === null) return 2;
    if (parsedMax === undefined || !Number.isInteger(parsedMax) || parsedMax < 0 || parsedMax > 8 * 1024 * 1024) {
      err("--max-asset-bytes must be an integer between 0 and 8388608.");
      return 2;
    }
    maxAssetBytes = parsedMax;
  }

  try {
    const result = await extractSnapshot({
      projectRoot: resolve(cwd, projectValue),
      designDir: resolve(cwd, parsed.positionals[0]),
      url: parsed.positionals[1],
      viewport,
      ...(typeof parsed.values.page === "string" ? { page: parsed.values.page } : {}),
      ...(typeof parsed.values.selector === "string"
        ? { selector: parsed.values.selector }
        : {}),
      ...(typeof parsed.values.name === "string" ? { name: parsed.values.name } : {}),
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
      ...(typeof parsed.values.browser === "string"
        ? { browserPath: resolve(cwd, parsed.values.browser) }
        : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(maxAssetBytes !== undefined ? { maxAssetBytes } : {}),
    });
    if (parsed.values.json) {
      emitJson(out, { ok: true, ...result });
    } else {
      out(`Captured ${result.source.url}`);
      out(
        `Snapshot ${result.node.id} · ${Math.round(result.node.width)}×${Math.round(result.node.height)} · ${result.node.name}`,
      );
      out(`Page ${result.pageId} (${result.pageFile})`);
      out(`Payload ${result.files.html}${result.files.css ? ` + ${result.files.css}` : ""}`);
      if (result.warnings.length > 0) {
        out(`Warnings: ${result.warnings.length}`);
        for (const warning of result.warnings) out(`  ${warning}`);
      }
    }
    return 0;
  } catch (error) {
    return handleError(error, parsed.values.json === true, out, err);
  }
}

async function pageCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
  stdin: StdinReader,
): Promise<number> {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    out(PAGE_USAGE);
    return subcommand ? 0 : 2;
  }
  const parsed = parseCommand(argv.slice(1), PAGE_OPTIONS, PAGE_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(PAGE_USAGE);
    return 0;
  }
  const directory = directoryFrom(parsed.positionals, cwd, PAGE_USAGE, err);
  if (!directory) return 2;
  const json = parsed.values.json === true;

  try {
    const design = await readDesign(directory, { requireFiles: false });
    let command: DocumentCommand;
    let label: string;
    if (subcommand === "create") {
      const name =
        typeof parsed.values.name === "string" && parsed.values.name.trim().length > 0
          ? parsed.values.name.trim()
          : `Page ${design.pages.length + 1}`;
      const page = createPage({ name });
      command = { type: "page.create", page, file: nextPageFile(design.manifest, name) };
      label = `Created page ${JSON.stringify(name)}`;
    } else if (subcommand === "remove") {
      if (typeof parsed.values.page !== "string" || parsed.values.page.length === 0) {
        err("--page <id|name> is required for page remove.");
        return 2;
      }
      const page = getPage(design, parsed.values.page);
      if (!page) {
        err(`No page matches ${JSON.stringify(parsed.values.page)}.`);
        return 1;
      }
      command = { type: "page.remove", pageId: page.id };
      label = `Removed page ${JSON.stringify(page.name)}`;
    } else if (subcommand === "apply") {
      const text = await readCommandText(parsed.values.command, cwd, stdin);
      command = readDocumentCommand(parseJson(text));
      label = `Applied ${command.type}`;
    } else {
      err(`Unknown page command: ${subcommand}`);
      out(PAGE_USAGE);
      return 2;
    }

    const applied = applyDocumentCommand(design, command);
    const written = await writeDocumentCommand(directory, command, applied);
    const payload = {
      ok: true,
      command,
      inverse: applied.inverse,
      createdPageIds: applied.createdPageIds,
      removedPageIds: applied.removedPageIds,
      files: written,
      summary: {
        pages: applied.design.pages.length,
        name: applied.design.manifest.name,
      },
    };
    if (json) {
      emitJson(out, payload);
    } else if (command.type === "page.create") {
      out(`${label} at ${command.file} (${command.page.id}).`);
      out(`Inverse: page.remove ${command.page.id}`);
    } else if (command.type === "page.remove") {
      out(`${label}.`);
      out("The inverse contains the removed page and can be applied with page apply.");
    } else {
      out(label);
      out(`Pages: ${applied.design.pages.length}`);
    }
    for (const orphan of written.orphaned) {
      err(`warning: page file left on disk: ${orphan}`);
    }
    return 0;
  } catch (error) {
    return handleError(error, json, out, err);
  }
}

async function devCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, DEV_OPTIONS, DEV_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(DEV_USAGE);
    return 0;
  }
  const directory = directoryFrom(parsed.positionals, cwd, DEV_USAGE, err);
  if (!directory) return 2;

  const port = parsed.values.port === undefined ? 5250 : Number(parsed.values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    err("--port must be an integer between 0 and 65535.");
    return 2;
  }
  const host =
    typeof parsed.values.host === "string" && parsed.values.host.length > 0
      ? parsed.values.host
      : "127.0.0.1";

  try {
    const bridge = await startBridge({ designDir: directory, host, port });
    out(`Weft dev · ${bridge.url}`);
    out(`Watching ${bridge.designDir}`);
    out("Press Ctrl+C to stop.");
    await waitForBridgeStop(bridge);
    return 0;
  } catch (error) {
    return handleError(error, false, out, err);
  }
}

function workspaceFileFrom(
  value: string | boolean | undefined,
  cwd: string,
): string {
  return typeof value === "string"
    ? resolve(cwd, value)
    : workspaceFilePath();
}

function printProjects(write: Writer, projects: ProjectListing[]): void {
  if (projects.length === 0) {
    write("No projects registered.");
    return;
  }
  for (const project of projects) {
    write(`${project.name}  ${project.path}`);
    if (!project.exists) {
      write(`  ! ${project.error ?? "project is missing"}`);
      continue;
    }
    for (const design of project.designs) {
      write(`  ${design.name}  ${design.path}`);
    }
    if (project.designs.length === 0) write("  (no designs found)");
  }
}

async function waitForBridgeStop(bridge: WeftBridge): Promise<void> {
  await new Promise<void>((resolveStop) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void bridge.close().finally(() => resolveStop());
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

async function workspaceDevCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const parsed = parseCommand(argv, WORKSPACE_DEV_OPTIONS, WORKSPACE_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(WORKSPACE_USAGE);
    return 0;
  }

  const file = workspaceFileFrom(parsed.values.file, cwd);
  const config = await readWorkspace(file);
  const projects = await listProjects(config);
  const designs = projects.flatMap((project) => project.designs);
  if (designs.length === 0) {
    err(`No designs found in workspace ${file}. Run weft workspace add <project> first.`);
    return 1;
  }

  let selected = designs[0];
  if (typeof parsed.values.design === "string") {
    const selector = parsed.values.design;
    const selectorPath = resolve(cwd, selector);
    const matches = designs.filter(
      (design) =>
        design.path === selectorPath ||
        design.path === selector ||
        design.name === selector,
    );
    if (matches.length === 0) {
      err(`No design matches ${JSON.stringify(selector)} in ${file}.`);
      return 1;
    }
    if (matches.length > 1) {
      err(`Design name ${JSON.stringify(selector)} is ambiguous; pass a path instead.`);
      return 1;
    }
    selected = matches[0];
  }

  const port = parsed.values.port === undefined ? 5250 : Number(parsed.values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    err("--port must be an integer between 0 and 65535.");
    return 2;
  }
  const host =
    typeof parsed.values.host === "string" && parsed.values.host.length > 0
      ? parsed.values.host
      : "127.0.0.1";

  try {
    const bridge = await startBridge({
      designDir: selected.path,
      workspaceFile: file,
      host,
      port,
    });
    out(`Weft workspace · ${bridge.url}`);
    out(`Workspace · ${file}`);
    out(`Design · ${selected.name} (${selected.path})`);
    out("Press Ctrl+C to stop.");
    await waitForBridgeStop(bridge);
    return 0;
  } catch (error) {
    return handleError(error, false, out, err);
  }
}

async function workspaceCommand(
  argv: string[],
  cwd: string,
  out: Writer,
  err: Writer,
): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    out(WORKSPACE_USAGE);
    return 0;
  }

  if (subcommand === "dev") {
    return workspaceDevCommand(rest, cwd, out, err);
  }

  const parsed = parseCommand(rest, WORKSPACE_OPTIONS, WORKSPACE_USAGE, err);
  if (!parsed) return 2;
  if (parsed.values.help) {
    out(WORKSPACE_USAGE);
    return 0;
  }

  const file = workspaceFileFrom(parsed.values.file, cwd);
  const json = parsed.values.json === true;

  try {
    if (subcommand === "init") {
      let exists = true;
      try {
        await stat(file);
      } catch {
        exists = false;
      }
      const config = await readWorkspace(file);
      if (!exists) await writeWorkspace(config, file);
      if (json) {
        emitJson(out, { ok: true, file, projects: config.projects.length, created: !exists });
      } else {
        out(`${exists ? "Workspace already exists" : "Created workspace"} at ${file}.`);
      }
      return 0;
    }

    if (subcommand === "add") {
      const projectPath = parsed.positionals[0];
      if (!projectPath) {
        err("Missing <project>.");
        err(WORKSPACE_USAGE);
        return 2;
      }
      const result = await addProject(projectPath, {
        file,
        cwd,
        name: typeof parsed.values.name === "string" ? parsed.values.name : undefined,
      });
      if (json) {
        emitJson(out, {
          ok: true,
          file: result.file,
          project: result.project,
          projects: result.config.projects.length,
        });
      } else {
        out(`Registered ${result.project.name} at ${result.project.path}.`);
      }
      return 0;
    }

    if (subcommand === "list") {
      if (parsed.positionals.length > 0) {
        err("weft workspace list does not take a project argument.");
        return 2;
      }
      const config = await readWorkspace(file);
      const projects = await listProjects(config);
      if (json) {
        emitJson(out, { ok: true, file, projects });
      } else {
        out(`Workspace ${file}`);
        printProjects(out, projects);
      }
      return 0;
    }

    if (subcommand === "remove") {
      const selector = parsed.positionals[0];
      if (!selector) {
        err("Missing <project|name>.");
        err(WORKSPACE_USAGE);
        return 2;
      }
      const result = await removeProject(selector, { file, cwd });
      if (json) {
        emitJson(out, {
          ok: true,
          file: result.file,
          project: result.project,
          projects: result.config.projects.length,
        });
      } else {
        out(`Removed ${result.project.name} (${result.project.path}).`);
      }
      return 0;
    }

    err(`Unknown workspace command: ${subcommand}`);
    out(WORKSPACE_USAGE);
    return 2;
  } catch (error) {
    return handleError(error, json, out, err);
  }
}

export async function runCli(argv: string[], io: CliIO = {}): Promise<number> {
  const out = io.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = io.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const cwd = io.cwd ?? process.cwd();
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    out(MAIN_USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    out(VERSION);
    return 0;
  }
  if (command === "help") {
    const subcommand = rest[0];
    if (!subcommand) {
      out(MAIN_USAGE);
      return 0;
    }
    const usage = USAGE_BY_COMMAND[subcommand];
    if (!usage) {
      err(`Unknown command: ${subcommand}`);
      out(MAIN_USAGE);
      return 2;
    }
    out(usage);
    return 0;
  }

  try {
    switch (command) {
      case "init":
        return await initCommand(rest, cwd, out, err);
      case "validate":
        return await validateCommand(rest, cwd, out, err);
      case "fmt":
        return await fmtCommand(rest, cwd, out, err);
      case "inspect":
        return await inspectCommand(rest, cwd, out, err);
      case "apply":
        return await applyCommand(rest, cwd, out, err, io.stdin ?? readStdinDefault);
      case "get":
        return await getCommand(rest, cwd, out, err);
      case "id":
        return await idCommand(rest, out, err);
      case "extract":
        return await extractCommand(rest, cwd, out, err);
      case "page":
        return await pageCommand(rest, cwd, out, err, io.stdin ?? readStdinDefault);
      case "dev":
        return await devCommand(rest, cwd, out, err);
      case "workspace":
        return await workspaceCommand(rest, cwd, out, err);
      default:
        err(`Unknown command: ${command}`);
        out(MAIN_USAGE);
        return 2;
    }
  } catch (error) {
    return handleError(error, rest.includes("--json"), out, err);
  }
}
