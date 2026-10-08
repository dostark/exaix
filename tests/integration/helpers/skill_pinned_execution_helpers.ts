/**
 * @module SkillPinnedExecutionHelpers
 * @path tests/integration/helpers/skill_pinned_execution_helpers.ts
 * @description Shared fixtures and provider/executor builders for the skill-pinned
 *   execution integration and security tests.
 * @architectural-layer Test
 * @related-files [tests/integration/skill_pinned_execution_e2e_test.ts, tests/integration/skill_pinned_execution_e2e_security_test.ts]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { EventLogger } from "@exaix/core/logger";
import { MockStrategy } from "@exaix/core";
import type { IApplicationContext, JSONObject } from "@exaix/core/types";
import { RequestProcessor } from "@exaix/request";
import { PlanExecutor } from "@exaix/core/planning";
import { AgentRunner } from "@exaix/execution";
import { SkillsService } from "@exaix/core/skills";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  makeGenerateResult,
  writeSkillFolder,
} from "@exaix/testing";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { TestEnvironment } from "./test_environment.ts";

export interface IPinnedPlanFixture {
  env: Awaited<ReturnType<typeof TestEnvironment.create>>;
  root: string;
  skills: SkillsService;
  skillsDir: string;
  applicationContext: IApplicationContext;
  frontmatter: JSONObject;
  usage: (traceId: string) => Promise<IUsageRow[]>;
  cleanup: () => Promise<void>;
}

const PLAN_RESPONSE = '<thought>ok</thought><content>{"subject":"Test","description":"A plan.",' +
  '"steps":[{"step":1,"title":"Step","description":"Do it."}]}</content>';
export const SKILL = "approved-skill";
export const OTHER = "other-skill";

interface IUsageRow {
  skill_name: string;
  match_source: string;
  submission_kind: string;
  revision_id: string;
  trace_id: string;
}

export async function planWithPinnedSkill(): Promise<IPinnedPlanFixture> {
  const env = await TestEnvironment.create({
    initGit: false,
    configOverrides: { request_analysis: { mode: "heuristic" } } as never,
  });
  const root = await Deno.makeTempDir({ prefix: "skill-pinned-exec-" });
  const skillsDir = join(root, "Skills");
  await writeSkillFolder(skillsDir, { name: SKILL, instructions: "Approved body A." });
  await writeSkillFolder(skillsDir, { name: OTHER, instructions: "Other body." });
  const skills = new SkillsService(
    { memoryDir: join(root, "Memory"), blueprintSkillsDir: skillsDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  await skills.initialize();
  await Deno.writeTextFile(
    join(env.tempDir, "Blueprints", "Agents", "default.md"),
    "---\nagent_role: default\nmodel: mock:test\n---\nYou are a helpful assistant.\n",
  );
  const provider = env.createMockProvider(MockStrategy.RECORDED, [{
    promptHash: ".*",
    promptPreview: "You are a helpful assistant.",
    response: PLAN_RESPONSE,
    model: "test",
    tokens: { input: 0, output: 0 },
    recordedAt: new Date().toISOString(),
  }]);
  const applicationContext = {
    config: createStubConfig(env.config),
    db: env.db,
    provider,
    git: createStubGit(),
    display: createStubDisplay(env.db),
    skills,
  } as never;
  const processor = new RequestProcessor({
    workspacePath: join(env.tempDir, "Workspace"),
    requestsDir: join(env.tempDir, "Workspace", "Requests"),
    blueprintsPath: join(env.tempDir, "Blueprints", "Agents"),
    includeReasoning: true,
    context: applicationContext,
    testProvider: provider,
    agentRunner: new AgentRunner(provider, { skillsService: skills, disableRetry: true }),
  });
  const traceId = crypto.randomUUID();
  const requestPath = join(env.tempDir, "Workspace", "Requests", `request-${traceId.slice(0, 8)}.md`);
  await Deno.writeTextFile(
    requestPath,
    `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: default
source: cli
created_by: "test@example.com"
subject: "Pinned execution"
skills: ["${SKILL}"]
---
# Request
Do the pinned thing.
`,
  );
  const planPath = await processor.process(requestPath);
  assert(planPath, "planning must produce a plan path");
  const planContent = await Deno.readTextFile(String(planPath));
  const frontmatter = parseYaml((planContent.match(/^---\n([\s\S]*?)\n---/) ?? [])[1] ?? "") as JSONObject;
  return {
    env,
    root,
    skills,
    skillsDir,
    applicationContext,
    frontmatter,
    usage: (traceId: string) =>
      env.db.preparedAll<IUsageRow>(
        "SELECT skill_name, match_source, submission_kind, revision_id, trace_id FROM skill_usage WHERE trace_id = ? ORDER BY id",
        [traceId],
      ),
    cleanup: async () => {
      await Deno.remove(root, { recursive: true }).catch(() => {});
      await env.cleanup();
    },
  };
}

export function capturingProvider(prompts: string[]): IModelProvider {
  return {
    id: "pinned-exec-capture",
    generate: (prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve(makeGenerateResult("STATUS: COMPLETE\nSUMMARY: done"));
    },
  };
}

export function executorFor(
  fx: Awaited<ReturnType<typeof planWithPinnedSkill>>,
  provider: IModelProvider,
): PlanExecutor {
  return new PlanExecutor(fx.env.config, provider, fx.env.db, fx.env.tempDir, new EventLogger({ db: fx.env.db }), {
    enableGit: false,
    generateReport: false,
    context: fx.applicationContext,
  });
}
