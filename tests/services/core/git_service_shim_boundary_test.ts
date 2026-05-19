/**
 * @module GitServiceShimBoundaryTest
 * @path tests/services/core/git_service_shim_boundary_test.ts
 * @description Verifies root runtime entrypoints prefer @exaix/git directly while the legacy root shim remains package-backed.
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..", "..", "..");

const SHIM_IMPORT_OFFENDERS = [
  "src/main.ts",
  "src/cli/exactl.ts",
  "src/cli/init.ts",
  "src/services/plan/plan_executor.ts",
  "src/services/agent/execution_loop.ts",
  "src/services/adapters/git_adapter.ts",
] as const;

const SHIM_IMPORT_TEST_OFFENDERS = [
  "tests/helpers/git_test_helper.ts",
  "tests/security/git_security_regression_test.ts",
  "tests/services/review/review_registry_portal_test.ts",
  "tests/cli/exactl_coverage_test.ts",
] as const;

const GIT_TESTING_SHIM_OFFENDERS = [
  "tests/security/git_security_regression_test.ts",
  "tests/services/review/review_registry_portal_test.ts",
  "tests/services/plan/plan_executor_test.ts",
  "tests/mcp/helpers/test_setup.ts",
  "tests/services/execution/execution_loop_test.ts",
  "tests/integration/24_portal_e2e_workflow_test.ts",
  "tests/integration/helpers/test_environment.ts",
  "tests/integration/37_multi_step_recovery_test.ts",
  "tests/cli/helpers/test_setup.ts",
  "tests/mcp/resources_test.ts",
  "tests/mcp/server_resources_test.ts",
  "tests/agents/git_audit_parser_test.ts",
  "tests/agents/SHA_accuracy_test.ts",
  "tests/security/agent_isolation_audit_test.ts",
  "tests/security/portal_permissions_test.ts",
  "tests/integration/36_portal_workspace_integration_test.ts",
  "tests/cli/review_commands_coverage_test.ts",
  "tests/cli/review_commands_test.ts",
  "tests/integration/agent/cost_logging_test.ts",
  "tests/integration/agent/context_overflow_recovery_test.ts",
  "tests/integration/agent/mcp_real_execution_test.ts",
  "tests/services/request/request_processor_knowledge_test.ts",
  "tests/services/workspace/workspace_execution_context_test.ts",
  "tests/services/portal/portal_context_grounding_test.ts",
  "tests/services/portal/portal_multi_support_test.ts",
  "tests/services/portal/portal_context_grounding_regression_test.ts",
  "tests/services/agent/agent_executor_test.ts",
  "tests/services/agent/agent_executor_workspace_context_test.ts",
  "tests/services/agent/agent_executor_context_api_test.ts",
  "tests/services/helpers/portal_workspace_test_helper.ts",
] as const;

const LEGACY_SHIM_IMPORT_SUBPATHS = [
  "/services/core/git_service.ts",
  "/core/git_service.ts",
] as const;
const PACKAGE_IMPORT_SUBPATH = "@exaix/git";

function hasLegacyGitShimImport(source: string): boolean {
  const importSpecifierMatches = source.matchAll(/import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g);

  for (const match of importSpecifierMatches) {
    const specifier = match[1];
    if (LEGACY_SHIM_IMPORT_SUBPATHS.some((subpath) => specifier.includes(subpath))) {
      return true;
    }
  }

  return false;
}

Deno.test("runtime entrypoints avoid the legacy root Git service shim", async () => {
  const offenders: string[] = [];

  for (const relativePath of [...SHIM_IMPORT_OFFENDERS, ...SHIM_IMPORT_TEST_OFFENDERS]) {
    const source = await Deno.readTextFile(join(REPO_ROOT, relativePath));
    if (hasLegacyGitShimImport(source)) {
      offenders.push(relativePath);
    }
  }

  assertEquals(offenders, []);
});

Deno.test("root Git service shim delegates to @exaix/git", async () => {
  const shimSource = await Deno.readTextFile(join(REPO_ROOT, "src/services/core/git_service.ts"));

  assertEquals(shimSource.includes(PACKAGE_IMPORT_SUBPATH), true);
});

Deno.test("root helpers do not deep-import git package test internals", async () => {
  const gitHelperSource = await Deno.readTextFile(join(REPO_ROOT, "tests/helpers/git_test_helper.ts"));
  const portalHelperSource = await Deno.readTextFile(join(REPO_ROOT, "tests/helpers/portal_test_utils.ts"));
  const constantsSource = await Deno.readTextFile(join(REPO_ROOT, "tests/helpers/constants.ts"));

  assertEquals(gitHelperSource.includes("packages/git/tests/helpers"), false);
  assertEquals(portalHelperSource.includes("packages/git/tests/helpers"), false);
  assertEquals(constantsSource.includes("packages/git/tests/helpers"), false);
  assertEquals(gitHelperSource.includes("@exaix/git/testing"), true);
  assertEquals(portalHelperSource.includes("@exaix/git/testing"), true);
  assertEquals(constantsSource.includes("@exaix/git/testing"), true);
});

Deno.test("root tests import git-specific helpers directly from @exaix/git/testing", async () => {
  const offenders: string[] = [];

  for (const relativePath of GIT_TESTING_SHIM_OFFENDERS) {
    const source = await Deno.readTextFile(join(REPO_ROOT, relativePath));
    if (
      source.includes("helpers/git_test_helper.ts") ||
      (source.includes("setupPortalGitRepos") && source.includes("helpers/portal_test_utils.ts")) ||
      (source.includes("TEST_DEFAULT_BRANCH") && source.includes("helpers/constants.ts"))
    ) {
      offenders.push(relativePath);
    }
  }

  assertEquals(offenders, []);
});
