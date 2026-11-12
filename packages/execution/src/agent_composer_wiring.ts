/**
 * @module AgentComposerWiring
 * @path packages/execution/src/agent_composer_wiring.ts
 * @description Builds the default collaborators and the core strategy registry of an agent composer.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/agent_composer_strategies.ts]
 */

import type { IModelCallOptions } from "@exaix/schemas";
import type { Opt, Reason } from "@exaix/core/types";
import { StrategyRegistry } from "./strategies/strategy_registry.ts";
import { McpAgentStrategy } from "./strategies/mcp_agent_strategy.ts";
import { ReActLoopStrategy } from "./strategies/react_loop_strategy.ts";
import { ContextBudgetManager } from "./context/context_budget_manager.ts";
import { ExecutionContextService } from "./execution_context_service.ts";
import { BlueprintService } from "./blueprint_service.ts";
import { PromptBuilder } from "./prompt_builder.ts";
import { GitAuditService } from "./git_audit_service.ts";
import { HistoryManager } from "./history_manager.ts";
import { OutputParser } from "./output_parser.ts";
import { ReActLoopAdapter } from "./react_loop_adapter.ts";
import type { AgentComposer, IAgentComposerDeps } from "./agent_composer.ts";
import { buildCliDelegateStrategy } from "./agent_composer_strategies.ts";

// unslop-ignore-next-line unused-type
/** The collaborators of one composer that the deps may override. */
export interface IComposerServices {
  blueprintService: BlueprintService;
  ctx: ExecutionContextService;
  promptBuilder: PromptBuilder;
  gitAuditService: GitAuditService;
  outputParser: OutputParser;
  historyManager: HistoryManager;
  reActAdapter: ReActLoopAdapter;
}

/** Takes each collaborator from the deps, or builds the default one. */
export function resolveComposerServices(
  deps: IAgentComposerDeps,
  resolvedCallOptions: Opt<IModelCallOptions, Reason.OptionalContext>,
): IComposerServices {
  const { config, logger, provider } = deps;
  const blueprintService = deps.blueprintService ??
    new BlueprintService(config, logger, deps.modelResolver, deps.options);
  const ctx = deps.executionContext ?? new ExecutionContextService(config, logger, {
    promptBudgetAllocator: undefined,
    contextCache: undefined,
    tokenizer: undefined,
    contextBudgetManager: new ContextBudgetManager(undefined, undefined, undefined, logger),
    snapshotStore: undefined,
  });
  const outputParser = deps.outputParser ?? new OutputParser();
  const promptBuilder = deps.promptBuilder ?? new PromptBuilder(logger, ctx);
  return {
    blueprintService,
    ctx,
    promptBuilder,
    gitAuditService: deps.gitAuditService ?? new GitAuditService(logger),
    outputParser,
    historyManager: deps.historyManager ?? new HistoryManager(config, logger, provider, deps.db, resolvedCallOptions),
    reActAdapter: new ReActLoopAdapter(outputParser, ctx, logger, deps.toolRegistry, {
      guardrailRunner: deps.guardrailRunner,
      aci: {
        enabled: config.agents?.inject_aci_docs,
        promptMaxChars: config.agents?.aci_doc_prompt_max_chars,
      },
      maxIterations: config.agents?.max_iterations,
      toolsRoundPolicy: deps.toolsRoundPolicy,
      promptBuilder,
    }),
  };
}

/** What the core strategies need from the composer that registers them. */
interface ICoreStrategyWiring {
  readonly reActAdapter: ReActLoopAdapter;
  readonly resolvePortalPath: (portalAlias: string) => string | undefined;
}

/** Builds the registry with the ReAct, MCP and, when configured, cli-delegate strategies. */
export function registerCoreStrategies(
  composer: AgentComposer,
  deps: IAgentComposerDeps,
  wiring: ICoreStrategyWiring,
): StrategyRegistry {
  const registry = new StrategyRegistry();
  registry.register(new ReActLoopStrategy(wiring.reActAdapter, deps.provider));
  registry.register(new McpAgentStrategy(composer));
  if (deps.cliDelegateBinding || deps.config.cli_delegate?.enabled) {
    registry.register(
      buildCliDelegateStrategy(deps.config.cli_delegate, deps.cliDelegateBinding, deps.cliDelegateRun, {
        resolvePortalPath: wiring.resolvePortalPath,
        contextPort: deps.contextPort,
        trustedAgentRoles: deps.trustedAgentRoles,
      }),
    );
  }
  return registry;
}
