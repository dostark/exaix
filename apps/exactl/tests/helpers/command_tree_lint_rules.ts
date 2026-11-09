/**
 * @module CommandTreeLintRules
 * @path apps/exactl/tests/helpers/command_tree_lint_rules.ts
 * @description Grammar rules that walk the exactl command tree and report violations by rule and path.
 * @architectural-layer Test
 * @dependencies [apps/exactl/src/docs/command_tree_walk.ts, apps/exactl/src/exactl_constants.ts]
 * @related-files [apps/exactl/tests/command_tree_lint_test.ts, apps/exactl/src/exactl_renames.ts]
 */

import type { ICommandTreeNode, IWalkableCommand } from "../../src/docs/command_tree_walk.ts";
import { ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import type { IExaCtlNounDoc } from "../../src/docs/exactl_noun_doc.ts";
import { type IExampleFlag, validateExample } from "../../src/docs/example_validator.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../../src/exactl_constants.ts";
import type { IExaCtlRename } from "../../src/exactl_renames.ts";

export type GrammarRule =
  | "root-name"
  | "sub-noun"
  | "leaf-verb"
  | "compound-leaf"
  | "duplicate-handler"
  | "doc-record"
  | "doc-example"
  | "doc-see-also"
  | "doc-noun"
  | "doc-output-kind"
  | "short-flag";

export interface IGrammarViolation {
  readonly rule: GrammarRule;
  readonly path: string;
}

/** What the doc rules read from the live tree. */
export interface IDocLintInput {
  readonly nodes: readonly ICommandTreeNode[];
  readonly docs: readonly IExaCtlCommandDoc[];
  readonly nounDocs: readonly IExaCtlNounDoc[];
  readonly globalFlags: readonly IExampleFlag[];
}

export type IGrammarAllowlist = Record<GrammarRule, string[]>;

const GRAMMAR_RULES: readonly GrammarRule[] = [
  "root-name",
  "sub-noun",
  "leaf-verb",
  "compound-leaf",
  "duplicate-handler",
  "doc-record",
  "doc-example",
  "doc-see-also",
  "doc-noun",
  "doc-output-kind",
  "short-flag",
];

/** A root that is itself the action takes no verb. */
const ROOT_ACTION_COMMANDS: ReadonlySet<string> = new Set([ExaCtlCommandName.DASHBOARD, ExaCtlCommandName.VERSION]);

const ROOT_NAMES: ReadonlySet<string> = new Set(Object.values(ExaCtlCommandName));
const SUB_NOUN_NAMES: ReadonlySet<string> = new Set(Object.values(ExaCtlSubNoun));
const VERB_NAMES: ReadonlySet<string> = new Set(Object.values(ExaCtlVerb));

function pathKey(node: ICommandTreeNode): string {
  return node.path.join(" ");
}

function isLeaf(node: ICommandTreeNode, nodes: readonly ICommandTreeNode[]): boolean {
  return !nodes.some((other) =>
    other.path.length === node.path.length + 1 && node.path.every((word, index) => other.path[index] === word)
  );
}

function handlerSignature(node: ICommandTreeNode): string {
  const args = node.args.map((arg) => `${arg.name}:${arg.optional}:${arg.variadic}`).join(",");
  const flags = node.options.map((option) => option.flags.join("|")).sort().join(",");
  return `${node.description}#${args}#${flags}`;
}

function findDuplicateHandlers(leaves: readonly ICommandTreeNode[]): IGrammarViolation[] {
  const byInstance = new Map<IWalkableCommand, ICommandTreeNode[]>();
  const bySignature = new Map<string, ICommandTreeNode[]>();
  for (const leaf of leaves) {
    byInstance.set(leaf.command, [...(byInstance.get(leaf.command) ?? []), leaf]);
    const signature = handlerSignature(leaf);
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), leaf]);
  }
  const duplicated = new Set<ICommandTreeNode>();
  for (const group of [...byInstance.values(), ...bySignature.values()]) {
    if (group.length > 1) group.forEach((node) => duplicated.add(node));
  }
  return [...duplicated].map((node) => ({ rule: "duplicate-handler", path: pathKey(node) }));
}

/** Every grammar violation of the tree, sorted by rule and path. */
export function findGrammarViolations(nodes: readonly ICommandTreeNode[]): IGrammarViolation[] {
  const violations: IGrammarViolation[] = [];
  const leaves: ICommandTreeNode[] = [];
  for (const node of nodes) {
    const name = node.path[node.path.length - 1];
    const leaf = isLeaf(node, nodes);
    if (node.path.length === 1 && !ROOT_NAMES.has(name)) violations.push({ rule: "root-name", path: pathKey(node) });
    if (node.path.length > 1 && !leaf && !SUB_NOUN_NAMES.has(name)) {
      violations.push({ rule: "sub-noun", path: pathKey(node) });
    }
    if (!leaf) continue;
    leaves.push(node);
    const rootAction = node.path.length === 1 && ROOT_ACTION_COMMANDS.has(name);
    if (!rootAction && !VERB_NAMES.has(name)) violations.push({ rule: "leaf-verb", path: pathKey(node) });
    if (name.includes("-") && !VERB_NAMES.has(name)) violations.push({ rule: "compound-leaf", path: pathKey(node) });
  }
  violations.push(...findDuplicateHandlers(leaves));
  return violations.sort((a, b) => a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path));
}

export function isAllowlisted(violation: IGrammarViolation, allowlist: IGrammarAllowlist): boolean {
  return allowlist[violation.rule].includes(violation.path);
}

/** Allow-list entries that no tree violation uses any more. */
export function findStaleAllowlistEntries(
  violations: readonly IGrammarViolation[],
  allowlist: IGrammarAllowlist,
): IGrammarViolation[] {
  const stale: IGrammarViolation[] = [];
  for (const rule of GRAMMAR_RULES) {
    for (const path of allowlist[rule]) {
      if (!violations.some((violation) => violation.rule === rule && violation.path === path)) {
        stale.push({ rule, path });
      }
    }
  }
  return stale;
}

/** Tree paths that equal or extend a removed path. Guarded rows name a noun that still exists, so they are skipped. */
export function findLegacyPaths(nodes: readonly ICommandTreeNode[], renames: readonly IExaCtlRename[]): string[] {
  const removed = renames.filter((rename) => rename.unlessNextIn === undefined);
  return nodes
    .filter((node) => removed.some((rename) => rename.legacy.every((word, index) => node.path[index] === word)))
    .map(pathKey);
}

/** The leaves that own the terminal or a protocol on stdout. Every other leaf prints data. */
const PROTOCOL_LEAVES: ReadonlySet<string> = new Set(["dashboard", "mcp serve", "daemon logs"]);
const SUMMARY_MAX_CHARS = 72;
const EXACTL_PREFIX = "exactl ";
const NON_IMPERATIVE_ENDINGS = ["ing", "ed"];
const SIBILANT_ENDING = "ss";

function isImperative(summary: string): boolean {
  const first = summary.split(" ")[0].toLowerCase();
  if (NON_IMPERATIVE_ENDINGS.some((ending) => first.endsWith(ending))) return false;
  return !first.endsWith("s") || first.endsWith(SIBILANT_ENDING);
}

function summaryIsValid(summary: string): boolean {
  return summary !== "" && summary.length <= SUMMARY_MAX_CHARS && !summary.endsWith(".") && isImperative(summary);
}

function docKey(doc: IExaCtlCommandDoc): string {
  return doc.path.join(" ");
}

/** Every doc-rule violation of the tree and the records, sorted by rule and path. */
export function findDocViolations(input: IDocLintInput): IGrammarViolation[] {
  const { nodes, docs, nounDocs, globalFlags } = input;
  const violations: IGrammarViolation[] = [];
  const leaves = nodes.filter((node) => isLeaf(node, nodes));
  const leafKeys = new Set(leaves.map(pathKey));
  for (const leaf of leaves) {
    if (docs.filter((doc) => docKey(doc) === pathKey(leaf)).length !== 1) {
      violations.push({ rule: "doc-record", path: pathKey(leaf) });
    }
  }
  for (const doc of docs) {
    const key = docKey(doc);
    if (!leafKeys.has(key)) violations.push({ rule: "doc-record", path: key });
    const exampleIssues = doc.examples.flatMap((example) => validateExample(nodes, globalFlags, example));
    if (!summaryIsValid(doc.summary) || doc.examples.length === 0 || exampleIssues.length > 0) {
      violations.push({ rule: "doc-example", path: key });
    }
    if (doc.seeAlso.some((entry) => !leafKeys.has(entry.replace(EXACTL_PREFIX, "")))) {
      violations.push({ rule: "doc-see-also", path: key });
    }
    if (PROTOCOL_LEAVES.has(key) !== (doc.output === ExaCtlOutputKind.PROTOCOL)) {
      violations.push({ rule: "doc-output-kind", path: key });
    }
  }
  for (const root of nodes.filter((node) => node.path.length === 1 && !isLeaf(node, nodes))) {
    if (!nounDocs.some((noun) => noun.noun === root.path[0])) {
      violations.push({ rule: "doc-noun", path: pathKey(root) });
    }
  }
  return violations.sort((a, b) => a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path));
}
