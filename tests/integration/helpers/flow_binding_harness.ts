/**
 * @module FlowBindingHarness
 * @path tests/integration/helpers/flow_binding_harness.ts
 * @description Shared setup for flow-step binding integration tests: a capturing mock provider
 *   factory, blueprints, an alpha/beta catalog config and a real FlowRunner over a real ModelBindingService.
 * @architectural-layer Test
 * @related-files [tests/integration/flow_step_bindings_declared_test.ts]
 */

import { join } from "@std/path";
import {
  type IModelOptions,
  type IModelProvider,
  type IResolvedProviderOptions,
  ModelBindingService,
  ProviderRegistry,
} from "@exaix/ai";
import type { IProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { MockProvider } from "@exaix/ai/providers.ts";
import { type IDatabaseService, type JSONValue, PricingTier, ProviderCostTier } from "@exaix/core";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner, type IFlowEventLogger } from "@exaix/flow";
import { type Config, ConfigSchema, EffortTierSchema } from "@exaix/schemas";
import { createMockEventLogger } from "@exaix/testing";
import type { Opt, Reason } from "@exaix/core/types";

export interface IBindingHarnessOptions {
  tempDir: string;
  db: IDatabaseService;
  configSource: { get(): Config };
  factory?: CapturingFactory;
  roles?: string[];
  runStore?: ConstructorParameters<typeof ModelBindingService>[0]["runStore"];
  poolMaxSize?: number;
}

export interface IBindingHarness {
  factory: CapturingFactory;
  logger: ReturnType<typeof createMockEventLogger>;
  service: ModelBindingService;
  runner: FlowRunner;
  blueprints: string;
}

const EFFORT_TIERS = [EffortTierSchema.enum.low, EffortTierSchema.enum.medium, EffortTierSchema.enum.high];
const BOOT_CONTENT = "<thought>ok</thought><content>boot</content>";

/** A mock provider factory that records every generate call. */
export class CapturingFactory implements IProviderFactory {
  readonly calls: string[] = [];
  readonly options: Array<IModelOptions | undefined> = [];
  readonly disposed: string[] = [];
  onGenerate?: (model: string) => Promise<void>;
  failCreate = false;

  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    if (this.failCreate) return Promise.reject(new Error("factory unavailable"));
    const model = options.model;
    return Promise.resolve({
      id: `bound-${model}`,
      callCapabilities: { profile: "mock", supportedEffortTiers: EFFORT_TIERS, supportsThinking: true },
      dispose: () => {
        this.disposed.push(model);
        return Promise.resolve();
      },
      generate: async (
        _prompt: string,
        options?: Opt<IModelOptions, Reason.OptionalInput>,
      ): Promise<IGenerateResult> => {
        this.calls.push(model);
        this.options.push(options);
        await this.onGenerate?.(model);
        return {
          content: `<thought>ok</thought><content>${model}</content>`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model,
          provider: "mock",
          cost_usd: 0,
        };
      },
    });
  }
}

export class FlowLog implements IFlowEventLogger {
  readonly actions: string[] = [];
  log(action: string, _payload: Record<string, JSONValue | undefined>): void {
    this.actions.push(action);
  }
}

export function registerMockFactory(factory: IProviderFactory): void {
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
}

export async function writeAgentBlueprints(tempDir: string, roles: string[]): Promise<string> {
  const blueprints = join(tempDir, "Blueprints", "Agents");
  await Deno.mkdir(blueprints, { recursive: true });
  for (const role of roles) {
    await Deno.writeTextFile(
      join(blueprints, `${role}.md`),
      `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
    );
  }
  return blueprints;
}

/** Config with a mock boot provider and two catalog services, alpha and beta, over the mock adapter. */
export function alphaBetaConfig(root: string, bindings?: Opt<Config["bindings"], Reason.OptionalInput>): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    ai: { provider: "mock", model: "boot" },
    bindings,
    catalog: {
      models: {
        "mock/alpha": { model_provider: "mock" },
        "mock/beta": { model_provider: "mock" },
      },
      services: {
        alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
        beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
      },
    },
  });
}

/** Register the capturing factory, write blueprints and build a runner over a real binding service. */
export async function createBindingHarness(options: IBindingHarnessOptions): Promise<IBindingHarness> {
  const factory = options.factory ?? new CapturingFactory();
  registerMockFactory(factory);
  const blueprints = await writeAgentBlueprints(options.tempDir, options.roles ?? ["composer", "explorer"]);
  const logger = createMockEventLogger();
  const service = new ModelBindingService({
    configSource: options.configSource,
    logger,
    db: options.db,
    ...(options.runStore ? { runStore: options.runStore } : {}),
    ...(options.poolMaxSize !== undefined ? { poolMaxSize: options.poolMaxSize } : {}),
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  const adapter = new AgentComposerAdapter(
    new AgentRunner(new MockProvider(BOOT_CONTENT)),
    blueprints,
    undefined,
    service,
  );
  const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
  return { factory, logger, service, runner, blueprints };
}
