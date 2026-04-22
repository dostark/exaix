/**
 * @module CheckCodeStyleTest
 * @path tests/scripts/check_code_style_test.ts
 * @description Regression tests for scripts/check_code_style.ts, including test-file multiline fixture detection.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

Deno.test("check_code_style flags inline multiline fixture text in test files", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "inline_fixture_test.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempInlineFixtureTest
 * @path tests/scripts/inline_fixture_test.ts
 */

Deno.test("inline fixture markdown", () => {
  const markdown = \`---
identity_id: coder-agent
status: pending
---

# Bad
\`;
  assertEquals(markdown.includes("Bad"), true);
});
`,
  );

  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config=deno.json", "-A", "scripts/check_code_style.ts", filePath],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

  assertEquals(result.code, 1);
  assertStringIncludes(output, "[test-inline-multiline-fixture]");
});

Deno.test("check_code_style does not flag same inline multiline text in non-test files", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "inline_fixture.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempInlineFixtureNonTest
 * @path tests/scripts/inline_fixture.ts
 * @description Temporary non-test fixture file for code style regression coverage.
 */

const markdown = \`---
identity_id: coder-agent
status: pending
---

# Bad
\`;
export { markdown };
`,
  );

  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config=deno.json", "-A", "scripts/check_code_style.ts", filePath],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

  assertEquals(result.code, 0, output);
});
