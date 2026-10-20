/**
 * @module CheckCodeStyleTest
 * @path packages/lint-policy/tests/check_code_style_test.ts
 * @description Regression tests for the moved style checker.
 */

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");

async function runCheckCodeStyle(filePath: string): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config=deno.json", "-A", "packages/lint-policy/src/checkers/check_code_style.ts", filePath],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

  return { code: result.code, output };
}

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

Deno.test("check_code_style allows root import of testing shims (rule removed)", async () => {
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
    // [package-testing-import] rule was removed; style check now passes.
    assertEquals(result.code, 0, result.output);
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

Deno.test.ignore(
  "check_code_style flags deep src imports into package-owned runtime surfaces when a canonical package alias exists",
  async () => {
    const tempDir = await Deno.makeTempDir();
    await Deno.mkdir(join(tempDir, "packages", "somepkg", "src"), { recursive: true });
    await Deno.mkdir(join(tempDir, "packages", "mcp", "server"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "packages", "mcp", "server", "local_tool_dispatcher.ts"),
      `export class LocalToolDispatcher {}`,
    );
    const filePath = join(tempDir, "packages", "somepkg", "src", "__temp_package_runtime_import.ts");
    await Deno.writeTextFile(
      filePath,
      `/**
 * @module TempPackageRuntimeImport
 * @path packages/somepkg/src/__temp_package_runtime_import.ts
 * @description Temporary regression file for canonical package runtime import enforcement.
 */

import { LocalToolDispatcher as LocalToolDispatcherBase } from "../../../mcp/server/local_tool_dispatcher.ts";

export class LocalToolDispatcher extends LocalToolDispatcherBase {}
`,
    );

    try {
      const result = await runCheckCodeStyle(filePath);

      assertEquals(result.code, 1, result.output);
      assertStringIncludes(result.output, "[package-canonical-import]");
      assertStringIncludes(result.output, "@exaix-team/mcp-server");
    } finally {
      await Deno.remove(filePath);
    }
  },
);

Deno.test("check_code_style flags deep package alias imports when a canonical subpath barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_package_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageAliasImport
 * @path __temp_package_alias_import.ts
 * @description Temporary regression file for canonical package subpath alias enforcement.
 */

import { parsePortalURI } from "@exaix-team/mcp-server/resources.ts";

console.log(parsePortalURI);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix-team/mcp-server");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep logger package alias imports when a canonical logger barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_package_logger_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageLoggerAliasImport
 * @path __temp_package_logger_alias_import.ts
 * @description Temporary regression file for canonical logger barrel enforcement.
 */

import { EventLogger } from "@exaix/core/logger/event_logger.ts";

console.log(EventLogger);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/core/logger");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep config package alias imports when a canonical config barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_package_config_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageConfigAliasImport
 * @path __temp_package_config_alias_import.ts
 * @description Temporary regression file for canonical config barrel enforcement.
 */

import { ConfigService } from "@exaix/core/config/service.ts";

console.log(ConfigService);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/core/config");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep ai provider imports when a canonical providers barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_ai_provider_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempAiProviderAliasImport
 * @path __temp_ai_provider_alias_import.ts
 * @description Temporary regression file for canonical ai providers barrel enforcement.
 */

import { MockLLMProvider } from "@exaix/ai/providers/mock_llm_provider.ts";

console.log(MockLLMProvider);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/ai/providers");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep core status imports when a canonical status barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_core_status_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempCoreStatusAliasImport
 * @path __temp_core_status_alias_import.ts
 * @description Temporary regression file for canonical core status barrel enforcement.
 */

import { RequestStatus } from "@exaix/core/status/request_status.ts";

console.log(RequestStatus);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/core/status");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags parent package barrels that promote canonical subpackage exports", async () => {
  const filePath = join(REPO_ROOT, "packages", "core", "mod.ts");
  const originalContent = await Deno.readTextFile(filePath);
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempParentPackagePromotion
 * @path packages/core/mod.ts
 * @description Temporary regression file for parent package barrel promotion enforcement.
 */

export * from "./src/status/mod.ts";
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-subpath-promotion]");
    assertStringIncludes(result.output, "@exaix/core/status");
  } finally {
    await Deno.writeTextFile(filePath, originalContent);
  }
});

Deno.test("fix(check_code_style): flags package headers that reference retired root src ownership paths", async () => {
  const filePath = join(REPO_ROOT, "packages", "core", "src", "types", "__temp_related_files_root_src.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module ITempRelatedFilesRootSrc
 * @path packages/core/src/types/__temp_related_files_root_src.ts
 * @description Temporary regression file for package header related-files validation.
 * @related-files ["src/services/core/db.ts"]
 */

export interface ITempRelatedFilesRootSrc {
  ok: boolean;
}
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-related-files-boundary]");
    assertStringIncludes(result.output, "src/services/core/db.ts");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style allows parent package barrels to export the root-owned core types surface", async () => {
  const filePath = join(REPO_ROOT, "packages", "core", "mod.ts");
  const originalContent = await Deno.readTextFile(filePath);
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempParentPackageTypesExport
 * @path packages/core/mod.ts
 * @description Temporary regression file for root-owned core types export allowance.
 */

export type { Actor } from "./src/types/actor.ts";
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 0, result.output);
  } finally {
    await Deno.writeTextFile(filePath, originalContent);
  }
});

Deno.test("check_code_style does not exempt lines after a backtick inside a regex literal", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "backtick_regex_mask.ts");
  const lines = [
    "/**",
    " * @module TempBacktickRegexMask",
    " * @path backtick_regex_mask.ts",
    " * @description Temporary fixture: a regex backtick must not mask later lines.",
    " */",
    "",
    'const stripBackticks = (s: string): string => s.replace(/[\\$`]/g, "");',
    "const gated = edition === 'team';",
    "",
  ];
  await Deno.writeTextFile(filePath, lines.join("\n"));

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 1, result.output);
  assertStringIncludes(result.output, "[edition-conditional-outside-composer]");
  assertStringIncludes(result.output, `${filePath}:8`);
});

Deno.test("check_code_style exempts text inside a real multi-line template literal", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "template_text.ts");
  const lines = [
    "/**",
    " * @module TempTemplateText",
    " * @path template_text.ts",
    " * @description Temporary fixture: template text is not code.",
    " */",
    "",
    "export const guidance = `",
    "  Never write edition === 'team' in code;",
    "  name the shape at the boundary instead.",
    "`;",
    "",
  ];
  await Deno.writeTextFile(filePath, lines.join("\n"));

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 0, result.output);
  assertFalse(result.output.includes("[edition-conditional-outside-composer]"), result.output);
});

Deno.test("check_code_style is not fooled by comment, escaped-string, or nested template backticks", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "backtick_forms.ts");
  const lines = [
    "/**",
    " * @module TempBacktickForms",
    " * @path backtick_forms.ts",
    " * @description Temporary fixture: backtick forms must not mask later lines.",
    " */",
    "",
    "// A comment that mentions a single backtick `",
    'export const escaped = "a \\` b";',
    "const nested = `",
    "  outer ${`inner`} text",
    "`;",
    "const gated = edition === 'team';",
    "",
  ];
  await Deno.writeTextFile(filePath, lines.join("\n"));

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 1, result.output);
  assertStringIncludes(result.output, "[edition-conditional-outside-composer]");
  assertStringIncludes(result.output, `${filePath}:12`);
});
