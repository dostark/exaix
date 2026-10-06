/**
 * @module AgentRunnerSkillRevisionsTest
 * @path packages/execution/tests/agent_runner_skill_revisions_test.ts
 * @description Phase 206 Step 4 — AgentRunner durably snapshots the canonical revision of every
 *   injected skill before the provider call, scopes resolution to the request's portal, keeps
 *   preview read-only, and fails closed with zero provider calls when the snapshot cannot be
 *   written. A real SkillsService, journal DB and capturing provider drive each case.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/skills/skills.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { SkillAuditUnavailableError, SkillsService } from "@exaix/core/skills";
import { SkillStatus } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";
const SKILL_NAME = "audited-skill";

function capturingProvider(): { provider: IModelProvider; calls: () => number } {
  let count = 0;
  const provider: IModelProvider = {
    id: "capturing-mock",
    generate(): Promise<IGenerateResult> {
      count += 1;
      return Promise.resolve({
        content: WELL_FORMED_RESPONSE,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, calls: () => count };
}

interface IFixture {
  runner: AgentRunner;
  skillsDir: string;
  memoryDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  providerCalls: () => number;
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<IFixture> {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-runner-revisions-" });
  const memoryDir = join(base, "Memory");
  const skillsDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(skillsDir, { name: SKILL_NAME, instructions: "First body." });
  const skillsService = new SkillsService(
    { memoryDir, blueprintSkillsDir: skillsDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  await skillsService.initialize();
  const { provider, calls } = capturingProvider();
  const runner = new AgentRunner(provider, { skillsService, disableSkills: false, disableRetry: true });
  return {
    runner,
    skillsDir,
    memoryDir,
    db: env.db,
    providerCalls: calls,
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

const BLUEPRINT: IBlueprint = { systemPrompt: "You are a test agent.", agentRole: "tester" };

function request(overrides: Partial<IParsedRequest> = {}): IParsedRequest {
  return { userPrompt: "Do the thing.", context: {}, skills: [SKILL_NAME], traceId: "trace-runner", ...overrides };
}

async function revisionRows(fx: IFixture): Promise<Array<{ revision_id: string; skill_md: string }>> {
  return await fx.db.preparedAll("SELECT revision_id, skill_md FROM skill_revisions ORDER BY first_seen_at, rowid");
}

Deno.test("[runner] run snapshots the canonical revision of an injected skill before the provider call", async () => {
  const fx = await fixture();
  try {
    await fx.runner.run(BLUEPRINT, request(), undefined);
    const rows = await revisionRows(fx);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].skill_md.includes("First body."), true);
    assertEquals(fx.providerCalls(), 1);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[runner] an edit changes the revision on the next run and both snapshots stay", async () => {
  const fx = await fixture();
  try {
    await fx.runner.run(BLUEPRINT, request(), undefined);
    await writeSkillFolder(fx.skillsDir, { name: SKILL_NAME, instructions: "Second body." });
    await fx.runner.run(BLUEPRINT, request(), undefined);
    const rows = await revisionRows(fx);
    assertEquals(rows.length, 2);
    assertEquals(rows[0].revision_id === rows[1].revision_id, false);
    assertEquals(rows[1].skill_md.includes("Second body."), true);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[runner] previewPrompt is read-only and writes no revision", async () => {
  const fx = await fixture();
  try {
    const preview = await fx.runner.previewPrompt(BLUEPRINT, request());
    assertEquals(preview.segments.length > 0, true);
    assertEquals((await revisionRows(fx)).length, 0);
    assertEquals(fx.providerCalls(), 0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[runner] a failed snapshot write fails the run with zero provider calls", async () => {
  const fx = await fixture();
  try {
    await fx.db.preparedRun("DROP TABLE skill_revisions");
    const error = await assertRejects(() => fx.runner.run(BLUEPRINT, request(), undefined), SkillAuditUnavailableError);
    assertEquals(error.code, "skill_audit_unavailable");
    assertEquals(fx.providerCalls(), 0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[runner] a request without skills records nothing and still runs", async () => {
  const fx = await fixture();
  try {
    await fx.runner.run(BLUEPRINT, request({ skills: [] }), undefined);
    assertEquals((await revisionRows(fx)).length, 0);
    assertEquals(fx.providerCalls(), 1);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[runner] resolution is scoped to the request portal, so another portal's project skill is not injected", async () => {
  const fx = await fixture();
  try {
    await writeSkillFolder(join(fx.memoryDir, "Skills", "project", "Alpha"), {
      name: "alpha-only",
      instructions: "Alpha body.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    await fx.runner.run(BLUEPRINT, request({ skills: ["alpha-only"], portal: "Alpha" }), undefined);
    assertEquals((await revisionRows(fx)).map((r) => r.skill_md.includes("Alpha body.")), [true]);

    await fx.runner.run(BLUEPRINT, request({ skills: ["alpha-only"], portal: "Beta" }), undefined);
    await fx.runner.run(BLUEPRINT, request({ skills: ["alpha-only"], portal: "../escape" }), undefined);
    assertEquals((await revisionRows(fx)).length, 1, "neither Beta nor an invalid portal resolves Alpha's skill");
  } finally {
    await fx.cleanup();
  }
});
