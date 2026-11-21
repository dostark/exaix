#!/usr/bin/env -S deno run -A
/**
 * @module GoPortExaport
 * @path scripts/go_port/exaport/src/main.ts
 * @description Runs the readiness checks and dry-run conversion plan for the Go port.
 * Usage: deno run -A scripts/go_port/exaport/src/main.ts --root=<dir> [--format=json]
 * @architectural-layer Tooling
 * @dependencies [typescript]
 */
import { loadSources } from "./loader.ts";
import { denoApiFindings, type IFinding } from "./rules/deno_api.ts";
import { barrelImportFindings } from "./rules/barrel_import.ts";
import { conversionPlan } from "./convert.ts";

const RULES = ["deno-api", "barrel-import"] as const;
type TRule = typeof RULES[number] | "all";

function value(args: readonly string[], name: string): string | undefined {
  const arg = args.find((candidate) => candidate.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function usage(message: string): never {
  console.error(message);
  Deno.exit(2);
}

async function main(): Promise<number> {
  const args = Deno.args;
  const root = value(args, "root");
  if (root === undefined) usage("exaport check needs --root=<path>");
  const rule = (value(args, "rule") ?? "all") as TRule;
  if (rule !== "all" && !RULES.includes(rule)) usage(`unknown rule '${rule}'`);
  if (value(args, "format") !== "json") {
    usage("exaport check needs --format=json");
  }
  let files;
  try {
    files = await loadSources(root);
  } catch (error) {
    usage(
      `cannot read root '${root}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const findings: IFinding[] = [];
  for (const file of files) {
    if (rule === "all" || rule === "deno-api") {
      findings.push(...denoApiFindings(file));
    }
    if (rule === "all" || rule === "barrel-import") {
      findings.push(...barrelImportFindings(file));
    }
  }
  if (args.includes("--convert")) {
    if (!args.includes("--dry-run")) usage("convert needs --dry-run");
    const packagePath = value(args, "package");
    if (packagePath === undefined) usage("convert needs --package=<path>");
    const plan = conversionPlan(packagePath, files.length, findings);
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  console.log(
    JSON.stringify(
      { version: 1, root, findings, summary: `${findings.length} finding(s)` },
      null,
      2,
    ),
  );
  return 0;
}

if (import.meta.main) Deno.exit(await main());
