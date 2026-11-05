#!/usr/bin/env -S deno run -A
/**
 * @module GodObjectsCompare
 * @path scripts/god_objects_compare.ts
 * @description Advisory comparison of the two class-size strategies. It runs the class-size report once per strategy and lists the classes that both strategies flag and the classes that only one flags. The policy file is rewritten for each run and restored afterwards.
 *
 * Usage:
 *   deno run -A scripts/god_objects_compare.ts [--rule=exaix/max-class-size] [--roots=packages,apps] [--config=unslop.config.json]
 *     [--descriptor=packages/lint-policy/unslop.project.ts] [--ceilings=packages/lint-policy/rule_ceilings.json]
 * @architectural-layer Tooling
 * @related-files [unslop-ts/src/cli/rule_report.ts, unslop.config.json, packages/lint-policy/rule_ceilings.json]
 */

import { join } from "@std/path";
import { loadConfigDescriptor, resolveLocalEntry } from "../unslop-ts/src/cli/project_loader.ts";

/** The strategies the class-size rule offers, in the order that the report shows them. */
const STRATEGIES = ["god-class", "legacy-score"] as const;

type Strategy = (typeof STRATEGIES)[number];

/** One diagnostic of the ceiling report. */
interface IReportedFinding {
  readonly file: string;
  readonly message: string;
}

/** The part of a policy file that the comparison edits. */
interface IPolicyFile {
  rules: Record<string, { options?: { strategy?: string } }>;
}

const DEFAULT_RULE = "exaix/max-class-size";
const DEFAULT_ROOTS = "packages,apps,tests,scripts,exaix-team,exaix-enterprise";
const DEFAULT_CONFIG = "unslop.config.json";
const DEFAULT_DESCRIPTOR = "packages/lint-policy/unslop.project.ts";
const DEFAULT_CEILINGS = "packages/lint-policy/rule_ceilings.json";
const REPORTER = join(import.meta.dirname!, "..", "unslop-ts", "src", "cli", "rule_report.ts");
const CLASS_NAME = /^Class (\S+)/;

function flag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return Deno.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

/** The text of the policy file with the strategy of the rule set. */
function withStrategy(original: string, rule: string, strategy: Strategy): string {
  const policy: IPolicyFile = JSON.parse(original);
  const entry = policy.rules[rule];
  if (entry === undefined) throw new Error(`The policy file has no rule ${rule}.`);
  entry.options = { ...entry.options, strategy };
  return `${JSON.stringify(policy, null, 2)}\n`;
}

/** The classes that one run flags, each as `file:Class`. */
async function flaggedBy(rule: string, roots: string): Promise<Set<string>> {
  const args = [
    "run",
    "-A",
    REPORTER,
    `--rule=${rule}`,
    `--roots=${roots}`,
    `--descriptor=${flag("descriptor", DEFAULT_DESCRIPTOR)}`,
    `--ceilings=${flag("ceilings", DEFAULT_CEILINGS)}`,
    "--json",
  ];
  const output = await new Deno.Command(Deno.execPath(), { args, stdout: "piped", stderr: "piped" }).output();
  const decoder = new TextDecoder();
  if (output.code !== 0) throw new Error(`The report failed: ${decoder.decode(output.stderr).slice(-2000)}`);
  const report: { findings: readonly IReportedFinding[] } = JSON.parse(decoder.decode(output.stdout));
  const flagged = new Set<string>();
  for (const finding of report.findings) {
    const name = CLASS_NAME.exec(finding.message)?.[1];
    if (name !== undefined) flagged.add(`${finding.file}:${name}`);
  }
  return flagged;
}

/** One section of the printed comparison. */
function section(title: string, members: readonly string[]): string[] {
  return [`${title} (${members.length})`, ...[...members].sort().map((member) => `  ${member}`), ""];
}

async function main(): Promise<void> {
  const rule = flag("rule", DEFAULT_RULE);
  const roots = flag("roots", DEFAULT_ROOTS);
  const root = Deno.cwd();
  const descriptor = await loadConfigDescriptor(root, flag("descriptor", DEFAULT_DESCRIPTOR), null);
  const configPath = await resolveLocalEntry(flag("config", DEFAULT_CONFIG), root);
  const expectedConfig = await resolveLocalEntry(descriptor.configUrl.href, root);
  if (configPath.href !== expectedConfig.href) {
    throw new Error(
      "--config must match the selected descriptor's configUrl before comparison can rewrite the policy.",
    );
  }
  const original = await Deno.readTextFile(configPath);
  const flagged = new Map<Strategy, Set<string>>();
  try {
    for (const strategy of STRATEGIES) {
      await Deno.writeTextFile(configPath, withStrategy(original, rule, strategy));
      flagged.set(strategy, await flaggedBy(rule, roots));
    }
  } finally {
    await Deno.writeTextFile(configPath, original);
  }
  const godClass = flagged.get("god-class")!;
  const legacy = flagged.get("legacy-score")!;
  const both = [...godClass].filter((entry) => legacy.has(entry));
  console.log(`Strategy comparison for ${rule}`);
  console.log(`god-class flags ${godClass.size} class(es); legacy-score flags ${legacy.size} class(es).\n`);
  const lines = [
    ...section("Both strategies", both),
    ...section("Only god-class", [...godClass].filter((entry) => !legacy.has(entry))),
    ...section("Only legacy-score", [...legacy].filter((entry) => !godClass.has(entry))),
  ];
  console.log(lines.join("\n"));
}

if (import.meta.main) await main();
