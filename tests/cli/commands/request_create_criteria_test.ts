/**
 * @module RequestCreateCriteriaTest
 * @path tests/cli/commands/request_create_criteria_test.ts
 * @description Tests for --acceptance-criteria and --expected-outcome CLI flag
 * propagation to YAML frontmatter (Phase 49, Step 11).
 * @architectural-layer Tests
 * @dependencies [src/cli/commands/request_commands.ts, src/shared/types/request.ts]
 * @related-files [.copilot/planning/phase-49-quality-pipeline-hardening.md]
 */
import { assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { RequestCommands } from "../../../src/cli/commands/request_commands.ts";
import { createCliTestContext } from "../helpers/test_setup.ts";
import { getWorkspaceRequestsDir } from "../../helpers/paths_helper.ts";
import { join } from "@std/path";

describe("[request create] CLI criteria flags", () => {
  let requestCommands: RequestCommands;
  let requestsDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createCliTestContext({
      createDirs: ["Workspace/Requests", "Blueprints/Flows"],
    });
    cleanup = result.cleanup;
    requestsDir = getWorkspaceRequestsDir(result.tempDir);
    requestCommands = new RequestCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("writes acceptance_criteria to frontmatter", async () => {
    const result = await requestCommands.create("Do something", {
      acceptanceCriteria: ["All tests pass", "No regressions"],
    });
    const content = await Deno.readTextFile(result.path!);
    assertStringIncludes(content, "acceptance_criteria:");
    assertStringIncludes(content, "All tests pass");
    assertStringIncludes(content, "No regressions");
  });

  it("writes multiple criteria from repeated flags", async () => {
    const result = await requestCommands.create("Do something", {
      acceptanceCriteria: ["Criterion A", "Criterion B", "Criterion C"],
    });
    const content = await Deno.readTextFile(result.path!);
    assertStringIncludes(content, "Criterion A");
    assertStringIncludes(content, "Criterion B");
    assertStringIncludes(content, "Criterion C");
  });

  it("writes expected_outcomes to frontmatter", async () => {
    const result = await requestCommands.create("Do something", {
      expectedOutcomes: ["Server returns 200", "DB updated"],
    });
    const content = await Deno.readTextFile(result.path!);
    assertStringIncludes(content, "expected_outcomes:");
    assertStringIncludes(content, "Server returns 200");
    assertStringIncludes(content, "DB updated");
  });

  it("creates request without criteria flags", async () => {
    const result = await requestCommands.create("Do something");
    const path = result.path ?? join(requestsDir, `${result.trace_id}.md`);
    const content = await Deno.readTextFile(path);
    assertStringIncludes(content, "---"); // Valid YAML front matter
    assertStringIncludes(content, "status: pending");
  });
});
