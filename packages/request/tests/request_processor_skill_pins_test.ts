/**
 * @module RequestProcessorSkillPinsTest
 * @path packages/request/tests/request_processor_skill_pins_test.ts
 * @description Verifies that the plan carries the pin vector of the final successful planning
 *   run. A validation retry replaces earlier pins with the retry's vector. A final empty vector
 *   clears them and a final absent vector leaves no stale pins behind.
 * @architectural-layer Services
 * @dependencies [@std/assert, @std/yaml, @exaix/request, @exaix/execution, @exaix/testing]
 * @related-files [packages/request/src/processor.ts, packages/core/src/planning/plan_writer.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { type IRequestProcessorConfig, RequestProcessor } from "@exaix/request";
import type { IAgentExecutionResult, IAgentRunner } from "@exaix/execution";
import { EventLogger } from "@exaix/core/logger";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind } from "@exaix/core";
import type { ISkillPin } from "@exaix/core/skills";
import { CostTracker } from "@exaix/core/cost";
import type { IApplicationContext, JSONObject } from "@exaix/core/types";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getBlueprintsAgentsDir,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";

const VALID_PLAN = JSON.stringify({
  description: "Plan",
  steps: [{ step: 1, title: "Step", description: "Do it" }],
});

function pin(name: string, revisionId: string): ISkillPin {
  return {
    name,
    revision_id: revisionId,
    content_sha256: "c".repeat(64),
    root_kind: SkillRootKind.BLUEPRINT,
    source_path: name,
    portal: null,
    match_source: SkillMatchSource.MATCHED,
    confidence: 0.6,
    matched_task_types: [],
    required: false,
    render_mode: SkillRenderOutcome.FULL,
    content_included: true,
  };
}

const FIRST = pin("first-skill", "0f3e1c6a-2f3b-5c1a-9a77-0d6a1f9d4e21");
const SECOND = pin("second-skill", "1f3e1c6a-2f3b-5c1a-9a77-0d6a1f9d4e21");

/** Returns the scripted results in order. The first result is an invalid plan, so the processor retries. */
class ScriptedRunner implements IAgentRunner {
  calls = 0;
  constructor(private readonly results: IAgentExecutionResult[]) {}
  run(): Promise<IAgentExecutionResult> {
    const result = this.results[Math.min(this.calls, this.results.length - 1)];
    this.calls += 1;
    return Promise.resolve(result);
  }
}

function result(content: string, resolvedSkills: ISkillPin[] | undefined): IAgentExecutionResult {
  return {
    thought: "t",
    content: `<content>${content}</content>`,
    raw: content,
    skillsApplied: resolvedSkills?.map((entry) => entry.name),
    resolvedSkills,
  };
}

async function planFrontmatterAfter(runner: ScriptedRunner): Promise<JSONObject> {
  const { db, config, cleanup, tempDir } = await initTestDbService();
  try {
    await Deno.mkdir(getWorkspaceRequestsDir(tempDir), { recursive: true });
    await Deno.mkdir(join(tempDir, "Workspace", "Plans"), { recursive: true });
    await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "Blueprints", "Agents", "default.md"),
      "---\nagent_role: default\n---\n\nYou are a helpful assistant.\n",
    );
    const traceId = crypto.randomUUID();
    const requestPath = join(getWorkspaceRequestsDir(tempDir), `request-${traceId.slice(0, 8)}.md`);
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
subject: "Pins"
---

Add a hello world function.
`,
    );
    const provider = createStubProvider("unused");
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };
    const processor = new RequestProcessor(
      {
        workspacePath: getWorkspaceDir(tempDir),
        requestsDir: getWorkspaceRequestsDir(tempDir),
        blueprintsPath: getBlueprintsAgentsDir(tempDir),
        includeReasoning: true,
        context,
        testProvider: provider,
        costTracker: new CostTracker(db, config),
        logger: new EventLogger({ db }),
        agentRunner: runner,
      } satisfies IRequestProcessorConfig,
    );
    await processor.process(requestPath);
    await db.waitForFlush();
    const plansDir = join(tempDir, "Workspace", "Plans");
    const files: string[] = [];
    for await (const entry of Deno.readDir(plansDir)) if (entry.name.endsWith(".md")) files.push(entry.name);
    assert(files.length === 1, `expected exactly one plan, found ${files.length}`);
    const text = await Deno.readTextFile(join(plansDir, files[0]));
    return parseYaml(text.split("---")[1]) as JSONObject;
  } finally {
    await cleanup();
  }
}

Deno.test("[processor retry] the final successful vector replaces the pins of a failed attempt", async () => {
  const runner = new ScriptedRunner([result("not a plan", [FIRST]), result(VALID_PLAN, [SECOND])]);
  const frontmatter = await planFrontmatterAfter(runner);
  assertEquals(runner.calls, 2, "the invalid first plan must trigger a retry");
  assertEquals(frontmatter.resolved_skills, [SECOND]);
  assert(!("resolved_skill_ids" in frontmatter));
});

Deno.test("[processor retry] a final empty vector clears the pins of an earlier attempt", async () => {
  const runner = new ScriptedRunner([result("not a plan", [FIRST]), result(VALID_PLAN, [])]);
  const frontmatter = await planFrontmatterAfter(runner);
  assertEquals(frontmatter.resolved_skills, []);
});

Deno.test("[processor retry] a final absent vector leaves no stale pins", async () => {
  const runner = new ScriptedRunner([result("not a plan", [FIRST]), result(VALID_PLAN, undefined)]);
  const frontmatter = await planFrontmatterAfter(runner);
  assert(!("resolved_skills" in frontmatter));
});

Deno.test("[processor] a first-attempt vector reaches the writer unchanged", async () => {
  const frontmatter = await planFrontmatterAfter(new ScriptedRunner([result(VALID_PLAN, [FIRST, SECOND])]));
  assertEquals(frontmatter.resolved_skills, [FIRST, SECOND]);
});
