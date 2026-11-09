/**
 * @module ExaCtlOutput
 * @path apps/exactl/src/output/exactl_output.ts
 * @description Renders exactl command results in one of five formats through an output sink and resolves the format from the global options.
 * @architectural-layer CLI
 * @dependencies [@cliffy/table, @exaix/cli, @exaix/core]
 * @related-files [packages/cli/src/types/exactl_output_types.ts, apps/exactl/src/exactl.ts]
 */

import { Table } from "@cliffy/table";
import {
  ExaCtlOutputFormat,
  type IExaCtlColumn,
  type IExaCtlGlobalOptions,
  type IExaCtlOutputRenderer,
  type IExaCtlOutputSink,
} from "@exaix/cli";
import type { JSONValue } from "@exaix/core";
import { type IDisplayService, type Opt, type Reason, toSafeJson } from "@exaix/core/types";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { OPTION_TERMINATOR } from "../exactl_renames.ts";

/** A JSON object whose values the renderer can print. */
export interface IJsonRow {
  [key: string]: JSONValue;
}

/** What a state-changing verb reports with --json: the entity id, the verb and the status the verb set. */
export interface IMutationResult {
  [key: string]: JSONValue;
  id: string;
  action: string;
  status: string;
}

/** The JSON form of a stored entity: its own fields, with `undefined` ones dropped. */
export function toRow<T extends object>(value: T): IJsonRow {
  return toSafeJson(Object.fromEntries(Object.entries(value))) as IJsonRow;
}

/** Column headers shared by the list and item renderings of several nouns. */
export enum ColumnHeader {
  ID = "ID",
  STATUS = "Status",
  TRACE = "Trace",
  SUBJECT = "Subject",
  KIND = "Kind",
  AGENT = "Agent",
  PORTAL = "Portal",
  PRIORITY = "Priority",
  CREATED = "Created",
  BRANCH = "Branch",
  TYPE = "Type",
  REQUEST = "Request",
  SUMMARY = "Summary",
  ACTION = "Action",
  REVISION = "Revision",
}

const MUTATION_COLUMNS: readonly IExaCtlColumn<IMutationResult>[] = [
  { header: ColumnHeader.ID, value: (result) => result.id },
  { header: ColumnHeader.ACTION, value: (result) => result.action },
  { header: ColumnHeader.STATUS, value: (result) => result.status },
];

/** How many leading characters of a trace id a table cell shows. */
export const TRACE_PREFIX_CHARS = 8;

/** The cell text for a value that is absent. */
export const EMPTY_CELL = "-";

/** The text of a string cell value, or the empty-cell mark for anything else. */
export function cellText(value: Opt<JSONValue, Reason.OptionalInput>): string {
  return typeof value === "string" && value !== "" ? value : EMPTY_CELL;
}

const NO_COLOR_FLAG = "--no-color";
const NO_COLOR_ENV = "NO_COLOR";
const JSON_FLAG = "--json";
const OUTPUT_FLAGS: ReadonlySet<string> = new Set(["-o", "--output"]);
const OUTPUT_ATTACHED = /^(?:--output=|-o)/;
const MACHINE_FORMATS: ReadonlySet<string> = new Set([ExaCtlOutputFormat.JSON, ExaCtlOutputFormat.JSONL]);
const JSON_INDENT = 2;
const LINE_END = "\n";
const TAB = "\t";
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC_SEQUENCE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, "g");
const CSI_SEQUENCE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const OTHER_ESCAPE = new RegExp(`${ESC}[\\s\\S]?`, "g");
const CONTROL_CHARACTER = /\p{Cc}/gu;
const KEPT_CONTROLS: ReadonlySet<string> = new Set([LINE_END, TAB]);
const MD_CELL_BREAK = /\r?\n/g;
const MD_PIPE = /\|/g;
const ITEM_HEADERS: readonly string[] = ["Field", "Value"];

const encoder = new TextEncoder();

/** The part of a process environment this module reads. */
interface IEnvironmentReader {
  get(key: string): string | undefined;
}

/** Writes every byte of `text`. A reader that closed its end ends the write without an error. */
async function writeAll(stream: { write(bytes: Uint8Array): Promise<number> }, text: string): Promise<void> {
  const bytes = encoder.encode(text);
  let offset = 0;
  try {
    while (offset < bytes.length) offset += await stream.write(bytes.subarray(offset));
  } catch (error) {
    if (!(error instanceof Deno.errors.BrokenPipe)) throw error;
  }
}

/** The process streams. `Deno.stdout.write` may write fewer bytes than asked on a full pipe, so the loop continues. */
export const defaultOutputSink: IExaCtlOutputSink = {
  out: (text) => writeAll(Deno.stdout, text),
  err: (text) => writeAll(Deno.stderr, text),
};

/** Removes terminal control characters and escape sequences from text that comes from agents, journals or files. */
export function stripTerminalControls(text: string): string {
  return text
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(OTHER_ESCAPE, "")
    .replace(CONTROL_CHARACTER, (character) => KEPT_CONTROLS.has(character) ? character : "");
}

function attachedFormat(word: string): string {
  const match = OUTPUT_ATTACHED.exec(word);
  return match === null ? "" : word.slice(match[0].length);
}

/** True when argv asks for JSON output: `--json`, or `-o`/`--output` with `json` or `jsonl`, in any spelling. */
export function isJsonOutputRequested(argv: readonly string[]): boolean {
  const terminator = argv.indexOf(OPTION_TERMINATOR);
  const words = terminator === -1 ? argv : argv.slice(0, terminator);
  return words.some((word, index) =>
    word === JSON_FLAG || MACHINE_FORMATS.has(attachedFormat(word)) ||
    (OUTPUT_FLAGS.has(word) && MACHINE_FORMATS.has(words[index + 1] ?? ""))
  );
}

/** True for `--no-color` before the option terminator and for a non-empty `NO_COLOR`. */
export function isColorDisabled(argv: readonly string[], env: IEnvironmentReader): boolean {
  const terminator = argv.indexOf(OPTION_TERMINATOR);
  const options = terminator === -1 ? argv : argv.slice(0, terminator);
  return options.includes(NO_COLOR_FLAG) || (env.get(NO_COLOR_ENV) ?? "") !== "";
}

/** The global options of a command action. Cliffy merges them into every action's options object. */
export function readGlobalOptions<T extends object | void>(options: T): IExaCtlGlobalOptions {
  return (typeof options === "object" ? options : {}) as IExaCtlGlobalOptions;
}

/** `--json` means `-o json`. It cannot be combined with another `-o` format. Without either, the verb default applies. */
export function resolveOutputFormat(
  options: IExaCtlGlobalOptions,
  verbDefault: ExaCtlOutputFormat,
): ExaCtlOutputFormat {
  if (options.json === true) {
    if (options.output !== undefined && options.output !== ExaCtlOutputFormat.JSON) {
      throw new ExaCtlError(ExaCtlExitCode.USAGE, `--json cannot be combined with -o ${options.output}`);
    }
    return ExaCtlOutputFormat.JSON;
  }
  return options.output ?? verbDefault;
}

/** Rejects `--json` with another `-o` format. Sets `json` for `-o json` and `-o jsonl`, so `options.json` readers follow `-o`. */
export function normalizeGlobalOptions(options: Partial<IExaCtlGlobalOptions>): void {
  const format = resolveOutputFormat(readGlobalOptions(options), ExaCtlOutputFormat.TABLE);
  if (format === ExaCtlOutputFormat.JSON || format === ExaCtlOutputFormat.JSONL) {
    Object.assign(options, { json: true });
  }
}

function isMachineFormat(format: ExaCtlOutputFormat): boolean {
  return format === ExaCtlOutputFormat.JSON || format === ExaCtlOutputFormat.JSONL;
}

function markdownCell(value: string): string {
  return value.replace(MD_CELL_BREAK, " ").replace(MD_PIPE, "\\|");
}

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(markdownCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  return [line(headers), separator, ...rows.map(line)].join(LINE_END);
}

function cleanCells(cells: readonly string[]): string[] {
  return cells.map(stripTerminalControls);
}

/** Prints collections, entities and events in the resolved format through a sink. */
export class ExaCtlOutputRenderer implements IExaCtlOutputRenderer {
  constructor(
    private readonly sink: IExaCtlOutputSink,
    private readonly format: ExaCtlOutputFormat,
    private readonly quiet: boolean,
  ) {}

  async list<T extends JSONValue>(
    rows: readonly T[],
    columns: readonly IExaCtlColumn<T>[],
    id: (row: T) => string,
  ): Promise<void> {
    if (this.format === ExaCtlOutputFormat.JSON) {
      await this.sink.out(JSON.stringify(rows, null, JSON_INDENT) + LINE_END);
      return;
    }
    if (this.format === ExaCtlOutputFormat.JSONL) {
      await this.sink.out(rows.map((row) => JSON.stringify(row) + LINE_END).join(""));
      return;
    }
    if (this.quiet) {
      await this.sink.out(rows.map((row) => stripTerminalControls(id(row)) + LINE_END).join(""));
      return;
    }
    const headers = cleanCells(columns.map((column) => column.header));
    const body = rows.map((row) => cleanCells(columns.map((column) => column.value(row))));
    await this.sink.out(this.renderRows(headers, body));
  }

  async item<T extends JSONValue>(item: T, fields: readonly IExaCtlColumn<T>[]): Promise<void> {
    if (this.format === ExaCtlOutputFormat.JSON) {
      await this.sink.out(JSON.stringify(item, null, JSON_INDENT) + LINE_END);
      return;
    }
    if (this.format === ExaCtlOutputFormat.JSONL) {
      await this.sink.out(JSON.stringify(item) + LINE_END);
      return;
    }
    if (this.quiet) return;
    const pairs = fields.map((field) => cleanCells([field.header, field.value(item)]));
    if (this.format === ExaCtlOutputFormat.TEXT) {
      await this.sink.out(pairs.map(([header, value]) => `${header}: ${value}${LINE_END}`).join(""));
      return;
    }
    if (this.format === ExaCtlOutputFormat.MD) {
      await this.sink.out(
        pairs.map(([header, value]) => `- **${markdownCell(header)}**: ${markdownCell(value)}${LINE_END}`).join(""),
      );
      return;
    }
    await this.sink.out(this.renderRows([...ITEM_HEADERS], pairs));
  }

  async event(event: JSONValue): Promise<void> {
    await this.sink.out(JSON.stringify(event) + LINE_END);
  }

  /** Writes one pre-formatted line of human text. The caller has already sanitized any untrusted part of it. */
  async text(line: string): Promise<void> {
    await this.sink.out(line + LINE_END);
  }

  /** True when stdout carries JSON, so human messages must stay off it. */
  get machine(): boolean {
    return isMachineFormat(this.format);
  }

  /** The result of a state change. A machine format prints it, a human format prints nothing beyond the verb's own message. */
  async mutation(results: readonly IMutationResult[], bulk: boolean): Promise<void> {
    if (!this.machine) return;
    if (bulk) await this.list(results, MUTATION_COLUMNS, (result) => result.id);
    else await this.item(results[0], MUTATION_COLUMNS);
  }

  private renderRows(headers: readonly string[], rows: readonly (readonly string[])[]): string {
    if (this.format === ExaCtlOutputFormat.MD) return markdownTable(headers, rows) + LINE_END;
    if (this.format === ExaCtlOutputFormat.TEXT) return rows.map((row) => row.join(TAB) + LINE_END).join("");
    return new Table().header([...headers]).body(rows.map((row) => [...row])).toString() + LINE_END;
  }
}

/** A renderer for one action: the resolved format and the quiet flag of its merged options. */
export function createExaCtlRenderer(
  options: IExaCtlGlobalOptions,
  verbDefault: ExaCtlOutputFormat,
  sink: IExaCtlOutputSink = defaultOutputSink,
): ExaCtlOutputRenderer {
  const format = resolveOutputFormat(options, verbDefault);
  return new ExaCtlOutputRenderer(sink, format, options.quiet === true && !isMachineFormat(format));
}

/** The renderer and the display of one action, built from its merged options. */
export function actionOutput<TOptions extends object | void>(
  runtime: { readonly display: IDisplayService; readonly outputSink: IExaCtlOutputSink },
  options: TOptions,
  verbDefault: ExaCtlOutputFormat,
): { renderer: ExaCtlOutputRenderer; display: IDisplayService } {
  const renderer = createExaCtlRenderer(readGlobalOptions(options), verbDefault, runtime.outputSink);
  return { renderer, display: runtime.display };
}
