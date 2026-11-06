/**
 * @module CommandTreeLintRules
 * @path apps/exactl/tests/helpers/command_tree_lint_rules.ts
 * @description Grammar rules that walk the exactl command tree and report violations by rule and path.
 * @architectural-layer Test
 * @dependencies [apps/exactl/src/docs/command_tree_walk.ts, apps/exactl/src/exactl_constants.ts]
 * @related-files [apps/exactl/tests/command_tree_lint_test.ts, apps/exactl/src/exactl_renames.ts]
 */

import type { ICommandTreeNode, IWalkableCommand } from "../../src/docs/command_tree_walk.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../../src/exactl_constants.ts";
import type { IExaCtlRename } from "../../src/exactl_renames.ts";

export type GrammarRule = "root-name" | "sub-noun" | "leaf-verb" | "compound-leaf" | "duplicate-handler";

export interface IGrammarViolation {
  readonly rule: GrammarRule;
  readonly path: string;
}

export type IGrammarAllowlist = Record<GrammarRule, string[]>;

const GRAMMAR_RULES: readonly GrammarRule[] = [
  "root-name",
  "sub-noun",
  "leaf-verb",
  "compound-leaf",
  "duplicate-handler",
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
