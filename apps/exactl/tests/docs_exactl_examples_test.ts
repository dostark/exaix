/**
 * @module DocsExaCtlExamplesTest
 * @path apps/exactl/tests/docs_exactl_examples_test.ts
 * @description Checks every exactl invocation in the fenced blocks of docs/*.md, docs/user_guide/*.md and the .copilot skill files against the live command tree.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/src/docs/example_validator.ts]
 * @related-files [apps/exactl/src/docs/example_validator.ts, apps/exactl/src/docs/command_tree_walk.ts]
 */

import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { createExaCtlCommand } from "../src/exactl.ts";
import { globalOptionsOf, walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { validateExample } from "../src/docs/example_validator.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");
const COMMAND_PREFIX = "exactl ";
/** The first character after which a shell line leaves the command: a comment, a pipe, a redirect or a list. */
const SHELL_BREAKS = new Set(["|", ">", "<", ";", "&"]);
const SKIPPED_DOCS: ReadonlySet<string> = new Set(["docs/CHANGELOG.md"]);

/** Invocations that are invalid on purpose: the bare root, a tree diagram and the Team-only export. The key is the file. */
const INTENTIONAL: Readonly<Record<string, readonly string[]>> = {
  "docs/user_guide/cli-basics.md": ["exactl"],
  "docs/user_guide/monitoring.md": [
    "exactl log export-otel a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "exactl log export-otel a1b2c3d4-e5f6-7890-abcd-ef1234567890 --eval-run-id run-042",
    "exactl log export-otel a1b2c3d4-e5f6-7890-abcd-ef1234567890 --stdout",
  ],
  "docs/Reference_Data.md": ["exactl memory"],
};

interface IInvocation {
  file: string;
  line: number;
  command: string;
}

const PLACEHOLDER = /^<[^\s<>]+>/;
const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);

/** The index after the `)` that closes the substitution that starts at `start`. */
function substitutionEnd(line: string, start: number): number {
  let depth = 0;
  for (let index = start; index < line.length; index++) {
    if (line[index] === "(") depth += 1;
    if (line[index] === ")" && --depth === 0) return index + 1;
  }
  return line.length;
}

/** The command of a shell line up to its first unquoted comment, pipe or redirect. A `<name>` or `$(…)` stays one word. */
function commandOf(line: string): string {
  let quote: string | null = null;
  let command = "";
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "$" && line[index + 1] === "(") {
      const end = substitutionEnd(line, index + 1);
      command += "value";
      index = end - 1;
      continue;
    } else if (character === "<" && PLACEHOLDER.test(line.slice(index))) {
      const end = line.indexOf(">", index);
      command += line.slice(index, end + 1);
      index = end;
      continue;
    } else if (SHELL_BREAKS.has(character) || (character === "#" && line[index - 1] === " ")) {
      break;
    }
    command += character;
  }
  return command.trim().split(/\s+/).filter((word) => !HELP_FLAGS.has(word)).join(" ");
}

/** The backtick run length of a fence line, or 0 for a plain line. */
function fenceLength(line: string): number {
  const match = /^(`{3,})/.exec(line);
  return match === null ? 0 : match[1].length;
}

function invocationsOf(file: string, text: string): IInvocation[] {
  const found: IInvocation[] = [];
  let open = 0;
  let pending: { line: number; text: string } | null = null;
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const length = fenceLength(line);
    if (length > 0 && open === 0) {
      open = length;
      return;
    }
    if (length >= open && open > 0 && line === "`".repeat(length)) {
      open = 0;
      return;
    }
    if (open === 0) return;
    if (pending !== null) {
      pending.text += ` ${line.replace(/\\$/, "").trim()}`;
      if (!line.endsWith("\\")) {
        found.push({ file, line: pending.line, command: commandOf(pending.text) });
        pending = null;
      }
      return;
    }
    if (!line.startsWith(COMMAND_PREFIX)) return;
    if (line.endsWith("\\")) {
      pending = { line: index + 1, text: line.replace(/\\$/, "").trim() };
      return;
    }
    found.push({ file, line: index + 1, command: commandOf(line) });
  });
  return found.filter((invocation) => !invocation.command.includes("["));
}

async function markdownFiles(dir: string, deep: boolean): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory && deep) files.push(...await markdownFiles(path, deep));
    else if (entry.isFile && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

Deno.test("every exactl invocation in docs/*.md, docs/user_guide/*.md and .copilot skill files passes validateExample", async () => {
  const root = createExaCtlCommand();
  const nodes = walkCommandTree(root);
  const globalFlags = globalOptionsOf(root);
  const files = [
    ...await markdownFiles(join(REPO_ROOT, "docs"), false),
    ...await markdownFiles(join(REPO_ROOT, "docs", "user_guide"), false),
    ...await markdownFiles(join(REPO_ROOT, ".copilot", "skills"), true),
  ].filter((path) => !SKIPPED_DOCS.has(relative(REPO_ROOT, path)));
  const failures: string[] = [];
  for (const path of files) {
    const file = relative(REPO_ROOT, path);
    for (const invocation of invocationsOf(file, await Deno.readTextFile(path))) {
      if ((INTENTIONAL[file] ?? []).includes(invocation.command)) continue;
      const issues = validateExample(nodes, globalFlags, { title: file, command: invocation.command });
      if (issues.length > 0) {
        const kinds = issues.map((issue) => `${issue.kind}:${issue.token}`);
        failures.push(`${file}:${invocation.line}: ${invocation.command} -> ${kinds.join(", ")}`);
      }
    }
  }
  assertEquals(failures, []);
});
