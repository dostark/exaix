/**
 * @module ScenarioFrameworkFixturesDirResolutionTest
 * @path tests/scenario_framework/tests/unit/fixtures_dir_resolution_test.ts
 * @description Phase 157 Step 3 — `mock.fixtures_dir` is resolved relative to the daemon's
 *   own cwd (the sandbox workspace root), not the repo tree where committed fixtures live.
 *   `seedWorkspaceConfig` copies the framework's `exa.config.toml` into the sandbox verbatim
 *   today, so a `$FRAMEWORK_HOME`-relative `fixtures_dir` written in the framework config
 *   would reach the daemon as a literal, unexpanded `$FRAMEWORK_HOME/...` string — resolving
 *   to nothing. The seed must expand `$VAR`s the same way step commands/env already do.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/exa.config.toml]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { seedWorkspaceConfig } from "../../runner/synthetic_runner.ts";

Deno.test("[fixtures_dir_resolution] seedWorkspaceConfig expands $FRAMEWORK_HOME in the copied config", async () => {
  const frameworkHome = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${frameworkHome}/exa.config.toml`,
    '[ai.mock]\nfixtures_dir = "$FRAMEWORK_HOME/fixtures/mock_recordings/flow_blueprints"\n',
  );
  const workspaceRoot = await Deno.makeTempDir();

  await seedWorkspaceConfig(workspaceRoot, frameworkHome);

  const written = await Deno.readTextFile(`${workspaceRoot}/exa.config.toml`);
  assertStringIncludes(
    written,
    `fixtures_dir = "${frameworkHome}/fixtures/mock_recordings/flow_blueprints"`,
    "fixtures_dir must resolve to an absolute, repo-tree-anchored path — not a literal $FRAMEWORK_HOME",
  );
});

Deno.test("[fixtures_dir_resolution] an existing sandbox config is left untouched (never overwritten)", async () => {
  const frameworkHome = await Deno.makeTempDir();
  await Deno.writeTextFile(`${frameworkHome}/exa.config.toml`, '[ai.mock]\nfixtures_dir = "$FRAMEWORK_HOME/x"\n');
  const workspaceRoot = await Deno.makeTempDir();
  await Deno.writeTextFile(`${workspaceRoot}/exa.config.toml`, "# scenario-authored config\n");

  await seedWorkspaceConfig(workspaceRoot, frameworkHome);

  const written = await Deno.readTextFile(`${workspaceRoot}/exa.config.toml`);
  assertEquals(written, "# scenario-authored config\n");
});
