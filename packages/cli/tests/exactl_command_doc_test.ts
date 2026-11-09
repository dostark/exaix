/**
 * @module ExaCtlCommandDocTest
 * @path packages/cli/tests/exactl_command_doc_test.ts
 * @description Verifies that a doc record becomes cliffy help text, that the terminal rendering carries see-also, exit codes and the docs link, and that unsupported Markdown is rejected.
 * @architectural-layer CLI
 * @dependencies [@std/assert, @cliffy/command, packages/cli/src/docs/exactl_command_doc.ts]
 * @related-files [packages/cli/src/docs/exactl_command_doc.ts]
 */

import { assertEquals, assertNotMatch, assertStringIncludes, assertThrows } from "@std/assert";
import { Command } from "@cliffy/command";
import { ExaCtlOutputKind } from "@exaix/cli";
import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import {
  documented,
  exactlDocsLink,
  type IExaCtlCommandDoc,
  renderDocForTerminal,
} from "@exaix/cli/docs/exactl_command_doc.ts";

const DOC: IExaCtlCommandDoc = {
  path: ["plan", "approve"],
  summary: "Approve plans and move them to Active",
  description: "Approves each plan in review.\n\n- `--all` approves every plan in review",
  examples: [
    { title: "Approve one plan", command: "exactl plan approve plan-1" },
    { title: "Approve every plan in review", command: "exactl plan approve --all" },
  ],
  seeAlso: ["exactl plan show"],
  exitCodes: [ExaCtlExitCode.NOT_FOUND, ExaCtlExitCode.STATE_CONFLICT],
  output: ExaCtlOutputKind.MUTATION,
};

Deno.test("documented sets the summary as the first description line", () => {
  const command = documented(new Command(), DOC);
  assertEquals(command.getShortDescription(), DOC.summary);
  assertStringIncludes(command.getDescription(), "Approves each plan in review.");
});

Deno.test("documented adds every example to cliffy", () => {
  const examples = documented(new Command(), DOC).getExamples();
  assertEquals(examples.map((example) => example.name), DOC.examples.map((example) => example.title));
  assertEquals(examples.map((example) => example.description), DOC.examples.map((example) => example.command));
});

Deno.test("terminal rendering prints see-also, exit codes and the docs link under its label", () => {
  const text = renderDocForTerminal(DOC, ["review", "approved"]);
  assertStringIncludes(text, "Lifecycle: review → approved");
  assertStringIncludes(text, "See also");
  assertStringIncludes(text, "exactl plan show");
  assertStringIncludes(text, "Exit codes");
  assertStringIncludes(text, "NOT_FOUND (3)");
  assertStringIncludes(text, "STATE_CONFLICT (4)");
  assertStringIncludes(text, "In the Exaix repository: docs/cli/plan.md#approve");
});

Deno.test("a doc without a lifecycle prints no lifecycle line", () => {
  assertNotMatch(renderDocForTerminal(DOC, []), /Lifecycle/);
});

Deno.test("a description with a heading or a table is rejected", () => {
  assertThrows(() => documented(new Command(), { ...DOC, description: "# Heading\n\ntext" }), Error, "DOC_DESCRIPTION");
  assertThrows(
    () => documented(new Command(), { ...DOC, description: "| a | b |\n| - | - |" }),
    Error,
    "DOC_DESCRIPTION",
  );
});

Deno.test("exactlDocsLink points at the noun page and the verb anchor", () => {
  assertEquals(exactlDocsLink(["plan", "approve"]), "docs/cli/plan.md#approve");
  assertEquals(exactlDocsLink(["plan", "amendment", "list"]), "docs/cli/plan.md#amendment-list");
  assertEquals(exactlDocsLink(["doctor"]), "docs/cli/doctor.md");
});
