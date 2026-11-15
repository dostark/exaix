/**
 * @module SkillCommandsTest
 * @path apps/exactl/tests/commands/skill_commands_test.ts
 * @description Phase 206 Step 5 — `skill show` read usage
 *   totals from the journal DB: overall and per-revision counts plus the last use. Both
 *   registrations call the same handler, so one handler test covers both aliases.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [apps/exactl/src/commands/memory_commands.ts, packages/cli/src/formatters/memory_formatter.ts]
 */

import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import * as pathBuilders from "@exaix/shared";
import { assertEquals, assertFalse, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SkillStatus } from "@exaix/core";
import { policySkillSubmission, SkillsService } from "@exaix/core/skills";
import { SkillCommandError } from "../../src/commands/memory_commands.ts";
import { MemoryApprovalReader } from "../../src/commands/memory_approval_reader.ts";
import { testSkillContext, writeSkillFolder } from "@exaix/testing";
import { TestEnvironmentFactory } from "../../../../tests/fixtures/test_environment_factory.ts";

Deno.test("[skills show] prints total, per-revision and last-use counts read from the journal", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Usage Skill", { instructions: "Body one." });
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const [draft] = await service.listSkills({ status: SkillStatus.DRAFT });
    const ctx = testSkillContext();
    await service.recordSubmission(policySkillSubmission(draft), ctx);
    await service.recordSubmission(policySkillSubmission(draft), ctx);

    const { usage } = await commands.skillShow("usage-skill");
    assertEquals(usage.totalUses, 2);
    assertEquals(usage.revisions[0].revisionId, draft.id);
    assertEquals(usage.revisions[0].useCount, 2);
    assertEquals(typeof usage.lastUsedAt, "string");
  } finally {
    await cleanup();
  }
});

Deno.test("[skills show] an unused skill shows zero uses", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Idle Skill", { instructions: "Body." });
    const { usage } = await commands.skillShow("idle-skill");
    assertEquals(usage.totalUses, 0);
    assertEquals(usage.revisions, []);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills --portal] project skills show only for their portal and are global-only without one", async () => {
  const { commands, config, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const projectRoot = pathBuilders.memorySkillsPath(
      join(config.system.root, config.paths.memory),
      "project",
      "Alpha",
    );
    await writeSkillFolder(projectRoot, {
      name: "alpha-guide",
      instructions: "Alpha body.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    assertEquals(await skillIds(commands.skillList({ portal: "Alpha" })), ["alpha-guide"]);
    assertEquals(await skillIds(commands.skillList({ portal: "Beta" })), []);
    assertEquals(await skillIds(commands.skillList()), []);
    assertEquals((await commands.skillShow("alpha-guide", "Alpha")).skill.skill_id, "alpha-guide");
    const hidden = await assertRejects(() => commands.skillShow("alpha-guide"), SkillCommandError);
    assertEquals(hidden.code, ExaCtlExitCode.NOT_FOUND);
    assertStringIncludes(hidden.message, "Skill not found");

    const created = await commands.skillCreate("beta-note", { instructions: "Beta note.", portal: "Beta" });
    assertEquals(created.skill_id, "beta-note");
    assertEquals(await skillIds(commands.skillList({ portal: "Beta" })), ["beta-note"]);
    assertEquals(await skillIds(commands.skillList({ portal: "Alpha" })), ["alpha-guide"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[listDraftSkills] returns drafts only and a portal draft only for its portal", async () => {
  const { commands, context, config, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Global Draft", { instructions: "Global body." });
    await commands.skillCreate("beta-note", { instructions: "Beta note.", portal: "Beta" });
    await writeSkillFolder(
      pathBuilders.memorySkillsPath(join(config.system.root, config.paths.memory), "project", "Alpha"),
      { name: "alpha-guide", instructions: "Alpha body.", sidecar: { status: SkillStatus.ACTIVE } },
    );
    const reader = new MemoryApprovalReader(context);
    const withoutPortal = await reader.listDraftSkills(undefined);
    assertEquals(withoutPortal.map((skill) => skill.skill_id), ["global-draft"]);
    const forBeta = (await reader.listDraftSkills("Beta")).map((skill) => skill.skill_id).sort();
    assertEquals(forBeta, ["beta-note", "global-draft"]);
    const forAlpha = await reader.listDraftSkills("Alpha");
    assertFalse(forAlpha.some((skill) => skill.skill_id === "alpha-guide"), "an active skill is not a draft");
    for (const skill of [...withoutPortal, ...forAlpha]) assertEquals(skill.status, SkillStatus.DRAFT);
  } finally {
    await cleanup();
  }
});

async function skillIds(listing: Promise<{ skills: { skill_id: string }[] }>): Promise<string[]> {
  return (await listing).skills.map((skill) => skill.skill_id).sort();
}

async function draftOf(service: SkillsService, name: string) {
  return (await service.listSkills({ status: SkillStatus.DRAFT })).find((skill) => skill.name === name)!;
}

Deno.test("[skills approve] approval is bound to the reviewed revision and activates the draft", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const created = await commands.skillCreate("Review Me", { instructions: "Body one." });
    assertStringIncludes(`${created.root_kind}/${created.path}`, "learned/review-me");
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const reviewed = await draftOf(service, "review-me");
    assertEquals(created.id, reviewed.id);

    const stale = await assertRejects(
      () => commands.skillApprove("review-me", crypto.randomUUID()),
      SkillCommandError,
    );
    assertEquals(stale.code, ExaCtlExitCode.FAILURE);
    assertStringIncludes(stale.message, "skill_revision_mismatch");

    const approved = await commands.skillApprove("review-me", reviewed.id);
    assertEquals(approved.name, "review-me");
    assertEquals(approved.reviewedRevisionId, reviewed.id);
    assertEquals(approved.status, SkillStatus.ACTIVE);
    assertEquals((await service.getSkill("review-me"))?.status, SkillStatus.ACTIVE);

    const again = await assertRejects(() => commands.skillApprove("review-me", reviewed.id), SkillCommandError);
    assertEquals(again.code, ExaCtlExitCode.FAILURE);
    const unknown = await assertRejects(() => commands.skillApprove("no-such", reviewed.id), SkillCommandError);
    assertEquals(unknown.code, ExaCtlExitCode.FAILURE);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills deprecate] a deprecated skill leaves matching and needs a fresh review", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Retire Me", { instructions: "Body." });
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const reviewed = await draftOf(service, "retire-me");
    await commands.skillApprove("retire-me", reviewed.id);
    assertEquals((await commands.skillDeprecate("retire-me")).status, SkillStatus.DEPRECATED);
    assertEquals(await service.getSkill("retire-me"), null);
    const error = await assertRejects(() => commands.skillDeprecate("never-was"), SkillCommandError);
    assertEquals(error.code, ExaCtlExitCode.FAILURE);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills revisions/show/usage] history survives deleting the current folder and is trace-joinable", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Historic", { instructions: "Historic body." });
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const draft = await draftOf(service, "historic");
    await commands.skillApprove("historic", draft.id);
    const active = (await service.getSkill("historic"))!;
    const ctx = testSkillContext();
    await service.recordSubmission(policySkillSubmission(active), ctx);
    await service.recordSubmission(policySkillSubmission(active), ctx);
    await service.deleteSkill("historic", ctx);

    const revisions = await commands.skillRevisions("historic");
    assertEquals(revisions.length, 1);
    assertEquals(revisions[0].revisionId, active.id);
    assertEquals(revisions[0].useCount, 2);
    assertEquals(typeof revisions[0].contentSha256, "string");
    assertEquals(typeof revisions[0].firstSeenAt, "string");

    const shown = await commands.skillShowRevision("historic", active.id, undefined);
    assertEquals(shown.revisionId, active.id);
    assertStringIncludes(shown.skillMd, "Historic body.");
    assertEquals(shown.origin?.rootKind, "learned");
    assertEquals(shown.summary.useCount, 2);
    assertFalse(JSON.stringify(shown).includes(config.system.root), "no host paths in the output");

    const trace = await commands.skillUsageByTrace(ctx.traceId);
    assertEquals(trace.length, 2);
    assertEquals(trace[0].skillName, "historic");
    assertEquals(trace[0].revisionId, active.id);
    assertEquals(trace[0].contentSha256, revisions[0].contentSha256);
    assertFalse(JSON.stringify(trace).includes("Historic body."), "trace rows carry no skill bodies");

    const wrongName = await assertRejects(
      () => commands.skillShowRevision("other-name", active.id, undefined),
      SkillCommandError,
    );
    assertEquals(wrongName.code, ExaCtlExitCode.NOT_FOUND);
    const unknownRevision = await assertRejects(
      () => commands.skillShowRevision("historic", crypto.randomUUID(), undefined),
      SkillCommandError,
    );
    assertEquals(unknownRevision.code, ExaCtlExitCode.NOT_FOUND);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills validate/list --all] diagnostics are typed and mutate nothing", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const learned = pathBuilders.memorySkillsPath(join(config.system.root, config.paths.memory), "learned");
    await writeSkillFolder(learned, {
      name: "fine-skill",
      instructions: "Fine.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    const clean = await commands.skillValidate();
    assertEquals(clean.valid, true);

    await Deno.mkdir(join(learned, "broken-skill"), { recursive: true });
    await Deno.writeTextFile(join(learned, "broken-skill", "SKILL.md"), "no frontmatter at all");
    const before = await db.preparedAll("SELECT revision_id FROM skill_revisions");
    const report = await commands.skillValidate();
    assertEquals(report.valid, false);
    assertEquals(report.diagnostics.some((d) => d.name === "broken-skill"), true);
    assertFalse(JSON.stringify(report).includes("no frontmatter"), "no raw file content");
    assertEquals(await db.preparedAll("SELECT revision_id FROM skill_revisions"), before, "validate writes nothing");

    const named = await commands.skillValidate("fine-skill");
    assertEquals(named.valid, true);

    const listed = await commands.skillList({ all: true });
    assertEquals(listed.skills.map((s) => s.name), ["fine-skill"]);
    assertEquals((listed.diagnostics ?? []).length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills] older commands fail with exit codes instead of returning error text", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const missingIds = await assertRejects(() => commands.skillDerive({ name: "x" }), SkillCommandError);
    assertEquals(missingIds.code, ExaCtlExitCode.USAGE);
    assertStringIncludes(missingIds.message, "learning IDs are required");
    const missingName = await assertRejects(
      () => commands.skillDerive({ learningIds: ["a"] }),
      SkillCommandError,
    );
    assertEquals(missingName.code, ExaCtlExitCode.USAGE);
    const invalidName = await assertRejects(() => commands.skillCreate("!!!"), SkillCommandError);
    assertEquals(invalidName.code, ExaCtlExitCode.FAILURE);
    const unknownShow = await assertRejects(() => commands.skillShow("no-such-skill"), SkillCommandError);
    assertEquals(unknownShow.code, ExaCtlExitCode.NOT_FOUND);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a hostile draft stays exact in the revision data", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  const hostile = "Body \x1b]0;pwned\x07 and \x1b[2J end";
  try {
    const learned = pathBuilders.memorySkillsPath(join(config.system.root, config.paths.memory), "learned");
    await writeSkillFolder(learned, { name: "hostile-draft", instructions: hostile });
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const draft = await draftOf(service, "hostile-draft");
    await service.ensureRevisions([draft.id], testSkillContext());

    const revision = await commands.skillShowRevision("hostile-draft", draft.id, undefined);
    assertStringIncludes(revision.skillMd, hostile);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a project skill's stored revision is refused to another portal and to global scope", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const memoryDir = join(config.system.root, config.paths.memory);
    await writeSkillFolder(pathBuilders.memorySkillsPath(memoryDir, "project", "Alpha"), {
      name: "alpha-guide",
      instructions: "Alpha only guidance.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    const service = new SkillsService({ memoryDir }, db);
    const alpha = { ...testSkillContext(), portal: "Alpha" };
    const skill = (await service.getSkill("alpha-guide", alpha))!;
    await service.recordSubmission(policySkillSubmission(skill), alpha);

    const own = await commands.skillShowRevision("alpha-guide", skill.id, "Alpha");
    assertStringIncludes(own.skillMd, "Alpha only guidance.");
    for (const portal of ["Beta", undefined]) {
      const refused = await assertRejects(
        () => commands.skillShowRevision("alpha-guide", skill.id, portal),
        SkillCommandError,
      );
      assertEquals(refused.code, ExaCtlExitCode.NOT_FOUND);
      assertFalse(refused.message.includes("Alpha only guidance."));
      assertEquals(await commands.skillRevisions("alpha-guide", { portal }), []);
    }
  } finally {
    await cleanup();
  }
});
