/**
 * @module ScriptPortParityHelper
 * @path packages/lint-policy/tests/helpers/script_port_parity.ts
 * @description Compares the findings of a script rule with those of its plugin port on the same files.
 * @architectural-layer Test
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/checkers/check_code_style.ts, packages/lint-policy/plugin.ts]
 */

import { createLintPlugin, type ICatalog, runPlugin } from "@dostark/unslop-ts";
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
  const plugin = createLintPlugin(EXAIX_PLUGIN_NAME, catalog, { rulePacks: EXAIX_RULE_PACKS, selection: id });
  return runPlugin(plugin, unit.file, unit.text)
    .filter((diagnostic) => diagnostic.id === id)
    .map((diagnostic) => ({
      file: unit.file,
      line: unit.text.slice(0, diagnostic.range[0]).split(LINE_SPLIT).length,
    }));
}
