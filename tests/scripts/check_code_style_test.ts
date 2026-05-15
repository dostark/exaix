/**
 * @module CheckCodeStyleTest
 * @path tests/scripts/check_code_style_test.ts
 * @description Regression tests for scripts/check_code_style.ts, including test-file multiline fixture detection.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

async function runCheckCodeStyle(filePath: string): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config=deno.json", "-A", "scripts/check_code_style.ts", filePath],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

  return { code: result.code, output };
}

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
  const markdown = \Deno.readTextFileSync(join(FIXTURE_ROOT, 'scripts', 'check_code_style_test', 'markdown.md'));
  assertEquals(markdown.includes("Bad"), true);
});
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 1);
  assertStringIncludes(result.output, "Header is missing mandatory '@description' tag.");
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

const markdown = \Deno.readTextFileSync(join(FIXTURE_ROOT, 'scripts', 'check_code_style_test', 'markdown.md'));
export { markdown };
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 0, result.output);
});

Deno.test("check_code_style flags deep imports into package tests when a public testing subpath exists", async () => {
  const filePath = join(REPO_ROOT, "tests", "scripts", "__temp_package_testing_deep_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageTestingDeepImport
 * @path tests/scripts/__temp_package_testing_deep_import.ts
 * @description Temporary regression file for package testing-subpath import enforcement.
 */

import { TEST_DEFAULT_BRANCH } from "../../packages/git/tests/helpers/constants.ts";

console.log(TEST_DEFAULT_BRANCH);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-testing-import]");
    assertStringIncludes(result.output, "@exaix/git/testing");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags root shim imports when the package testing subpath is the canonical path", async () => {
  const filePath = join(REPO_ROOT, "tests", "scripts", "__temp_package_testing_shim_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageTestingShimImport
 * @path tests/scripts/__temp_package_testing_shim_import.ts
 * @description Temporary regression file for root testing shim import enforcement.
 */

import { TEST_DEFAULT_BRANCH } from "../helpers/constants.ts";

console.log(TEST_DEFAULT_BRANCH);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-testing-import]");
    assertStringIncludes(result.output, "@exaix/git/testing");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style allows compatibility re-export shims under tests helpers", async () => {
  const filePath = join(REPO_ROOT, "tests", "helpers", "__temp_git_testing_shim.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempGitTestingShim
 * @path tests/helpers/__temp_git_testing_shim.ts
 * @description Temporary compatibility shim regression file for code style coverage.
 */

export { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 0, result.output);
  } finally {
    await Deno.remove(filePath);
  }
});
