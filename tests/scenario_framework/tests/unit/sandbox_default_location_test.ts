/**
 * @module ScenarioFrameworkSandboxDefaultLocationTest
 * @path tests/scenario_framework/tests/unit/sandbox_default_location_test.ts
 * @description RED-first tests for the sandbox default-location policy. When no
 * explicit workspace_path is supplied (neither CLI flag nor file config), the
 * runtime config must resolve workspace_path to a sibling-of-repo sandbox under
 * `<base>/exaix-sandboxes/<run-id>` — NEVER the repo root — where `<base>` is
 * `EXA_SANDBOX_BASE` when set, else the parent directory of the repo root. An
 * explicit absolute path always wins, and a resolved root equal to the repo root
 * is rejected as a guard against runtime-state contamination of the repo tree.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/config.ts, tests/scenario_framework/README.md]
 */

import { assert, assertEquals, assertNotEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { dirname, resolve } from "@std/path";
import { resolveRuntimeConfigForExecution } from "../../runner/config.ts";
import { WorkspaceProvenance } from "../../runner/sandbox_lifecycle.ts";

// The framework lives at <repo>/tests/scenario_framework; repo root is two levels up.
const EXECUTION_DIRECTORY = "/home/example/git/exaix/tests/scenario_framework";
const REPO_ROOT = resolve(EXECUTION_DIRECTORY, "..", "..");
const PARENT_OF_REPO = dirname(REPO_ROOT);

function withSandboxBase<T>(value: string | undefined, fn: () => T): T {
  const previous = Deno.env.get("EXA_SANDBOX_BASE");
  if (value === undefined) {
    Deno.env.delete("EXA_SANDBOX_BASE");
  } else {
    Deno.env.set("EXA_SANDBOX_BASE", value);
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      Deno.env.delete("EXA_SANDBOX_BASE");
    } else {
      Deno.env.set("EXA_SANDBOX_BASE", previous);
    }
  }
}

Deno.test("[SandboxDefault] absent workspace_path resolves to a sibling-of-repo sandbox, never the repo root", () => {
  const runtimeConfig = withSandboxBase(undefined, () =>
    resolveRuntimeConfigForExecution({
      executionDirectory: EXECUTION_DIRECTORY,
      fileConfig: {},
    }));

  // Default base is the parent of the repo root (sibling topology).
  assertStringIncludes(runtimeConfig.workspace_path, `${PARENT_OF_REPO}/exaix-sandboxes/`);
  // The guard: the resolved root must never equal the repo root itself.
  assertNotEquals(runtimeConfig.workspace_path, REPO_ROOT);
  // And it must sit outside the repo tree entirely.
  assert(
    !runtimeConfig.workspace_path.startsWith(`${REPO_ROOT}/`),
    `sandbox must live outside the repo tree, got: ${runtimeConfig.workspace_path}`,
  );
});

Deno.test("[SandboxDefault] EXA_SANDBOX_BASE overrides the default sibling base", () => {
  const runtimeConfig = withSandboxBase("/var/exa-sandboxes", () =>
    resolveRuntimeConfigForExecution({
      executionDirectory: EXECUTION_DIRECTORY,
      fileConfig: {},
    }));

  assertStringIncludes(runtimeConfig.workspace_path, "/var/exa-sandboxes/exaix-sandboxes/");
  assertNotEquals(runtimeConfig.workspace_path, REPO_ROOT);
});

Deno.test("[SandboxDefault] absent output_dir defaults under the resolved sandbox, never the repo root", () => {
  const runtimeConfig = withSandboxBase(undefined, () =>
    resolveRuntimeConfigForExecution({
      executionDirectory: EXECUTION_DIRECTORY,
      fileConfig: {},
    }));

  assertStringIncludes(runtimeConfig.output_dir, `${runtimeConfig.workspace_path}/`);
  assertNotEquals(runtimeConfig.output_dir, REPO_ROOT);
});

Deno.test("[SandboxDefault] explicit absolute workspace_path always wins over the default", () => {
  const runtimeConfig = withSandboxBase(undefined, () =>
    resolveRuntimeConfigForExecution({
      executionDirectory: EXECUTION_DIRECTORY,
      fileConfig: { workspace_path: "/tmp/explicit-sandbox" },
    }));

  assertEquals(runtimeConfig.workspace_path, "/tmp/explicit-sandbox");
});

Deno.test("[SandboxDefault] explicit CLI workspace flag wins over file config and default", () => {
  const runtimeConfig = withSandboxBase(undefined, () =>
    resolveRuntimeConfigForExecution({
      executionDirectory: EXECUTION_DIRECTORY,
      fileConfig: { workspace_path: "/tmp/from-file" },
      cliFlags: { workspace: "/tmp/from-cli" },
    }));

  assertEquals(runtimeConfig.workspace_path, "/tmp/from-cli");
});

Deno.test("[SandboxDefault] a resolved workspace_path equal to the repo root is rejected as contamination", () => {
  // EXA_SANDBOX_BASE pointing at the framework's grandparent with an explicit path
  // equal to the repo root must be refused — the guard protects against any caller
  // (or stale config) that would route runtime state into the repo tree.
  assertThrows(
    () =>
      resolveRuntimeConfigForExecution({
        executionDirectory: EXECUTION_DIRECTORY,
        fileConfig: { workspace_path: REPO_ROOT },
      }),
    Error,
    "repo root",
  );
});

// Provenance is recorded, not inferred: deciding "is this operator-supplied" by path shape
// would delete a real workspace the day `--workspace` points under the sandbox base, so the
// config carries the fact directly — whether an explicit path was given.

Deno.test("[SandboxDefault] a runner-minted sandbox is marked as such", () => {
  const config = withSandboxBase(
    undefined,
    () => resolveRuntimeConfigForExecution({ executionDirectory: EXECUTION_DIRECTORY }),
  );

  assertEquals(config.workspace_provenance, WorkspaceProvenance.RUNNER_MINTED);
});

Deno.test("[SandboxDefault] an explicit CLI workspace is marked operator-supplied", () => {
  const config = withSandboxBase(undefined, () =>
    resolveRuntimeConfigForExecution({
      executionDirectory: EXECUTION_DIRECTORY,
      cliFlags: { workspace: "/srv/operator-workspace" },
    }));

  assertEquals(config.workspace_provenance, WorkspaceProvenance.OPERATOR_SUPPLIED);
});

Deno.test("[SandboxDefault] a workspace_path from the config file is operator-supplied too", () => {
  // The file is as much the operator's statement of intent as the flag is.
  const config = withSandboxBase(undefined, () =>
    resolveRuntimeConfigForExecution({
      executionDirectory: EXECUTION_DIRECTORY,
      fileConfig: { workspace_path: "/srv/from-config" },
    }));

  assertEquals(config.workspace_provenance, WorkspaceProvenance.OPERATOR_SUPPLIED);
});
