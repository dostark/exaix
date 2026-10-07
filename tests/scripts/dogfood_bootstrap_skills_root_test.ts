/**
 * @module DogfoodBootstrapSkillsRootTest
 * @path tests/scripts/dogfood_bootstrap_skills_root_test.ts
 * @description The dogfood bootstrap names the external worktree `.copilot/skills` folder as a dogfood skills
 *   root in the generated config and writes no skill JSON. A real `SkillsService` over that config resolves
 *   all 28 folders, and a skills folder that escapes the worktree through a symlink is refused.
 * @architectural-layer Test
 * @related-files [scripts/dogfood_bootstrap.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { ConfigService } from "@exaix/core/config";
import { SkillsService } from "@exaix/core/skills";
import { SkillRootKind } from "@exaix/core";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";
import { admitDogfoodSkillRoot } from "../../scripts/dogfood_bootstrap.ts";

const DOGFOOD_SKILL_COUNT = 28;

async function git(cwd: string, ...args: string[]): Promise<void> {
  const output = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "piped" }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
}

Deno.test({
  name:
    "[dogfood bootstrap] the generated config names the worktree skills root and a real service resolves all 28 folders",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const repoDir = await Deno.makeTempDir({ prefix: "dogfood-skills-root-" });
    const env = await initTestDbService();
    try {
      await setupGitRepo(repoDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });
      await copy(join(REPO_ROOT, ".copilot", "skills"), join(repoDir, ".copilot", "skills"));
      await copy(join(REPO_ROOT, "configs"), join(repoDir, "configs"));
      await copy(
        join(REPO_ROOT, "Memory", "Skills", "project", "Exaix"),
        join(repoDir, "Memory", "Skills", "project", "Exaix"),
      );
      await git(repoDir, "add", "-A");
      await git(repoDir, "commit", "-m", "skills");

      const sandboxRoot = join(repoDir, "sandbox");
      const worktreePath = join(repoDir, "linked-worktree");
      const output = await new Deno.Command("deno", {
        args: [
          "run",
          "-A",
          join(REPO_ROOT, "scripts", "dogfood_bootstrap.ts"),
          "--dir",
          sandboxRoot,
          "--worktree",
          worktreePath,
        ],
        cwd: REPO_ROOT,
        env: {
          DOGFOOD_BOOTSTRAP_SKIP_PORTAL: "1",
          TEST_GIT_REPO: repoDir,
          OVERRIDE_CONFIG_PATH: join(repoDir, "configs", "dogfood.toml"),
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(output.success, new TextDecoder().decode(output.stderr));
      assertEquals(new TextDecoder().decode(output.stdout).includes("Generating skill JSON"), false);

      const workspace = join(sandboxRoot, "workspace");
      const configText = await Deno.readTextFile(join(workspace, "exa.config.toml"));
      assertStringIncludes(configText, join(worktreePath, ".copilot", "skills"));
      const jsonSkills = [...Deno.readDirSync(join(workspace, "Memory")).filter((entry) => entry.name === "Skills")];
      for (const entry of jsonSkills) {
        assertEquals(
          await Array.fromAsync(Deno.readDir(join(workspace, "Memory", entry.name, "global"))).catch(() => []),
          [],
        );
      }

      const config = new ConfigService(join(workspace, "exa.config.toml"));
      assertEquals(config.get().skills.roots?.map((root) => root.kind), [
        SkillRootKind.PROJECT,
        SkillRootKind.DOGFOOD,
        SkillRootKind.LEARNED,
        SkillRootKind.BLUEPRINT,
      ]);
      const service = new SkillsService({ configProvider: config }, env.db);
      await service.initialize();
      const ctx = {
        portal: null,
        traceId: crypto.randomUUID(),
        requestId: null,
        flowId: null,
        flowStepId: null,
        agentRole: "test",
        configGeneration: service.currentConfigGeneration(),
      };
      const listed = (await service.listSkills(undefined, ctx)).filter((skill) =>
        skill.root_kind === SkillRootKind.DOGFOOD
      );
      assertEquals(listed.length, DOGFOOD_SKILL_COUNT);
      assertEquals((await service.getSkill("tdd-methodology", ctx))?.name, "tdd-workflow");
    } finally {
      await env.cleanup();
      await Deno.remove(repoDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test("[dogfood bootstrap] a skills folder that resolves outside the worktree is refused and a missing one is empty", async () => {
  const base = await Deno.makeTempDir({ prefix: "dogfood-admission-" });
  try {
    const worktree = join(base, "worktree");
    const outside = join(base, "outside");
    await Deno.mkdir(join(worktree, ".copilot"), { recursive: true });
    await Deno.mkdir(outside, { recursive: true });
    assertEquals(await admitDogfoodSkillRoot(worktree), { admitted: true, present: false });
    await Deno.symlink(outside, join(worktree, ".copilot", "skills"));
    const refused = await admitDogfoodSkillRoot(worktree);
    assertEquals(refused.admitted, false);
    await Deno.remove(join(worktree, ".copilot", "skills"));
    await Deno.mkdir(join(worktree, ".copilot", "skills"));
    assertEquals(await admitDogfoodSkillRoot(worktree), { admitted: true, present: true });
  } finally {
    await Deno.remove(base, { recursive: true }).catch(() => {});
  }
});
