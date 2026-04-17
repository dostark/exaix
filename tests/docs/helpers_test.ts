/**
 * @module DocsHelpersTest
 * @path tests/docs/helpers_test.ts
 * @description Verifies the docs helper utilities used across documentation tests.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { readDoc, readUserGuide, templateExists } from "./helpers.ts";

describe("Docs helpers", () => {
  let originalCwd = Deno.cwd();

  afterEach(() => {
    Deno.chdir(originalCwd);
  });

  it("reads the user guide file successfully", async () => {
    originalCwd = Deno.cwd();
    const content = await readUserGuide();
    assertStringIncludes(content, "#");
  });

  it("reads a specific documentation file", async () => {
    originalCwd = Deno.cwd();
    const content = await readDoc("Exaix_User_Guide.md");
    assertStringIncludes(content, "#");
  });

  it("returns false for a missing template file and true for an existing one", async () => {
    originalCwd = Deno.cwd();
    const tempDir = await Deno.makeTempDir({ prefix: "docs-helpers-" });
    await Deno.mkdir(join(tempDir, "templates"), { recursive: true });
    Deno.chdir(tempDir);

    const missing = await templateExists("missing-template.md");
    assertEquals(missing, false);

    await Deno.writeTextFile(join(tempDir, "templates/test-template.md"), "template content");
    const present = await templateExists("test-template.md");
    assertEquals(present, true);

    await Deno.remove(tempDir, { recursive: true });
  });
});
