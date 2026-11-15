/**
 * @module PlanHelpTest
 * @path apps/exactl/tests/plan_help_test.ts
 * @description Verifies that the plan and daemon help text comes from the doc records.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/exactl.ts]
 * @related-files [apps/exactl/src/command_docs/plan_docs.ts, apps/exactl/src/command_docs/daemon_docs.ts]
 */

import { assert, assertStringIncludes } from "@std/assert";
import { createExaCtlCommand } from "../src/exactl.ts";
import { PlanStatus } from "@exaix/core/status";

const root = createExaCtlCommand();
root.getHelp();

interface IHelpNode {
  getHelp(): string;
  getCommand(name: string): IHelpNode | undefined;
}

function helpOf(...path: string[]): string {
  let node: IHelpNode = root;
  for (const word of path) {
    const child = node.getCommand(word);
    assert(child !== undefined, `no command ${path.join(" ")}`);
    node = child;
  }
  return node.getHelp();
}

Deno.test("exactl plan approve --help shows the plan lifecycle, examples, exit codes and docs link", () => {
  const help = helpOf("plan", "approve");
  assertStringIncludes(help, `Lifecycle: ${PlanStatus.REVIEW} → ${PlanStatus.APPROVED}`);
  assertStringIncludes(help, "exactl plan approve --all");
  assertStringIncludes(help, "Exit codes");
  assertStringIncludes(help, "In the Exaix repository: docs/cli/plan.md#exactl-plan-approve");
});

Deno.test("exactl daemon status --help shows an example and its docs link", () => {
  const help = helpOf("daemon", "status");
  assertStringIncludes(help, "exactl daemon status -o json");
  assertStringIncludes(help, "docs/cli/daemon.md#exactl-daemon-status");
});
