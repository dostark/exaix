/**
 * @module ExaCtlCommandDoc
 * @path packages/cli/src/docs/exactl_command_doc.ts
 * @description The doc record that is the single source of an exactl command's text, and the functions that render it into cliffy help.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, @exaix/cli]
 * @related-files [packages/cli/src/errors/exactl_errors.ts, packages/cli/src/types/exactl_output_types.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode } from "../errors/exactl_errors.ts";
import type { ExaCtlOutputKind } from "../types/exactl_output_types.ts";

export interface IExaCtlExample {
  /** What the example does, such as "Approve every plan in review". */
  readonly title: string;
  /** A full invocation that starts with `exactl` and parses against the live tree. */
  readonly command: string;
}

/** The single source of a command's text. It renders into `--help` and into the generated docs. */
export interface IExaCtlCommandDoc {
  /** Command words after `exactl`, such as `["plan", "approve"]`. */
  readonly path: readonly string[];
  /** Imperative, at most 72 characters, no trailing period. */
  readonly summary: string;
  /** Markdown subset: paragraphs, inline code, bullet lists and fenced code. No headings or tables. */
  readonly description: string;
  /** At least one. */
  readonly examples: readonly IExaCtlExample[];
  /** Command paths such as `exactl plan show`. Each resolves in the live tree. */
  readonly seeAlso: readonly string[];
  readonly exitCodes: readonly ExaCtlExitCode[];
  /** What the leaf prints. */
  readonly output: ExaCtlOutputKind;
}

const DOCS_ROOT = "docs/cli";
const DOCS_LABEL = "In the Exaix repository:";
const ANCHOR_SEPARATOR = "-";
const ANCHOR_PREFIX = `exactl${ANCHOR_SEPARATOR}`;
const FENCE = "```";
const HEADING_LINE = /^#{1,6}\s/;
const TABLE_LINE = /^\s*\|.*\|\s*$/;
const UNSUPPORTED_MARKDOWN = "DOC_DESCRIPTION_UNSUPPORTED_MARKDOWN";
const DOC_LINE_END = "\n";
const LIST_INDENT = "  ";

/** The repository path of the page and anchor that document `path`. */
export function exactlDocsLink(path: readonly string[]): string {
  const [noun, ...verbs] = path;
  return verbs.length === 0
    ? `${DOCS_ROOT}/${noun}.md`
    : `${DOCS_ROOT}/${noun}.md#${ANCHOR_PREFIX}${path.join(ANCHOR_SEPARATOR)}`;
}

function assertSupportedMarkdown(description: string): void {
  let inFence = false;
  for (const line of description.split(DOC_LINE_END)) {
    if (line.trimStart().startsWith(FENCE)) inFence = !inFence;
    if (inFence) continue;
    if (HEADING_LINE.test(line) || TABLE_LINE.test(line)) throw new Error(`${UNSUPPORTED_MARKDOWN}: ${line}`);
  }
}

/** The help text of one command: summary, description, lifecycle, see-also, exit codes and the docs link. */
export function renderDocForTerminal(doc: IExaCtlCommandDoc, lifecycle: readonly string[]): string {
  const sections = [doc.summary, doc.description];
  if (lifecycle.length > 0) sections.push(`Lifecycle: ${lifecycle.join(" → ")}`);
  if (doc.seeAlso.length > 0) {
    sections.push(["See also", ...doc.seeAlso.map((entry) => LIST_INDENT + entry)].join(DOC_LINE_END));
  }
  if (doc.exitCodes.length > 0) {
    const codes = doc.exitCodes.map((code) => `${LIST_INDENT}${ExaCtlExitCode[code]} (${code})`);
    sections.push(["Exit codes", ...codes].join(DOC_LINE_END));
  }
  sections.push(`${DOCS_LABEL} ${exactlDocsLink(doc.path)}`);
  return sections.join(DOC_LINE_END + DOC_LINE_END);
}

/** The two cliffy methods that a doc record fills. A command with any option set satisfies it. */
interface IDocumentable {
  description(text: string): void;
  example(name: string, description: string): void;
}

/** Applies a doc record to a command: the summary is the first description line and every example is added. */
export function documented<T extends IDocumentable>(
  command: T,
  doc: IExaCtlCommandDoc,
  lifecycle: readonly string[] = [],
): T {
  assertSupportedMarkdown(doc.description);
  command.description(renderDocForTerminal(doc, lifecycle));
  for (const example of doc.examples) command.example(example.title, example.command);
  return command;
}
