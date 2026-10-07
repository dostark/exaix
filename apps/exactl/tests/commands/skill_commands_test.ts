/**
 * @module SkillCommandsTest
 * @path apps/exactl/tests/commands/skill_commands_test.ts
 * @description Phase 206 Step 5 — `skills show` and the nested `memory skill show` read usage
 *   totals from the journal DB: overall and per-revision counts plus the last use. Both
 *   registrations call the same handler, so one handler test covers both aliases.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [apps/exactl/src/commands/memory_commands.ts, packages/cli/src/formatters/memory_formatter.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { UIOutputFormat } from "@exaix/tui";
import { SkillStatus } from "@exaix/core";
import { policySkillSubmission, SkillsService } from "@exaix/core/skills";
import { SkillCommandError } from "../../src/commands/memory_commands.ts";
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

    const table = await commands.skillShow("usage-skill");
    assertStringIncludes(table, "Total uses: 2");
    assertStringIncludes(table, `Revision ${draft.id.slice(0, 8)}: 2 use(s)`);
    assertStringIncludes(table, "Last used:");

    const markdown = await commands.skillShow("usage-skill", UIOutputFormat.MARKDOWN);
    assertStringIncludes(markdown, "Total uses: 2");

    const json = JSON.parse(await commands.skillShow("usage-skill", UIOutputFormat.JSON));
    assertEquals(json.usage.totalUses, 2);
    assertEquals(json.usage.revisions[0].useCount, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills show] an unused skill shows zero uses", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Idle Skill", { instructions: "Body." });
    const output = await commands.skillShow("idle-skill");
    assertStringIncludes(output, "Total uses: 0");
    assertEquals(JSON.parse(await commands.skillShow("idle-skill", UIOutputFormat.JSON)).usage.revisions, []);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills --portal] project skills show only for their portal and are global-only without one", async () => {
  const { commands, config, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const projectRoot = join(config.system.root, config.paths.memory, "Skills", "project", "Alpha");
    await writeSkillFolder(projectRoot, {
      name: "alpha-guide",
      instructions: "Alpha body.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    assertStringIncludes(await commands.skillList({ portal: "Alpha" }), "alpha-guide");
    assertEquals((await commands.skillList({ portal: "Beta" })).includes("alpha-guide"), false);
    assertEquals((await commands.skillList()).includes("alpha-guide"), false);
    assertStringIncludes(await commands.skillShow("alpha-guide", UIOutputFormat.TABLE, "Alpha"), "alpha-guide");
    const hidden = await assertRejects(() => commands.skillShow("alpha-guide"), SkillCommandError);
    assertEquals(hidden.exitCode, 1);
    assertStringIncludes(hidden.message, "Skill not found");

    const created = await commands.skillCreate("beta-note", { instructions: "Beta note.", portal: "Beta" });
    assertStringIncludes(created, "beta-note");
    assertStringIncludes(await commands.skillList({ portal: "Beta" }), "beta-note");
    assertEquals((await commands.skillList({ portal: "Alpha" })).includes("beta-note"), false);
  } finally {
    await cleanup();
  }
});

async function draftOf(service: SkillsService, name: string) {
  return (await service.listSkills({ status: SkillStatus.DRAFT })).find((skill) => skill.name === name)!;
}

Deno.test("[skills approve] approval is bound to the reviewed revision and activates the draft", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const created = await commands.skillCreate("Review Me", { instructions: "Body one." });
    assertStringIncludes(created, "Revision:");
    assertStringIncludes(created, "Draft path: learned/review-me");
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const reviewed = await draftOf(service, "review-me");
    assertStringIncludes(created, reviewed.id);

    const stale = await assertRejects(
      () => commands.skillApprove("review-me", crypto.randomUUID()),
      SkillCommandError,
    );
    assertEquals(stale.exitCode, 1);
    assertStringIncludes(stale.message, "skill_revision_mismatch");

    const approved = await commands.skillApprove("review-me", reviewed.id);
    assertStringIncludes(approved, "review-me");
    assertStringIncludes(approved, reviewed.id);
    assertEquals((await service.getSkill("review-me"))?.status, SkillStatus.ACTIVE);

    const again = await assertRejects(() => commands.skillApprove("review-me", reviewed.id), SkillCommandError);
    assertEquals(again.exitCode, 1);
    const unknown = await assertRejects(() => commands.skillApprove("no-such", reviewed.id), SkillCommandError);
    assertEquals(unknown.exitCode, 1);
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
    assertStringIncludes(await commands.skillDeprecate("retire-me"), "deprecated");
    assertEquals(await service.getSkill("retire-me"), null);
    const error = await assertRejects(() => commands.skillDeprecate("never-was"), SkillCommandError);
    assertEquals(error.exitCode, 1);
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

    const revisions = JSON.parse(await commands.skillRevisions("historic", { format: UIOutputFormat.JSON }));
    assertEquals(revisions.length, 1);
    assertEquals(revisions[0].revisionId, active.id);
    assertEquals(revisions[0].useCount, 2);
    assertEquals(typeof revisions[0].contentSha256, "string");
    assertEquals(typeof revisions[0].firstSeenAt, "string");
    assertStringIncludes(await commands.skillRevisions("historic"), active.id);

    const shown = JSON.parse(await commands.skillShow("historic", UIOutputFormat.JSON, undefined, active.id));
    assertEquals(shown.revisionId, active.id);
    assertStringIncludes(shown.skillMd, "Historic body.");
    assertEquals(shown.origin.rootKind, "learned");
    assertEquals(shown.summary.useCount, 2);
    assertEquals(JSON.stringify(shown).includes(config.system.root), false, "no host paths in the output");

    const trace = JSON.parse(await commands.skillUsageByTrace(ctx.traceId, { format: UIOutputFormat.JSON }));
    assertEquals(trace.length, 2);
    assertEquals(trace[0].skillName, "historic");
    assertEquals(trace[0].revisionId, active.id);
    assertEquals(trace[0].contentSha256, revisions[0].contentSha256);
    assertEquals(JSON.stringify(trace).includes("Historic body."), false, "trace rows carry no skill bodies");

    const wrongName = await assertRejects(
      () => commands.skillShow("other-name", UIOutputFormat.JSON, undefined, active.id),
      SkillCommandError,
    );
    assertEquals(wrongName.exitCode, 1);
    const unknownRevision = await assertRejects(
      () => commands.skillShow("historic", UIOutputFormat.JSON, undefined, crypto.randomUUID()),
      SkillCommandError,
    );
    assertEquals(unknownRevision.exitCode, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills validate/list --all] diagnostics are typed, mutate nothing and fail the exit code on errors", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const learned = join(config.system.root, config.paths.memory, "Skills", "learned");
    await writeSkillFolder(learned, {
      name: "fine-skill",
      instructions: "Fine.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    const clean = JSON.parse(await commands.skillValidate(undefined, { format: UIOutputFormat.JSON }));
    assertEquals(clean.valid, true);

    await Deno.mkdir(join(learned, "broken-skill"), { recursive: true });
    await Deno.writeTextFile(join(learned, "broken-skill", "SKILL.md"), "no frontmatter at all");
    const before = await db.preparedAll("SELECT revision_id FROM skill_revisions");
    const error = await assertRejects(
      () => commands.skillValidate(undefined, { format: UIOutputFormat.JSON }),
      SkillCommandError,
    );
    assertEquals(error.exitCode, 1);
    const report = JSON.parse(error.output!);
    assertEquals(report.valid, false);
    assertEquals(report.diagnostics.some((d: { name: string; reason: string }) => d.name === "broken-skill"), true);
    assertEquals(JSON.stringify(report).includes("no frontmatter"), false, "no raw file content");
    assertEquals(await db.preparedAll("SELECT revision_id FROM skill_revisions"), before, "validate writes nothing");

    const named = JSON.parse(await commands.skillValidate("fine-skill", { format: UIOutputFormat.JSON }));
    assertEquals(named.valid, true);

    const listed = JSON.parse(await commands.skillList({ all: true, format: UIOutputFormat.JSON }));
    assertEquals(listed.skills.map((s: { name: string }) => s.name), ["fine-skill"]);
    assertEquals(listed.diagnostics.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills] older commands fail with exit codes instead of returning error text", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const missingIds = await assertRejects(() => commands.skillDerive({ name: "x" }), SkillCommandError);
    assertEquals(missingIds.exitCode, 2);
    assertStringIncludes(missingIds.message, "learning IDs are required");
    const missingName = await assertRejects(
      () => commands.skillDerive({ learningIds: ["a"] }),
      SkillCommandError,
    );
    assertEquals(missingName.exitCode, 2);
    const invalidName = await assertRejects(() => commands.skillCreate("!!!"), SkillCommandError);
    assertEquals(invalidName.exitCode, 1);
    const unknownShow = await assertRejects(() => commands.skillShow("no-such-skill"), SkillCommandError);
    assertEquals(unknownShow.exitCode, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a hostile draft prints no control byte in table or markdown output and stays exact in JSON", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  const hostile = "Body \x1b]0;pwned\x07 and \x1b[2J end";
  // deno-lint-ignore no-control-regex
  const controlByte = /[\x00-\x08\x0B-\x1F\x7F]/;
  try {
    const learned = join(config.system.root, config.paths.memory, "Skills", "learned");
    await writeSkillFolder(learned, { name: "hostile-draft", instructions: hostile });
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const draft = await draftOf(service, "hostile-draft");
    await service.ensureRevisions([draft.id], testSkillContext());

    for (const format of [UIOutputFormat.TABLE, UIOutputFormat.MARKDOWN]) {
      for (
        const output of [
          await commands.skillShow("hostile-draft", format),
          await commands.skillShow("hostile-draft", format, undefined, draft.id),
          await commands.skillList({ format }),
        ]
      ) {
        assertEquals(controlByte.test(output), false, JSON.stringify(output));
      }
    }
    const json = JSON.parse(await commands.skillShow("hostile-draft", UIOutputFormat.JSON, undefined, draft.id));
    assertStringIncludes(json.skillMd, hostile);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a project skill's stored revision is refused to another portal and to global scope", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const memoryDir = join(config.system.root, config.paths.memory);
    await writeSkillFolder(join(memoryDir, "Skills", "project", "Alpha"), {
      name: "alpha-guide",
      instructions: "Alpha only guidance.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    const service = new SkillsService({ memoryDir }, db);
    const alpha = { ...testSkillContext(), portal: "Alpha" };
    const skill = (await service.getSkill("alpha-guide", alpha))!;
    await service.recordSubmission(policySkillSubmission(skill), alpha);

    const own = JSON.parse(await commands.skillShow("alpha-guide", UIOutputFormat.JSON, "Alpha", skill.id));
    assertStringIncludes(own.skillMd, "Alpha only guidance.");
    for (const portal of ["Beta", undefined]) {
      const refused = await assertRejects(
        () => commands.skillShow("alpha-guide", UIOutputFormat.JSON, portal, skill.id),
        SkillCommandError,
      );
      assertEquals(refused.exitCode, 1);
      assertEquals(refused.message.includes("Alpha only guidance."), false);
      assertEquals(
        JSON.parse(await commands.skillRevisions("alpha-guide", { format: UIOutputFormat.JSON, portal })),
        [],
      );
    }
  } finally {
    await cleanup();
  }
});
