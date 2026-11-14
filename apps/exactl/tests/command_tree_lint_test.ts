/**
 * @module CommandTreeLintTest
 * @path apps/exactl/tests/command_tree_lint_test.ts
 * @description Walks the live exactl command tree and holds the command grammar with a shrinking allow-list.
 * @architectural-layer Test
 * @dependencies [@std/assert, @cliffy/command, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/tests/helpers/command_tree_lint_rules.ts, tests/fixtures/cli/command_tree_lint_test/command_tree_lint_allowlist.json]
 */

import { assert, assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { readFixtureTextSync } from "@exaix/testing";
import { createExaCtlCommand } from "../src/exactl.ts";
import { globalOptionsOf, walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { EXACTL_COMMAND_DOCS, EXACTL_NOUN_DOCS } from "../src/command_docs/mod.ts";
import { ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { EXACTL_RENAMES } from "../src/exactl_renames.ts";
import {
  findDocViolations,
  findGrammarViolations,
  findLegacyPaths,
  findShortFlagViolations,
  findStaleAllowlistEntries,
  type IGrammarAllowlist,
  isAllowlisted,
} from "./helpers/command_tree_lint_rules.ts";

const allowlist = JSON.parse(
  readFixtureTextSync(import.meta.url, "cli", "command_tree_lint_test", "command_tree_lint_allowlist.json"),
) as IGrammarAllowlist;

const liveRoot = createExaCtlCommand();
const liveNodes = walkCommandTree(liveRoot);
const liveGlobalFlags = globalOptionsOf(liveRoot);

function liveDocViolations(docs: readonly IExaCtlCommandDoc[] = EXACTL_COMMAND_DOCS) {
  return findDocViolations({ nodes: liveNodes, docs, nounDocs: EXACTL_NOUN_DOCS, globalFlags: liveGlobalFlags });
}

function seededTree(leafName: string) {
  return new Command().name("exactl").command("plan", new Command().command(leafName, new Command().action(() => {})));
}

Deno.test("every leaf verb is an ExaCtlVerb member or allow-listed", () => {
  const unlisted = findGrammarViolations(liveNodes)
    .filter((violation) => violation.rule === "leaf-verb" && !isAllowlisted(violation, allowlist));
  assertEquals(unlisted, []);
});

Deno.test("every root, sub-noun, compound-leaf and duplicate-handler violation is allow-listed", () => {
  const unlisted = findGrammarViolations(liveNodes)
    .filter((violation) => violation.rule !== "leaf-verb" && !isAllowlisted(violation, allowlist));
  assertEquals(unlisted, []);
});

Deno.test("a seeded compound leaf fails the lint", () => {
  const violations = findGrammarViolations(walkCommandTree(seededTree("foo-all")));
  assert(violations.some((violation) => violation.rule === "compound-leaf" && violation.path === "plan foo-all"));
  assert(violations.some((violation) => violation.rule === "leaf-verb" && violation.path === "plan foo-all"));
});

Deno.test("a seeded valid verb leaf passes the lint", () => {
  assertEquals(findGrammarViolations(walkCommandTree(seededTree("approve"))), []);
});

Deno.test("allow-list entries that no longer occur fail the lint", () => {
  const violations = [
    ...findGrammarViolations(liveNodes),
    ...liveDocViolations(),
    ...findShortFlagViolations(liveNodes),
  ];
  assertEquals(findStaleAllowlistEntries(violations, allowlist), []);
  const withStale: IGrammarAllowlist = { ...allowlist, "leaf-verb": [...allowlist["leaf-verb"], "plan gone-leaf"] };
  assertEquals(findStaleAllowlistEntries(violations, withStale), [
    { rule: "leaf-verb", path: "plan gone-leaf" },
  ]);
});

Deno.test("no legacy path of EXACTL_RENAMES exists in the live tree", () => {
  assertEquals(findLegacyPaths(liveNodes, EXACTL_RENAMES), []);
});

Deno.test("a seeded legacy path is reported", () => {
  const seeded = new Command().name("exactl").command(
    "blueprint",
    new Command().command("ls", new Command().action(() => {})),
  );
  assertEquals(findLegacyPaths(walkCommandTree(seeded), EXACTL_RENAMES), ["blueprint ls"]);
});

Deno.test("no allow-listed compound-leaf entry remains for a plan or memory leaf", () => {
  const remaining = allowlist["compound-leaf"].filter((path) => path.startsWith("plan ") || path.startsWith("memory "));
  assertEquals(remaining, []);
});

Deno.test("the compound-leaf allow-list is empty", () => {
  assertEquals(allowlist["compound-leaf"], []);
});

Deno.test("the grammar allow-list is empty", () => {
  const grammar = [
    allowlist["root-name"],
    allowlist["sub-noun"],
    allowlist["leaf-verb"],
    allowlist["compound-leaf"],
    allowlist["duplicate-handler"],
  ];
  assertEquals(grammar.flat(), []);
});

const GLOBAL_OPTION_FLAGS = ["--json", "--output", "-o", "--quiet", "-q", "--yes", "-y", "--no-color", "--no-input"];

Deno.test("no node defines a global option locally", () => {
  const offenders = liveNodes.flatMap((node) =>
    node.options
      .filter((option) => option.flags.some((flag) => GLOBAL_OPTION_FLAGS.includes(flag)))
      .map((option) => `${node.path.join(" ")} ${option.flags.join("|")}`)
  );
  assertEquals(offenders, []);
});

const DOC_RULES = ["doc-record", "doc-example", "doc-see-also", "doc-noun", "doc-output-kind"] as const;
const DOCUMENTED_NOUNS = [
  "request",
  "plan",
  "review",
  "approval",
  "daemon",
  "flow",
  "blueprint",
  "skill",
  "portal",
  "memory",
  "config",
  "git",
  "mcp",
  "dashboard",
  "log",
  "model",
];

function unlisted(rule: (typeof DOC_RULES)[number], violations = liveDocViolations()) {
  return violations.filter((violation) => violation.rule === rule && !isAllowlisted(violation, allowlist));
}

Deno.test("every tree leaf has exactly one doc record and every record has a leaf", () => {
  assertEquals(unlisted("doc-record"), []);
});

Deno.test("every example parses against the live tree and every summary follows the standard", () => {
  assertEquals(unlisted("doc-example"), []);
});

Deno.test("every see-also entry resolves to a leaf", () => {
  assertEquals(unlisted("doc-see-also"), []);
});

Deno.test("every root noun has a noun doc with a group", () => {
  assertEquals(unlisted("doc-noun"), []);
});

Deno.test("every record declares an output kind and only the named leaves are PROTOCOL", () => {
  assertEquals(unlisted("doc-output-kind"), []);
  const protocol = EXACTL_COMMAND_DOCS.filter((doc) => doc.output === ExaCtlOutputKind.PROTOCOL).map((doc) =>
    doc.path.join(" ")
  );
  assertEquals(protocol, ["daemon logs", "mcp serve", "dashboard"]);
});

Deno.test("the doc rules have no allow-list entries for the documented nouns", () => {
  for (const rule of DOC_RULES) {
    const entries = allowlist[rule].filter((path) => DOCUMENTED_NOUNS.includes(path.split(" ")[0]));
    assertEquals(entries, [], rule);
  }
});

Deno.test("renaming an option used in a plan example makes the example rule fail", () => {
  const broken = EXACTL_COMMAND_DOCS.map((doc) =>
    doc.path.join(" ") === "plan list"
      ? {
        ...doc,
        examples: doc.examples.map((example) => ({
          ...example,
          command: example.command.replace("--status", "--state"),
        })),
      }
      : doc
  );
  const failing = unlisted("doc-example", liveDocViolations(broken));
  assertEquals(failing.map((violation) => violation.path), ["plan list"]);
});

Deno.test("seeded records break each doc rule", () => {
  const base = EXACTL_COMMAND_DOCS.find((doc) => doc.path.join(" ") === "plan show");
  assert(base !== undefined);
  const seeded = (change: Partial<IExaCtlCommandDoc>, rule: (typeof DOC_RULES)[number]) =>
    unlisted(rule, liveDocViolations([...EXACTL_COMMAND_DOCS.filter((doc) => doc !== base), { ...base, ...change }]));
  assertEquals(seeded({ summary: "Shows one plan." }, "doc-example").length, 1);
  assertEquals(seeded({ summary: "x".repeat(73) }, "doc-example").length, 1);
  assertEquals(seeded({ examples: [] }, "doc-example").length, 1);
  assertEquals(seeded({ seeAlso: ["exactl plan nowhere"] }, "doc-see-also").length, 1);
  assertEquals(seeded({ output: ExaCtlOutputKind.PROTOCOL }, "doc-output-kind").length, 1);
  assertEquals(seeded({ path: ["plan", "ghost"] }, "doc-record").length, 2);
});
