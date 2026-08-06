/**
 * @module ScenarioFrameworkGitHelpers
 * @path tests/scenario_framework/runner/git_helpers.ts
 * @description Shared repo-scoped GitService factory for the scenario framework. The framework
 *   must never spawn a raw git CLI directly — the Exaix GitService is the sanctioned native
 *   layer. Only `repoPath` is read at runtime by runGitCommand, so a parsed minimal config
 *   satisfies the constructor type.
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/runner/history_writer.ts]
 */

import { ExaPathDefaults } from "@exaix/core";
import { GitService } from "@exaix/git";
import { ConfigSchema } from "@exaix/schemas";
import type { Config } from "@exaix/schemas/config.ts";

/** Cached minimal config for the fixture-staging GitService — only `repoPath` is read at
 *  runtime (runGitCommand), so a parsed minimal config satisfies the constructor type. */
let fixtureGitConfig: Config | undefined;

function getFixtureGitConfig(): Config {
  fixtureGitConfig ??= ConfigSchema.parse({
    system: { root: "", log_level: "info" },
    paths: { ...ExaPathDefaults },
  });
  return fixtureGitConfig;
}

/** A repo-scoped GitService. Native Exaix git layer — no raw `git` CLI spawn in framework code. */
export function gitServiceFor(repoPath: string): GitService {
  return new GitService({ config: getFixtureGitConfig(), repoPath });
}
