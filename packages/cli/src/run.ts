import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  WeftParseError,
  WeftValidationError,
  type ValidationIssue,
} from "@weft/core";
import {
  formatDesign,
  initDesign,
  inspectDesign,
  summarizeDesign,
  WeftIoError,
  type DesignInspection,
  type DesignSummary,
} from "@weft/design-io";
import { VERSION } from "./version.js";

export interface CliIO {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface Parsed {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

type Writer = (line: string) => void;
type OptionConfig = Record<string, { type: "string" | "boolean" }>;

const MAIN_USAGE = `weft — agent-native design files

Usage:
  weft <command> <directory> [options]

Commands:
  init      Create a new design directory
  validate  Validate a design directory
  fmt       Rewrite the manifest and pages in canonical form
  inspect   Show pages, nodes, tokens and validation status
  help      Show help

Options:
  --json     Machine-readable output
  --help     Show help
  --version  Show the version

Examples:
  weft init designs/marketing --name "Marketing"
  weft validate designs/marketing
  weft fmt designs/marketing --check
  weft inspect designs/marketing --json`;

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

const USAGE_BY_COMMAND: Record<string, string> = {
  init: INIT_USAGE,
  validate: VALIDATE_USAGE,
  fmt: FMT_USAGE,
  inspect: INSPECT_USAGE,
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
  if (error instanceof WeftIoError) {
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
      default:
        err(`Unknown command: ${command}`);
        out(MAIN_USAGE);
        return 2;
    }
  } catch (error) {
    return handleError(error, rest.includes("--json"), out, err);
  }
}
