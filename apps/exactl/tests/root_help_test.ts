/**
 * @module RootHelpTest
 * @path apps/exactl/tests/root_help_test.ts
 * @description Verifies the root help lists the four command groups in order and every global option under the before-or-after heading.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/exactl.ts]
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { assert, assertStringIncludes } from "@std/assert";
import { createExaCtlCommand } from "../src/exactl.ts";
import { ExaCtlCommandGroup } from "../src/docs/exactl_noun_doc.ts";

const GLOBAL_HEADING = "Global options (before or after the command)";
const GLOBAL_FLAGS = ["-o, --output", "--json", "-q, --quiet", "--no-color", "--no-input", "-y, --yes"];
const LEADING_EXAMPLE = "exactl -o json plan list";

const help = createExaCtlCommand().getHelp();

Deno.test("exactl --help lists the four groups in order", () => {
  const positions = Object.values(ExaCtlCommandGroup).map((group) => help.indexOf(`${group}:`));
  assert(positions.every((position) => position >= 0), `a group is missing from the help\n${help}`);
  assert(
    positions.every((position, index) => index === 0 || position > positions[index - 1]),
    "groups are out of order",
  );
});

Deno.test("exactl --help lists every global option under the before-or-after heading", () => {
  const section = help.slice(help.indexOf(GLOBAL_HEADING));
  assertStringIncludes(help, GLOBAL_HEADING);
  for (const flags of GLOBAL_FLAGS) assertStringIncludes(section, flags);
  assertStringIncludes(section, LEADING_EXAMPLE);
});
