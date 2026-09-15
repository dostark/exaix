/**
 * @module EditionCommandFactoryTest
 * @path apps/exactl/tests/edition_command_factory_test.ts
 * @description Verifies edition command contributions register once before CLI parsing.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/exactl.ts]
 * @related-files [apps/exactl/src/exactl.ts]
 */

import { assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { createExaCtlCommand, type IExaCtlCommandOptions } from "../src/exactl.ts";

Deno.test("createExaCtlCommand applies an edition contribution once", () => {
  let calls = 0;
  const registration: NonNullable<IExaCtlCommandOptions["registerEditionCommands"]> = (root) => {
    calls++;
    root.command("edition-fixture", new Command().description("test contribution"));
  };
  const first = createExaCtlCommand({ registerEditionCommands: registration });
  const second = createExaCtlCommand({ registerEditionCommands: registration });
  assertEquals(first, second);
  assertEquals(calls, 1);
  assertEquals(first.getCommand("edition-fixture")?.getDescription(), "test contribution");
});
