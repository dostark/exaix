#!/usr/bin/env -S deno run -A
/**
 * @module GenerateCliReference
 * @path scripts/generate_cli_reference.ts
 * @description Writes the generated exactl CLI reference from the command tree and the doc records: docs/cli pages, the JSON manifest and the command table of the CLI Basics page of the user guide.
 *
 * Usage:
 *   deno task docs:cli
 *   deno task docs:cli:team
 *   deno run -A scripts/generate_cli_reference.ts --edition solo|team
 */

import { join } from "@std/path";
import { z } from "zod";
import type { IExaCtlCommandDoc } from "@exaix/cli";
import { EXACTL_COMMAND_DOCS, EXACTL_NOUN_DOCS } from "../apps/exactl/src/command_docs/mod.ts";
import { CliEdition, renderCliReference } from "../apps/exactl/src/docs/cli_reference.ts";

const REPO_ROOT = join(import.meta.dirname ?? ".", "..");
const SOLO_OUTPUT_DIR = join(REPO_ROOT, "docs", "cli");
const TEAM_OUTPUT_DIR = join(REPO_ROOT, "exaix-team", "docs", "cli");
const USER_GUIDE = join(REPO_ROOT, "docs", "user_guide", "cli-basics.md");
const SOLO_MANIFEST = join(SOLO_OUTPUT_DIR, "exactl-cli.json");
const BLOCK_START = "<!-- exactl-reference:start -->";
const BLOCK_END = "<!-- exactl-reference:end -->";
const TARGET_FLAG = "--edition";
const MANIFEST_SCHEMA = z.object({ commands: z.array(z.object({ path: z.array(z.string()) })) });

/** The target named by `--edition`, Solo by default. */
function targetOf(args: readonly string[]): CliEdition {
  const index = args.indexOf(TARGET_FLAG);
  const value = index === -1 ? CliEdition.SOLO : args[index + 1];
  if (value !== CliEdition.SOLO && value !== CliEdition.TEAM) {
    throw new Error(`${TARGET_FLAG} must be ${CliEdition.SOLO} or ${CliEdition.TEAM}`);
  }
  return value;
}

/** The leaves of the committed Solo manifest as `plan show` strings. */
async function soloPaths(): Promise<Set<string>> {
  const manifest = MANIFEST_SCHEMA.parse(JSON.parse(await Deno.readTextFile(SOLO_MANIFEST)));
  return new Set(manifest.commands.map((command) => command.path.join(" ")));
}

/** Replaces the text between the reference markers of the User Guide with `table`. */
async function updateUserGuide(table: string): Promise<void> {
  const text = await Deno.readTextFile(USER_GUIDE);
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`The CLI Basics page of the user guide has no ${BLOCK_START} block.`);
  }
  const next = `${text.slice(0, start + BLOCK_START.length)}\n\n${table}\n\n${text.slice(end)}`;
  if (next !== text) await Deno.writeTextFile(USER_GUIDE, next);
}

async function formatFiles(paths: readonly string[]): Promise<void> {
  const { code } = await new Deno.Command(Deno.execPath(), { args: ["fmt", ...paths], stderr: "inherit" }).output();
  if (code !== 0) throw new Error("deno fmt failed");
}

const target = targetOf(Deno.args);
const soloRun = target === CliEdition.SOLO;
// The test-mode switch must be set before the command module loads, so no service starts.
Deno.env.set("EXA_TEST_MODE", "1");
Deno.env.set("EXA_TEST_CLI_MODE", "1");
// deno-lint-ignore exaix/dynamic-import -- The test-mode switch above must come first.
const soloModule = await import("../apps/exactl/src/exactl.ts");
// deno-lint-ignore exaix/dynamic-import -- A Solo run must never load the Team module.
const teamModule = soloRun ? undefined : await import("../exaix-team/apps/exactl/team_command.ts");
// deno-lint-ignore exaix/dynamic-import -- A Solo run must never load the Team module.
const teamDocsModule = soloRun ? undefined : await import("../exaix-team/packages/otel-export/src/command_docs.ts");

const teamDocs: readonly IExaCtlCommandDoc[] = teamDocsModule === undefined ? [] : [teamDocsModule.OTEL_EXPORT_DOC];
const reference = renderCliReference({
  root: teamModule === undefined ? soloModule.createExaCtlCommand() : await teamModule.createTeamExaCtlCommand(),
  nounDocs: EXACTL_NOUN_DOCS,
  commandDocs: [...EXACTL_COMMAND_DOCS, ...teamDocs],
  edition: target,
  soloPaths: soloRun ? undefined : await soloPaths(),
});
const outputDir = soloRun ? SOLO_OUTPUT_DIR : TEAM_OUTPUT_DIR;
await Deno.mkdir(outputDir, { recursive: true });
const written: string[] = [];
for (const [name, content] of reference.files) {
  const path = join(outputDir, name);
  await Deno.writeTextFile(path, content);
  written.push(path);
}
if (soloRun) {
  await updateUserGuide(reference.userGuideTable);
  written.push(USER_GUIDE);
}
await formatFiles(written);
console.log(`Wrote ${reference.files.size} files to ${outputDir}`);
