/**
 * @module CliReferenceDriftTest
 * @path apps/exactl/tests/cli_reference_drift_test.ts
 * @description Verifies that the committed Solo CLI reference and the User Guide table equal what the command tree and the doc records render now.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/src/docs/cli_reference.ts]
 * @related-files [scripts/generate_cli_reference.ts, apps/exactl/src/docs/cli_reference.ts]
 */

import { assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createExaCtlCommand } from "../src/exactl.ts";
import { EXACTL_COMMAND_DOCS, EXACTL_NOUN_DOCS } from "../src/command_docs/mod.ts";
import { CliEdition, renderCliReference } from "../src/docs/cli_reference.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");
const CLI_DOCS_DIR = join(REPO_ROOT, "docs", "cli");
const USER_GUIDE = join(REPO_ROOT, "docs", "Exaix_User_Guide.md");
const GENERATOR = join(REPO_ROOT, "scripts", "generate_cli_reference.ts");
const REGENERATE_HINT = "Run `deno task docs:cli` and commit the result.";
const BLOCK_START = "<!-- exactl-reference:start -->";
const BLOCK_END = "<!-- exactl-reference:end -->";

const reference = renderCliReference({
  root: createExaCtlCommand(),
  nounDocs: EXACTL_NOUN_DOCS,
  commandDocs: EXACTL_COMMAND_DOCS,
  edition: CliEdition.SOLO,
});

Deno.test("the committed reference equals the rendered tree", async () => {
  const committed = new Set<string>();
  for await (const entry of Deno.readDir(CLI_DOCS_DIR)) committed.add(entry.name);
  assertEquals([...committed].sort(), [...reference.files.keys()].sort(), REGENERATE_HINT);
  for (const [name, rendered] of reference.files) {
    assertEquals(await Deno.readTextFile(join(CLI_DOCS_DIR, name)), rendered, `${name}. ${REGENERATE_HINT}`);
  }
});

Deno.test("the User Guide table equals the rendered summary table", async () => {
  const guide = await Deno.readTextFile(USER_GUIDE);
  const start = guide.indexOf(BLOCK_START);
  const end = guide.indexOf(BLOCK_END);
  assertEquals(start !== -1 && end > start, true, "the User Guide has its reference block");
  assertEquals(guide.slice(start + BLOCK_START.length, end).trim(), reference.userGuideTable, REGENERATE_HINT);
});

Deno.test("the Solo reference names no Team command", async () => {
  for (const name of reference.files.keys()) {
    assertNotMatch(await Deno.readTextFile(join(CLI_DOCS_DIR, name)), /export-otel/, name);
  }
  assertStringIncludes(await Deno.readTextFile(join(CLI_DOCS_DIR, "index.md")), "# exactl command reference");
});

Deno.test("the committed reference equals the rendered tree when the generator runs from another directory", async () => {
  const names = [...reference.files.keys()].map((name) => join(CLI_DOCS_DIR, name));
  const files = [...names, USER_GUIDE];
  const before = await Promise.all(files.map((path) => Deno.readTextFile(path)));
  const otherDir = await Deno.makeTempDir({ prefix: "exactl-generator-" });
  try {
    const { code, stderr } = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--config", join(REPO_ROOT, "deno.json"), GENERATOR, "--edition", "solo"],
      cwd: otherDir,
      stdout: "null",
      stderr: "piped",
    }).output();
    assertEquals(code, 0, new TextDecoder().decode(stderr));
    const after = await Promise.all(files.map((path) => Deno.readTextFile(path)));
    assertEquals(after, before, "the generator formats with the settings of the repository");
  } finally {
    await Deno.remove(otherDir, { recursive: true });
  }
});
