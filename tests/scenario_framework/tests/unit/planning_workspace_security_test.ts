/**
 * @module PlanningWorkspaceSecurityTest
 * @path tests/scenario_framework/tests/unit/planning_workspace_security_test.ts
 * @description Checks isolated dogfood config preparation and rejects worktree escapes.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/planning_workspace.ts]
 */
import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas";
import { SkillRootKind } from "@exaix/core";
import { createSkillLoaderFor, REPO_ROOT, TestEnvironment, testSkillContext } from "@exaix/testing";
import { preparePlanningWorkspace } from "../../runner/planning_workspace.ts";

Deno.test("[security] planning workspace materializes the preset against the isolated fixture", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const worktree = join(env.tempDir, "p234-s6-c1");
    await Deno.mkdir(worktree);
    const result = await preparePlanningWorkspace(env.tempDir, "p234-s6-c1");
    assertEquals(result.worktree, worktree);
    const toml = await Deno.readTextFile(result.configPath);
    const parsed = ConfigSchema.parse(parse(toml));
    const live = ConfigSchema.parse(
      parse(await Deno.readTextFile(join(REPO_ROOT, "configs/dogfood.codex-terra-61.toml"))),
    );
    assertEquals(parsed.system.root, env.tempDir);
    assertExists(parsed.ai);
    assertExists(live.ai);
    assertEquals(parsed.ai.provider, live.ai.provider);
    assertEquals(parsed.ai.model, live.ai.model);
    assertEquals(parsed.request_analysis.enabled, live.request_analysis.enabled);
    assertEquals(parsed.portals.find((portal) => portal.alias === "exaix-self")?.target_path, worktree);
    assertEquals(
      parsed.skills.roots?.find((root) => root.kind === SkillRootKind.DOGFOOD)?.path,
      join(worktree, ".copilot/skills"),
    );
    assertStringIncludes(toml, `${worktree}/.copilot/skills`);
    const load = (path: string) =>
      createSkillLoaderFor([{ path, kind: SkillRootKind.DOGFOOD, writable: false, project: null }]).get(
        "plan",
        testSkillContext(),
      );
    const copied = await load(join(worktree, ".copilot/skills"));
    const original = await load(join(REPO_ROOT, ".copilot/skills"));
    assertExists(copied);
    assertExists(original);
    assertEquals(copied.revisionId, original.revisionId);
    assertEquals(copied.contentSha256, original.contentSha256);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[security] planning workspace rejects invalid case identities and symlink escape", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  const outside = await Deno.makeTempDir();
  try {
    await assertRejects(() => preparePlanningWorkspace(env.tempDir, "../outside"), Error, "Invalid planning case");
    await Deno.symlink(outside, join(env.tempDir, "p234-s6-c1"));
    await assertRejects(() => preparePlanningWorkspace(env.tempDir, "p234-s6-c1"), Error, "Access denied");
  } finally {
    await env.cleanup();
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("[security] planning workspace rejects a skill destination symlink escape", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  const outside = await Deno.makeTempDir();
  try {
    const worktree = join(env.tempDir, "p234-s6-c1");
    await Deno.mkdir(worktree);
    await Deno.symlink(outside, join(worktree, ".copilot"));
    await assertRejects(() => preparePlanningWorkspace(env.tempDir, "p234-s6-c1"), Error, "Access denied");
    assertEquals([...Deno.readDirSync(outside)], []);
  } finally {
    await env.cleanup();
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("[security] development cases copy the intended dogfood skill into an isolated worktree", async () => {
  for (
    const item of [
      { caseId: "p234-s1-c1", worktree: "p234-s1", skill: "fix-bug" },
      { caseId: "p234-s3-c1", worktree: "p234-s3", skill: "test-development" },
    ]
  ) {
    const env = await TestEnvironment.create({ initGit: false });
    try {
      await Deno.mkdir(join(env.tempDir, item.worktree));
      const result = await preparePlanningWorkspace(env.tempDir, item.caseId);
      assertEquals(result.worktree, join(env.tempDir, item.worktree));
      const config = ConfigSchema.parse(parse(await Deno.readTextFile(result.configPath)));
      assertEquals(config.ai?.provider, item.caseId.startsWith("p234-s3") ? "codex-cli" : "claude-cli");
      assertEquals(config.ai?.model, item.caseId.startsWith("p234-s3") ? "gpt-6.1-terra" : "claude-sonnet-4-6");
      const root = join(result.worktree, ".copilot/skills");
      const selected = await createSkillLoaderFor([
        { path: root, kind: SkillRootKind.DOGFOOD, writable: false, project: null },
      ]).get(item.skill, testSkillContext());
      assertExists(selected);
      assertEquals(selected.rootKind, SkillRootKind.DOGFOOD);
      assertEquals(selected.sourcePath, item.skill);
    } finally {
      await env.cleanup();
    }
  }
});
