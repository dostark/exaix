/**
 * @module AgentRunnerSkillUsageTest
 * @path packages/execution/tests/agent_runner_skill_usage_test.ts
 * @description Phase 206 Step 5 — AgentRunner records one usage row per included skill at each
 *   observable provider dispatch: every retry and every planning-tool round gets its own call id,
 *   preview and final-budget-excluded skills get none, sources dedupe by priority, a missing trace
 *   is assigned once, and an audit failure stops the run before any model call. A real
 *   SkillsService, journal DB and scripted providers drive each case.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/skills/skill_usage_store.ts]
 */

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { AgentRunner, type IAgentRunnerConfig, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { PricingTier, ProviderCostTier, SkillStatus } from "@exaix/core";
import { SkillAuditUnavailableError, SkillsService } from "@exaix/core/skills";
import { EventLogger } from "@exaix/core/logger";
import type { IApplicationContext, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { castAny, initTestDbService, makeGenerateResult, writeSkillFolder } from "@exaix/testing";

const WELL_FORMED = "<thought>ok</thought><content>done</content>";
const PIN = "pinned-skill";
const CONTRACT = "contract-skill";
const NATIVE_PROVIDER_ID = "phase206-usage-native-test";

interface IUsageRow {
  call_id: string;
  skill_name: string;
  trace_id: string;
  match_source: string;
  render_mode: string;
  round: number;
  attempt: number;
  revision_id: string;
}

class ScriptedProvider implements IModelProvider {
  readonly id = "scripted-usage";
  calls = 0;
  constructor(private readonly script: Array<IGenerateResult | Error>) {}
  generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls += 1;
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  }
}

const OK = makeGenerateResult(WELL_FORMED);

class NetworkError extends Error {
  constructor() {
    super("transient network failure");
    this.name = "NetworkError";
  }
}

interface IFixture {
  skills: SkillsService;
  skillsDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  rows: () => Promise<IUsageRow[]>;
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<IFixture> {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-runner-usage-" });
  const skillsDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(skillsDir, {
    name: PIN,
    instructions: "Pinned body.\n\n## Examples\n\nExample text.",
  });
  await writeSkillFolder(skillsDir, {
    name: CONTRACT,
    instructions: "Contract body.",
    sidecar: { critical: true },
  });
  const skills = new SkillsService(
    { memoryDir: join(base, "Memory"), blueprintSkillsDir: skillsDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  await skills.initialize();
  return {
    skills,
    skillsDir,
    db: env.db,
    rows: () =>
      env.db.preparedAll<IUsageRow>(
        `SELECT call_id, skill_name, trace_id, match_source, render_mode, round, attempt, revision_id
           FROM skill_usage ORDER BY id`,
      ),
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

const BLUEPRINT: IBlueprint = { systemPrompt: "You are a test agent.", agentRole: "tester" };

function request(overrides: Partial<IParsedRequest> = {}): IParsedRequest {
  return { userPrompt: "Do the thing.", context: {}, skills: [PIN], traceId: "trace-usage", ...overrides };
}

function runnerFor(
  fx: IFixture,
  provider: IModelProvider,
  extra: Partial<IAgentRunnerConfig> = {},
): AgentRunner {
  return new AgentRunner(provider, { skillsService: fx.skills, disableSkills: false, disableRetry: true, ...extra });
}

Deno.test("[usage] a run writes one row per included skill with source, mode, trace and a fresh call id", async () => {
  const fx = await fixture();
  try {
    const provider = new ScriptedProvider([OK]);
    await runnerFor(fx, provider).run(BLUEPRINT, request({ skills: [PIN, CONTRACT] }), undefined);
    const rows = await fx.rows();
    assertEquals(rows.map((r) => r.skill_name).sort(), [CONTRACT, PIN]);
    assertEquals(new Set(rows.map((r) => r.call_id)).size, 1, "one submission shares one call id");
    assertEquals(rows.every((r) => r.trace_id === "trace-usage" && r.round === 1 && r.attempt === 1), true);
    const byName = new Map(rows.map((r) => [r.skill_name, r]));
    assertEquals(byName.get(PIN)?.render_mode, "full");
    assertEquals(byName.get(PIN)?.match_source, "pinned");
    assertEquals(byName.get(CONTRACT)?.render_mode, "critical");
    assertEquals(provider.calls, 1);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] preview writes zero usage rows and zero snapshots", async () => {
  const fx = await fixture();
  try {
    await runnerFor(fx, new ScriptedProvider([OK])).previewPrompt(BLUEPRINT, request());
    assertEquals((await fx.rows()).length, 0);
    assertEquals((await fx.db.preparedAll("SELECT revision_id FROM skill_revisions")).length, 0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] trimmed render mode is recorded as trimmed for ordinary skills", async () => {
  const fx = await fixture();
  try {
    const context = { config: { get: () => ({ skills: { render_mode: "trimmed" } }), getAll: () => ({}) } } as never;
    await runnerFor(fx, new ScriptedProvider([OK]), { context }).run(BLUEPRINT, request(), undefined);
    assertEquals((await fx.rows()).map((r) => r.render_mode), ["trimmed"]);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a skill dropped by final budget fitting gets no row, an included one does", async () => {
  const fx = await fixture();
  try {
    const dropOrdinary = {
      prepare: ({ segments }: { segments: Array<{ content: string }> }) =>
        Promise.resolve({ segments: segments.filter((s) => !s.content.includes("APPLICABLE SKILLS")) }),
    };
    await runnerFor(fx, new ScriptedProvider([OK]), { contextBudgetManager: dropOrdinary as never }).run(
      BLUEPRINT,
      request({ skills: [PIN, CONTRACT] }),
      undefined,
    );
    assertEquals((await fx.rows()).map((r) => r.skill_name), [CONTRACT]);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a pinned and default duplicate dedupes to one row with the higher-priority source", async () => {
  const fx = await fixture();
  try {
    await runnerFor(fx, new ScriptedProvider([OK])).run(
      { ...BLUEPRINT, defaultSkills: [PIN] },
      request({ skills: [PIN] }),
      undefined,
    );
    const rows = await fx.rows();
    assertEquals(rows.length, 1);
    assertEquals(rows[0].match_source, "pinned");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a default skill is recorded with the default source", async () => {
  const fx = await fixture();
  try {
    await runnerFor(fx, new ScriptedProvider([OK])).run(
      { ...BLUEPRINT, defaultSkills: [PIN] },
      request({ skills: [] }),
      undefined,
    );
    assertEquals((await fx.rows()).map((r) => r.match_source), ["default"]);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a missing trace is assigned once and shared by the whole run", async () => {
  const fx = await fixture();
  try {
    await runnerFor(fx, new ScriptedProvider([OK])).run(
      BLUEPRINT,
      request({ skills: [PIN, CONTRACT], traceId: undefined }),
      undefined,
    );
    const rows = await fx.rows();
    assertEquals(rows.length, 2);
    assertEquals(new Set(rows.map((r) => r.trace_id)).size, 1);
    assertNotEquals(rows[0].trace_id, "");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] every retry is its own submission with a fresh call id and the next attempt number", async () => {
  const fx = await fixture();
  try {
    const provider = new ScriptedProvider([new NetworkError(), new NetworkError(), OK]);
    const runner = new AgentRunner(provider, {
      skillsService: fx.skills,
      disableSkills: false,
      retryPolicy: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 1, jitterFactor: 0 },
    } as never);
    await runner.run(BLUEPRINT, request(), undefined);
    const rows = await fx.rows();
    assertEquals(provider.calls, 3);
    assertEquals(rows.map((r) => r.attempt), [1, 2, 3]);
    assertEquals(new Set(rows.map((r) => r.call_id)).size, 3);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a provider failure keeps the attempted-call row", async () => {
  const fx = await fixture();
  try {
    const provider = new ScriptedProvider([new Error("permanent failure")]);
    await assertRejects(() => runnerFor(fx, provider).run(BLUEPRINT, request(), undefined));
    assertEquals((await fx.rows()).length, 1);
    assertEquals(provider.calls, 1);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a failed usage write stops the run before any provider dispatch", async () => {
  const fx = await fixture();
  try {
    await fx.db.preparedRun("DROP TABLE skill_usage");
    const provider = new ScriptedProvider([OK]);
    const error = await assertRejects(
      () => runnerFor(fx, provider).run(BLUEPRINT, request(), undefined),
      SkillAuditUnavailableError,
    );
    assertEquals(error.code, "skill_audit_unavailable");
    assertEquals(provider.calls, 0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a request whose skills are all unavailable records nothing and still runs", async () => {
  const fx = await fixture();
  try {
    const provider = new ScriptedProvider([OK]);
    await runnerFor(fx, provider).run(BLUEPRINT, request({ skills: ["no-such-skill"] }), undefined);
    assertEquals((await fx.rows()).length, 0);
    assertEquals(provider.calls, 1);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[usage] a draft skill is never injected and so never recorded", async () => {
  const fx = await fixture();
  try {
    await writeSkillFolder(fx.skillsDir, {
      name: "draft-skill",
      instructions: "Draft.",
      sidecar: { status: SkillStatus.DRAFT },
    });
    await runnerFor(fx, new ScriptedProvider([OK])).run(BLUEPRINT, request({ skills: ["draft-skill"] }), undefined);
    assertEquals((await fx.rows()).length, 0);
  } finally {
    await fx.cleanup();
  }
});

class StubToolRegistry implements IToolRegistry {
  constructor(private readonly baseDir: string) {}
  getTools() {
    return [{ name: "read_file", description: "read a file", parameters: { type: "object" as const, properties: {} } }];
  }
  execute(_name: string, _params: Record<string, JSONValue>): Promise<IToolResult> {
    return Promise.resolve({ success: true, data: { content: "marker-content" } });
  }
  getBaseDir(): string {
    return this.baseDir;
  }
}

Deno.test("[usage] each planning-tool round is a separate submission with the next round number", async () => {
  ProviderRegistry.registerWithMetadata(NATIVE_PROVIDER_ID, new MockProviderFactory(), {
    name: NATIVE_PROVIDER_ID,
    description: "Phase 206 usage fixture provider (native tools)",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  const fx = await fixture();
  const portalRoot = await Deno.makeTempDir({ prefix: "exa-runner-usage-portal-" });
  try {
    const provider = new ScriptedProvider([
      makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] }),
      OK,
    ]);
    const portals = [{ alias: "myportal", target_path: portalRoot, agents_allowed: ["*"], operations: ["read"] }];
    const planning = {
      tools_enabled: true,
      max_tool_rounds: 2,
      max_tool_result_tokens: 2000,
      max_tool_calls_per_round: 3,
    };
    const context = castAny<IApplicationContext>({
      config: { get: () => ({ planning, portals }), getAll: () => ({ planning, portals }) },
    });
    const runner = new AgentRunner(provider, {
      context,
      skillsService: fx.skills,
      disableSkills: false,
      disableRetry: true,
      selectedModel: { provider: NATIVE_PROVIDER_ID, model: "test-model" },
      tokenizer: {
        countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
        countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
      },
      plannerToolRegistryFactory: { createToolRegistry: () => new StubToolRegistry(portalRoot) },
    } as never);
    await runner.run(BLUEPRINT, request({ portal: "myportal" }), undefined);
    const rows = await fx.rows();
    assertEquals(provider.calls, 2);
    assertEquals(rows.map((r) => r.round), [1, 2]);
    assertEquals(new Set(rows.map((r) => r.call_id)).size, 2);
  } finally {
    await Deno.remove(portalRoot, { recursive: true }).catch(() => {});
    await fx.cleanup();
  }
});
