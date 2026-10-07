/**
 * @module StrategySkillPinTransportTest
 * @path packages/execution/tests/strategy_skill_pin_transport_test.ts
 * @description Verifies that pinned skills reach each recorded execution transport exactly as
 *   approved. The pinned snapshot, not the live file, is rendered into the ReAct prompt (text and
 *   native conversation) and into the CLI delegate objective on initial and resumed turns. Each
 *   provider call and each CLI launch records one `plan_pinned` row per included skill before it
 *   dispatches. A swapped pin, an excluded skill or a failed audit write dispatches nothing.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/execution/src/skill_pin_transport.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import {
  CliDelegateStrategy,
  createPinnedSkillPrompt,
  type IAgentFileBlueprint,
  type IRunCliDelegateProcess,
  ReActLoopStrategy,
} from "@exaix/execution";
import {
  ExecutionStrategyName,
  PricingTier,
  ProviderCostTier,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  SecurityMode,
  SkillMatchSource,
  SkillRenderOutcome,
} from "@exaix/core";
import {
  buildSkillPin,
  createSkillOperationContext,
  type ISkillPin,
  SkillAuditUnavailableError,
  SkillsService,
  SkillUnavailableError,
} from "@exaix/core/skills";
import { EventLogger } from "@exaix/core/logger";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { initTestDbService, makeGenerateResult, writeSkillFolder } from "@exaix/testing";

const SKILL = "pinned-skill";
const TRACE = "11111111-1111-4111-8111-111111111111";

async function fixture() {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-pin-transport-" });
  const skillsDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(skillsDir, { name: SKILL, instructions: "Approved body A." });
  await writeSkillFolder(skillsDir, { name: "other-skill", instructions: "Other body." });
  const skills = new SkillsService(
    { memoryDir: join(base, "Memory"), blueprintSkillsDir: skillsDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  const operation = createSkillOperationContext({
    agentRole: "tester",
    traceId: TRACE,
    requestId: "req-pin",
    portal: null,
  });
  async function pin(name: string, overrides: Partial<ISkillPin> = {}): Promise<ISkillPin> {
    const skill = await skills.getSkill(name, operation);
    await skills.ensureRevisions([skill!.id], operation);
    return {
      ...buildSkillPin(
        {
          skillId: skill!.skill_id,
          revisionId: skill!.id,
          contentSha256: skill!.content_sha256,
          rootKind: skill!.root_kind,
          sourcePath: skill!.path,
          source: SkillMatchSource.MATCHED,
          confidence: 0.7,
          matchedTriggers: {},
          critical: false,
        },
        { portal: null, renderMode: SkillRenderOutcome.FULL, contentIncluded: true },
      ),
      ...overrides,
    };
  }
  return {
    skills,
    operation,
    db: env.db,
    skillsDir,
    pin,
    rows: () =>
      env.db.preparedAll<{
        call_id: string;
        skill_name: string;
        match_source: string;
        submission_kind: string;
        round: number;
        revision_id: string;
        trace_id: string;
      }>(
        "SELECT call_id, skill_name, match_source, submission_kind, round, revision_id, trace_id FROM skill_usage ORDER BY id",
      ),
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

const BLUEPRINT: IAgentFileBlueprint = {
  name: "tester",
  model: "",
  provider: "",
  capabilities: [ExecutionStrategyName.REACT, ExecutionStrategyName.CLI_DELEGATE],
  systemPrompt: "You are a test agent.",
};

const CONTEXT: IExecutionContext = {
  trace_id: TRACE,
  request_id: "req-pin",
  request: "Do the thing",
  plan: "Step 1: do it",
  portal: "main",
};

const OPTIONS: IAgentExecutionOptions = {
  agent_role: "tester",
  portal: "main",
  security_mode: SecurityMode.SANDBOXED,
  timeout_ms: 300000,
  max_tool_calls: 100,
  audit_enabled: true,
};

const BASE_EXECUTOR = {
  logAgentOutput: () => Promise.resolve(),
  validateReviewResult: (result: never) => result,
  parseAgentResponse: (_response: string, context: IExecutionContext, startTime: number) => ({
    branch: "feat/test",
    commit_sha: "0".repeat(40),
    files_changed: [],
    description: context.plan,
    tool_calls: 0,
    execution_time_ms: Date.now() - startTime,
  }),
  logGeneration: () => Promise.resolve(),
  toolRegistry: { execute: () => Promise.resolve({ success: true }), getTools: () => [], getBaseDir: () => "/x" },
};
const EXECUTOR = BASE_EXECUTOR as never;

function completingProvider(prompts: string[], id = "scripted-pin"): IModelProvider {
  return {
    id,
    generate(prompt: string, _options?: IModelOptions) {
      prompts.push(prompt);
      return Promise.resolve(makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`));
    },
  };
}

Deno.test("[transport] the pinned snapshot is rendered after a live edit and an excluded pin renders nothing", async () => {
  const fx = await fixture();
  try {
    const pinned = await fx.pin(SKILL);
    const excluded = await fx.pin("other-skill", { content_included: false });
    await writeSkillFolder(fx.skillsDir, { name: SKILL, instructions: "Live body B." });
    const prompt = await createPinnedSkillPrompt(fx.skills, [pinned, excluded], fx.operation);
    assert(prompt !== null);
    assertStringIncludes(prompt.text, "Approved body A.");
    assertEquals(prompt.text.includes("Live body B."), false);
    assertEquals(prompt.text.includes("Other body."), false);
    assertEquals(await createPinnedSkillPrompt(fx.skills, [], fx.operation), null);
    assertEquals(await createPinnedSkillPrompt(fx.skills, [excluded], fx.operation), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[transport][security] a swapped pin or a corrupt snapshot fails before anything renders", async () => {
  const fx = await fixture();
  try {
    const pinned = await fx.pin(SKILL);
    await assertRejects(
      () => createPinnedSkillPrompt(fx.skills, [{ ...pinned, name: "other-skill" }], fx.operation),
      SkillUnavailableError,
    );
    await assertRejects(
      () => createPinnedSkillPrompt(fx.skills, [{ ...pinned, content_sha256: "f".repeat(64) }], fx.operation),
      SkillUnavailableError,
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[react] the provider sees the approved body and each call records plan_pinned rows first", async () => {
  const fx = await fixture();
  try {
    const pinned = await fx.pin(SKILL);
    await writeSkillFolder(fx.skillsDir, { name: SKILL, instructions: "Live body B." });
    const prompts: string[] = [];
    const strategy = new ReActLoopStrategy(EXECUTOR, completingProvider(prompts));
    const pinnedPrompt = await createPinnedSkillPrompt(fx.skills, [pinned], fx.operation);
    await strategy.execute(BLUEPRINT, CONTEXT, OPTIONS, pinnedPrompt);
    assertEquals(prompts.length, 1);
    assertStringIncludes(prompts[0], "Approved body A.");
    assertEquals(prompts[0].includes("Live body B."), false);
    const rows = await fx.rows();
    assertEquals(rows.map((row) => [row.skill_name, row.match_source, row.submission_kind, row.round]), [[
      SKILL,
      "plan_pinned",
      "provider",
      1,
    ]]);
    assertEquals(rows[0].revision_id, pinned.revision_id);
    assertEquals(rows[0].trace_id, TRACE);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[react] a failed usage write stops the loop before the provider is called", async () => {
  const fx = await fixture();
  try {
    const pinned = await fx.pin(SKILL);
    const pinnedPrompt = await createPinnedSkillPrompt(fx.skills, [pinned], fx.operation);
    await fx.db.preparedRun("DROP TABLE skill_usage");
    const prompts: string[] = [];
    await assertRejects(
      () =>
        new ReActLoopStrategy(EXECUTOR, completingProvider(prompts)).execute(BLUEPRINT, CONTEXT, OPTIONS, pinnedPrompt),
      SkillAuditUnavailableError,
    );
    assertEquals(prompts.length, 0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[react] without a pinned prompt the prompt carries no skills and no row is written", async () => {
  const fx = await fixture();
  try {
    const prompts: string[] = [];
    await new ReActLoopStrategy(EXECUTOR, completingProvider(prompts)).execute(BLUEPRINT, CONTEXT, OPTIONS);
    assertEquals(prompts[0].includes("SKILLS"), false);
    assertEquals((await fx.rows()).length, 0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test(
  "[react][native] the native conversation carries the approved body and every round records a row",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const fx = await fixture();
    try {
      ProviderRegistry.clear();
      ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
        name: "openai-chat",
        description: "Compatible fixture",
        capabilities: ["chat", "tools"],
        costTier: ProviderCostTier.LOCAL,
        pricingTier: PricingTier.LOCAL,
        strengths: [],
        supportsNativeTools: true,
        supportsNativeConversation: true,
        chatFormat: "openai",
      });
      const pinned = await fx.pin(SKILL);
      const pinnedPrompt = await createPinnedSkillPrompt(fx.skills, [pinned], fx.operation);
      const calls: Array<{ prompt: string; options?: IModelOptions }> = [];
      const provider: IModelProvider = {
        id: "openai-chat-fixture-model",
        measureInputTokens: () =>
          Promise.resolve({
            totalTokens: 100,
            tokenSource: "tokenizer_estimate",
            sections: { system: 100, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
          }),
        generate(prompt, options) {
          calls.push({ prompt, options });
          if (calls.length === 1) {
            return Promise.resolve({
              ...makeGenerateResult(""),
              toolCalls: [{ id: "call_1", name: "read_file", input: { path: "README.md" }, type: "function" }],
            });
          }
          return Promise.resolve(makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`));
        },
      };
      const executor = {
        ...BASE_EXECUTOR,
        toolRegistry: {
          execute: () => Promise.resolve({ success: true, data: {} }),
          getTools: () => [{
            name: "read_file",
            description: "Read one file",
            parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          }],
          getBaseDir: () => "/x",
        },
      } as never;
      await new ReActLoopStrategy(executor, provider).execute(
        BLUEPRINT,
        CONTEXT,
        { ...OPTIONS, native_tools_enabled: true, permitted_tools: ["read_file"] },
        pinnedPrompt,
      );
      assertEquals(calls.length, 2);
      assertStringIncludes(calls[0].options!.nativeConversation!.initialPrompt, "Approved body A.");
      assertStringIncludes(calls[1].options!.nativeConversation!.initialPrompt, "Approved body A.");
      const rows = await fx.rows();
      assertEquals(rows.map((row) => row.round), [1, 2]);
      assertEquals(new Set(rows.map((row) => row.call_id)).size, 2);
    } finally {
      ProviderRegistry.clear();
      await fx.cleanup();
    }
  },
);

function cliStrategy(runs: string[][], overrides: { fail?: boolean } = {}): CliDelegateStrategy {
  const run: IRunCliDelegateProcess = (_command, args) => {
    runs.push(args);
    if (overrides.fail) return Promise.reject(new Error("spawn failed"));
    return Promise.resolve({
      code: 0,
      stdout: [
        JSON.stringify({ type: "system", session_id: "ses_1" }),
        JSON.stringify({ type: "result", result: "done", usage: { input_tokens: 1, output_tokens: 1 } }),
      ].join("\n"),
      stderr: "",
    });
  };
  return new CliDelegateStrategy({ tool: "claude-code", bin: "claude", resolvePortalPath: () => "/tmp/portal", run });
}

Deno.test("[cli] the objective carries the approved body on the first and the resumed turn and records before launch", async () => {
  const fx = await fixture();
  try {
    const pinned = await fx.pin(SKILL);
    await writeSkillFolder(fx.skillsDir, { name: SKILL, instructions: "Live body B." });
    const pinnedPrompt = await createPinnedSkillPrompt(fx.skills, [pinned], fx.operation);
    const runs: string[][] = [];
    const strategy = cliStrategy(runs);
    await strategy.execute(BLUEPRINT, { ...CONTEXT, full_plan: "whole plan" }, OPTIONS, pinnedPrompt);
    await strategy.execute(BLUEPRINT, CONTEXT, OPTIONS, pinnedPrompt);
    assertEquals(runs.length, 2);
    for (const args of runs) {
      assertStringIncludes(args[1], "Approved body A.");
      assertEquals(args[1].includes("Live body B."), false);
    }
    assertEquals(runs[1].includes("--resume"), true, "the second turn resumes the captured session");
    const rows = await fx.rows();
    assertEquals(rows.map((row) => [row.skill_name, row.match_source, row.submission_kind]), [
      [SKILL, "plan_pinned", "cli_delegate"],
      [SKILL, "plan_pinned", "cli_delegate"],
    ]);
    assertEquals(new Set(rows.map((row) => row.call_id)).size, 2);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[cli] a failed usage write launches nothing and a failed launch keeps its attempted row", async () => {
  const fx = await fixture();
  try {
    const pinned = await fx.pin(SKILL);
    const pinnedPrompt = await createPinnedSkillPrompt(fx.skills, [pinned], fx.operation);
    const attempted: string[][] = [];
    await assertRejects(() =>
      cliStrategy(attempted, { fail: true }).execute(BLUEPRINT, CONTEXT, OPTIONS, pinnedPrompt)
    );
    assertEquals(attempted.length, 1);
    assertEquals((await fx.rows()).length, 1, "the attempted launch keeps its row");

    await fx.db.preparedRun("DROP TABLE skill_usage");
    const blocked: string[][] = [];
    await assertRejects(
      () => cliStrategy(blocked).execute(BLUEPRINT, CONTEXT, OPTIONS, pinnedPrompt),
      SkillAuditUnavailableError,
    );
    assertEquals(blocked.length, 0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[budget] fit keeps whole skills that fit, critical first, and drops the rest", async () => {
  const fx = await fixture();
  try {
    await writeSkillFolder(fx.skillsDir, {
      name: "critical-skill",
      instructions: "Critical body.",
      sidecar: { critical: true },
    });
    const ordinary = await fx.pin(SKILL);
    const critical = await fx.pin("critical-skill");
    const prompt = await createPinnedSkillPrompt(fx.skills, [ordinary, critical], fx.operation);
    assert(prompt !== null);
    assertEquals(prompt.fit(1_000_000).text, prompt.text);
    const onlyCritical = prompt.fit(prompt.text.length - 1);
    assertStringIncludes(onlyCritical.text, "Critical body.");
    assertEquals(onlyCritical.text.includes("Approved body A."), false);
    assertEquals(prompt.fit(0).text, "");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[budget] a skills section budget of zero keeps pinned skills out of the prompt and out of the journal", async () => {
  const fx = await fixture();
  try {
    const pinned = await fx.pin(SKILL);
    const pinnedPrompt = await createPinnedSkillPrompt(fx.skills, [pinned], fx.operation);
    const prompts: string[] = [];
    const executor = {
      ...BASE_EXECUTOR,
      currentPromptBudget: { sections: { skills: 0 } },
    } as never;
    await new ReActLoopStrategy(executor, completingProvider(prompts)).execute(
      BLUEPRINT,
      CONTEXT,
      OPTIONS,
      pinnedPrompt,
    );
    assertEquals(prompts[0].includes("Approved body A."), false);
    assertEquals((await fx.rows()).length, 0);
  } finally {
    await fx.cleanup();
  }
});
