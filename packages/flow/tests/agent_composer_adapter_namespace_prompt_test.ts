/**
 * @module AgentComposerAdapterNamespacePromptTest
 * @path packages/flow/tests/agent_composer_adapter_namespace_prompt_test.ts
 * @description Verifies that the configured flow.namespace_prompt_max_bytes bounds the evidence block on both adapter paths.
 * @architectural-layer Test
 * @dependencies [@exaix/flow, @exaix/execution, @exaix/ai, @exaix/testing]
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/flow/tests/shared_namespace_prompt_test.ts]
 */
import { assert } from "@std/assert";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { AgentComposerAdapter, SHARED_NAMESPACE_PROMPT_LABEL } from "@exaix/flow";
import { AgentRunner, StrategyRegistry } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import type { IModelOptions } from "@exaix/ai";
import { ExecutionStrategyName } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { PortalPermissionsService } from "@exaix/portal";
import { createMockConfig, initTestDbService } from "@exaix/testing";
import type { IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

const TASK = "Compose the research findings.";
const BOUND = 2048;
const BIG = { "findings.code": "x".repeat(10_000) };
const AGENTS_DIR = new URL("../../../Blueprints/Agents", import.meta.url).pathname;
const ENCODER = new TextEncoder();

function blockBytes(prompt: string): number {
  const start = prompt.indexOf(SHARED_NAMESPACE_PROMPT_LABEL);
  assert(start >= 0, "the evidence block must be present");
  return ENCODER.encode(prompt.slice(start)).length;
}

function capturingRunner(prompts: string[]): AgentRunner {
  const provider = new MockProvider("<thought>ok</thought><content>composed</content>");
  const generate = provider.generate.bind(provider);
  provider.generate = (prompt: string, options?: IModelOptions) => {
    prompts.push(prompt);
    return generate(prompt, options);
  };
  return new AgentRunner(provider, { disableRetry: true });
}

Deno.test("[config] flow.namespace_prompt_max_bytes bounds the evidence block the provider receives", async () => {
  const dbService = await initTestDbService();
  try {
    const config = createMockConfig(dbService.tempDir);
    const deps = {
      db: dbService.db,
      logger: new EventLogger({ db: dbService.db }),
      permissions: new PortalPermissionsService(config.portals!),
    };
    const prompts: string[] = [];
    const bounded = new AgentComposerAdapter(capturingRunner(prompts), AGENTS_DIR, {
      ...deps,
      config: { ...config, flow: { max_gate_evaluations: 10, namespace_prompt_max_bytes: BOUND } },
    });
    const defaulted = new AgentComposerAdapter(capturingRunner(prompts), AGENTS_DIR, { ...deps, config });
    const request = { userPrompt: TASK, context: {}, sharedNamespace: BIG };
    await bounded.run("software-architect", request);
    await defaulted.run("software-architect", request);
    assert(blockBytes(prompts[0]) <= BOUND, `bounded block was ${blockBytes(prompts[0])} bytes`);
    assert(blockBytes(prompts[1]) > BOUND, "without the key the default bound applies");
    assert(prompts[0].includes(TASK));
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("[config] flow.namespace_prompt_max_bytes also bounds the strategy request", async () => {
  const dbService = await initTestDbService();
  try {
    const config = createMockConfig(dbService.tempDir);
    const contexts: IExecutionContext[] = [];
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register({
      name: ExecutionStrategyName.REACT,
      execute: (_blueprint, context) => {
        contexts.push(context);
        const result: IChangesetResult = {
          branch: "feat/spy",
          commit_sha: "0".repeat(40),
          files_changed: [],
          description: "composed",
          tool_calls: 0,
          execution_time_ms: 1,
        };
        return Promise.resolve(result);
      },
    });
    const agents = join(dbService.tempDir, "Blueprints", "Agents");
    await Deno.mkdir(agents, { recursive: true });
    await Deno.writeTextFile(
      join(agents, "test-agent.md"),
      "---\nname: test-agent\nmodel: gpt-4o-mini\nprovider: openai\ncapabilities: []\n---\nYou are a test agent.",
    );
    const adapter = new AgentComposerAdapter({ run: () => Promise.reject(new Error("unused")) }, agents, {
      config: { ...config, flow: { max_gate_evaluations: 10, namespace_prompt_max_bytes: BOUND } },
      db: dbService.db,
      logger: new EventLogger({ db: dbService.db }),
      permissions: new PortalPermissionsService(config.portals!),
      strategyRegistry,
    });
    await adapter.runWithStrategy!("test-agent", {
      userPrompt: TASK,
      context: {},
      portal: config.portals![0].alias,
      traceId: crypto.randomUUID(),
      sharedNamespace: BIG,
    }, ExecutionStrategyName.REACT);
    assert(blockBytes(contexts[0].request) <= BOUND);
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("[config] a [flow] value parsed from TOML bounds the evidence block", async () => {
  const dbService = await initTestDbService();
  try {
    const base = createMockConfig(dbService.tempDir);
    const parsed = ConfigSchema.parse(
      parseToml(`[system]\nwatcher_timeout_sec = 60\n[flow]\nnamespace_prompt_max_bytes = ${BOUND}\n`),
    );
    const prompts: string[] = [];
    const adapter = new AgentComposerAdapter(capturingRunner(prompts), AGENTS_DIR, {
      config: { ...base, flow: parsed.flow },
      db: dbService.db,
      logger: new EventLogger({ db: dbService.db }),
      permissions: new PortalPermissionsService(base.portals!),
    });
    await adapter.run("software-architect", { userPrompt: TASK, context: {}, sharedNamespace: BIG });
    assert(blockBytes(prompts[0]) <= BOUND);
  } finally {
    await dbService.cleanup();
  }
});
