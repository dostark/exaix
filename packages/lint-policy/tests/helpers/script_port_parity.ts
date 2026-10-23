/**
 * @module ScriptPortParityHelper
 * @path packages/lint-policy/tests/helpers/script_port_parity.ts
 * @description Compares the findings of a script rule with those of its plugin port on the same files.
 * @architectural-layer Test
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/checkers/check_code_style.ts, packages/lint-policy/plugin.ts]
 */

import type { ICatalog } from "@dostark/unslop-ts";
import { createDenoPlugin, runPlugin } from "@dostark/unslop-ts/deno";
import { checkSource } from "../../src/checkers/check_code_style.ts";
import { EXAIX_PLUGIN_NAME } from "../../src/rule_pack/mod.ts";
import { EXAIX_RULE_PACKS } from "../../src/rule_packs.ts";

export interface IFindingKey {
  readonly file: string;
  readonly line: number;
}

export interface IParityReport {
  readonly missing: readonly IFindingKey[];
  readonly extra: readonly IFindingKey[];
}

export interface IFileCover {
  readonly script: (file: string) => boolean;
  readonly plugin: (file: string) => boolean;
}

export interface IFilePartition {
  readonly shared: readonly string[];
  readonly scriptOnly: readonly string[];
  readonly pluginOnly: readonly string[];
}

export interface ISourceUnit {
  readonly file: string;
  readonly text: string;
}

const LINE_SPLIT = /\r?\n/;

function keyOf(finding: IFindingKey): string {
  return `${finding.file}:${finding.line}`;
}

function byKey(left: IFindingKey, right: IFindingKey): number {
  return keyOf(left).localeCompare(keyOf(right));
}

/** The findings that the script side reports and the plugin side lacks (missing), and the reverse (extra). */
export function compareFindings(script: readonly IFindingKey[], plugin: readonly IFindingKey[]): IParityReport {
  const scriptKeys = new Set(script.map(keyOf));
  const pluginKeys = new Set(plugin.map(keyOf));
  return {
    missing: script.filter((finding) => !pluginKeys.has(keyOf(finding))).sort(byKey),
    extra: plugin.filter((finding) => !scriptKeys.has(keyOf(finding))).sort(byKey),
  };
}

/** Splits files into those both sides cover and those that only one side covers. */
export function partitionFiles(files: readonly string[], covers: IFileCover): IFilePartition {
  const shared: string[] = [];
  const scriptOnly: string[] = [];
  const pluginOnly: string[] = [];
  for (const file of files) {
    const bySript = covers.script(file);
    const byPlugin = covers.plugin(file);
    if (bySript && byPlugin) shared.push(file);
    else if (bySript) scriptOnly.push(file);
    else if (byPlugin) pluginOnly.push(file);
  }
  return { shared, scriptOnly, pluginOnly };
}

/** The findings of one script rule on one source unit, keyed by file and line. */
export function scriptRuleFindings(ruleId: string, catalog: ICatalog, unit: ISourceUnit): IFindingKey[] {
  return checkSource(unit.file, unit.text, catalog)
    .filter((finding) => finding.rule === ruleId)
    .map((finding) => ({ file: unit.file, line: finding.line }));
}

/** The findings of one plugin rule (by bare key) on one source unit, keyed by file and line. The rule is selected, so a parked rule runs. */
export function pluginRuleFindings(key: string, catalog: ICatalog, unit: ISourceUnit): IFindingKey[] {
  const id = `${EXAIX_PLUGIN_NAME}/${key}`;
  const plugin = createDenoPlugin(EXAIX_PLUGIN_NAME, catalog, { rulePacks: EXAIX_RULE_PACKS, selection: id });
  return runPlugin(plugin, unit.file, unit.text)
    .filter((diagnostic) => diagnostic.id === id)
    .map((diagnostic) => ({
      file: unit.file,
      line: unit.text.slice(0, diagnostic.range[0]).split(LINE_SPLIT).length,
    }));
}

/** One finding of a rule at a repository-relative file and line. */
export interface IRuleFinding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
}

/** A finding that differs between the two sides, with its accepted reason, or null when none applies. */
export interface IAcceptedDifference {
  readonly finding: IRuleFinding;
  readonly reason: string;
}

export interface IProductionParity {
  readonly compared: number;
  readonly accepted: readonly IAcceptedDifference[];
  readonly unexplainedMissing: readonly IRuleFinding[];
  readonly unexplainedExtra: readonly IRuleFinding[];
}

export interface IProductionParityInput {
  readonly baseline: readonly IRuleFinding[];
  readonly current: readonly IRuleFinding[];
  /** The reason a finding of the old side may be absent from the new side, or null when none applies. */
  readonly explainMissing: (finding: IRuleFinding) => string | null;
  /** The reason a finding of the new side may be absent from the old side, or null when none applies. */
  readonly explainExtra: (finding: IRuleFinding) => string | null;
}

const STYLE_LINE = /^(?:ERROR|WARN) \[([^\]]+)\] (.*?):(\d+) – /;

function findingKey(finding: IRuleFinding): string {
  return `${finding.rule}\u0000${finding.file}\u0000${finding.line}`;
}

/** The findings that the style checker printed, with paths made relative to `root`. */
export function parseStyleFindings(output: string, root: string): IRuleFinding[] {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const findings: IRuleFinding[] = [];
  for (const text of output.split(LINE_SPLIT)) {
    const match = STYLE_LINE.exec(text);
    if (match) findings.push({ rule: match[1], file: match[2].replace(prefix, ""), line: Number(match[3]) });
  }
  return findings;
}

/** Compares two finding lists of the same rules over the same files, and sorts each difference into accepted or unexplained. */
export function compareProductionFindings(input: IProductionParityInput): IProductionParity {
  const baselineKeys = new Set(input.baseline.map(findingKey));
  const currentKeys = new Set(input.current.map(findingKey));
  const accepted: IAcceptedDifference[] = [];
  const unexplainedMissing: IRuleFinding[] = [];
  const unexplainedExtra: IRuleFinding[] = [];
  for (const finding of input.baseline) {
    if (currentKeys.has(findingKey(finding))) continue;
    const reason = input.explainMissing(finding);
    if (reason === null) unexplainedMissing.push(finding);
    else accepted.push({ finding, reason });
  }
  for (const finding of input.current) {
    if (baselineKeys.has(findingKey(finding))) continue;
    const reason = input.explainExtra(finding);
    if (reason === null) unexplainedExtra.push(finding);
    else accepted.push({ finding, reason });
  }
  const compared = new Set([...baselineKeys, ...currentKeys]).size;
  return { compared, accepted, unexplainedMissing, unexplainedExtra };
}

/** The files that only one side covers and whose surface no scope decision declares as dropped. */
export function undeclaredDrops(
  partition: IFilePartition,
  categoryOf: (file: string) => string,
  declared: ReadonlySet<string>,
): string[] {
  return [...partition.scriptOnly, ...partition.pluginOnly].filter((file) => !declared.has(categoryOf(file)));
}
