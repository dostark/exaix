/**
 * @module ToolRegistry
 * @path packages/tool-runtime/src/tool_registry.ts
 * @description Central registry for available tools. Maps abstract tool names (e.g., 'read_file')
 * to concrete implementations with security validation and logging.
 * @architectural-layer Services
 * @related-files ["packages/core/src/planning/plan_executor.ts", packages-team/mcp-server/tools.ts]
 */
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { join, resolve } from "@std/path";
import { expandGlob } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import { BYTES_PER_KB, LogLevel, PORTAL_PREFIX_PATTERN, SystemCommand, ToolName } from "@exaix/core";
import { DEFAULT_MCP_IDENTITY_ID, type IGitServiceFactory } from "@exaix/core/types";
import { type IMiddlewarePipeline, type IPathSecurityOps, PathAccessError, PathTraversalError } from "./types.ts";
import { createPathSecurity } from "./path_security.ts";
import type { JSONValue } from "@exaix/core";
import type {
  IApplicationContext,
  IHitlPolicyEvaluator,
  IServiceContext,
  ITool,
  IToolRegistry,
  IToolResult,
} from "@exaix/core/types";
import { queryRelationships, type RelationshipEdgeKind, whoDependsOn } from "@exaix/portal/knowledge";
import type { IToolConfirmationInterceptor } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { HitlRule } from "@exaix/schemas/hitl.ts";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S } from "@exaix/core";
import type { IToolResultRemediationPolicy } from "@exaix/schemas/tool_result.ts";
import type { IToolResultValidator } from "@exaix/schemas/tool_result_validator.ts";
import {
  applyRemediationPolicy,
  type IRemediationResult,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
} from "@exaix/schemas/tool_result_remediation.ts";
import { lookupRemediationPolicy, lookupRemediationToolMetadata } from "@exaix/mcp";
import { type IValidationReportContext, logValidationResult } from "./tool_validation_reporter.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { createCoreToolSchemas } from "./tool_schemas.ts";

type RemediationPolicyResolver = (
  toolName: string,
  policy: IToolResultRemediationPolicy,
) => IToolResultRemediationPolicy;

export interface IToolRegistryConfig {
  config: Config;
  logger?: IEventLogger;
  traceId?: string;
  identityId?: string;
  baseDir?: string;
  context?: IApplicationContext;
  resultValidator?: IToolResultValidator;
  validationReportContext?: IValidationReportContext;
  remediationPolicyResolver?: RemediationPolicyResolver;
  validationEventLogger?: IEventLogger;
  middlewarePipeline?: IMiddlewarePipeline<IToolContext>;
  pathSecurity?: IPathSecurityOps;
  confirmationInterceptor?: IToolConfirmationInterceptor;
  hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  hitlBlueprintRules?: HitlRule[];
  pathResolver?: { resolve(path: string): Promise<string> };
  gitServiceFactory?: IGitServiceFactory;
}

interface IToolContext extends IServiceContext {
  toolName: string;
  params: Record<string, JSONValue>;
  result?: IToolResult;
  toolRegistry: ToolRegistry;
}

/** Fallback trace ID used when no traceId is supplied to ToolRegistry or its operations. */
const DEFAULT_TOOL_REGISTRY_TRACE_ID = "tool-registry";

// Command Whitelist

// Combined whitelist for backward compatibility
const ALLOWED_COMMANDS = new Set([
  // Safe commands
  "echo",
  "printf",
  "pwd",
  "whoami",
  "id",
  "date",
  "uptime",
  "which",
  "type",
  "command",
  "hash",
  "alias",
  // Validated commands
  SystemCommand.LS,
  SystemCommand.GIT,
  SystemCommand.NPM,
  SystemCommand.NODE,
  SystemCommand.DENO,
  SystemCommand.EXACTL,
  SystemCommand.GREP,
]);

// Argument Validation Functions

/**
 * Validate command arguments for security and safety
 */
function validateCommandArguments(command: string, args: string[]): { valid: boolean; reason?: string } {
  // Reject dangerous argument patterns
  const dangerousPatterns = [
    /[\$`]/, // Shell metacharacters
    /\|/, // Pipes
    /;/, // Command separators
    /&&/, // Logical AND
    /\|\|/, // Logical OR
    />/, // Output redirection
    /<</, // Input redirection
    /2>/, // Error redirection
  ];

  for (const arg of args) {
    for (const pattern of dangerousPatterns) {
      if (pattern.test(arg)) {
        return {
          valid: false,
          reason: `Argument contains dangerous pattern: ${pattern.source}`,
        };
      }
    }
  }

  // Command-specific validations
  switch (command) {
    case SystemCommand.GIT:
      // Git-specific validation is handled via the injected git service
      return { valid: true };
    case SystemCommand.NPM:
    case SystemCommand.NODE:
    case SystemCommand.DENO:
    case SystemCommand.EXACTL:
      return validateRuntimeArguments(command, args);
    case SystemCommand.LS:
      return validateLsArguments(args);
    case SystemCommand.GREP:
      return validateGrepArguments(args);
    default:
      // For safe commands, basic validation is sufficient
      return { valid: true };
  }
}

/**
 * Validate runtime command arguments (npm, node, deno, exactl).
 *
 * Security (Finding 4): only inert, non-code-executing subcommands are permitted,
 * and the WHOLE argument vector is checked. Code-executing subcommands
 * (`test`, `run`, `eval`, `repl`, `task`, `bench`, `exec`, `start`, a bare script
 * path for node, etc.) are rejected — they would run arbitrary code — as is any
 * Deno permission flag (`-A` / `--allow-*`) anywhere in the vector.
 */
function validateRuntimeArguments(runtime: string, args: string[]): { valid: boolean; reason?: string } {
  // Inert subcommands that do not execute project code (static checks / metadata).
  const safeSubcommands = ["--version", "--help", "-V", "-v", "version", "info", "lint", "fmt", "check"];

  if (args.length === 0) return { valid: true }; // Allow bare command (e.g. `deno`)

  // Reject Deno permission flags anywhere — they would re-enable host access.
  if (args.some((arg) => arg === "-A" || arg.startsWith("--allow-"))) {
    return {
      valid: false,
      reason: `${runtime} permission flags are not allowed`,
    };
  }

  const firstArg = args[0];
  if (!safeSubcommands.includes(firstArg)) {
    return {
      valid: false,
      reason: `${runtime} subcommand not allowed: ${firstArg}`,
    };
  }

  return { valid: true };
}

/**
 * Validate ls command arguments
 */
function validateLsArguments(args: string[]): { valid: boolean; reason?: string } {
  // Allow safe ls options only
  const allowedLsOptions = ["-l", "-a", "-h", "-1", "--color=never"];

  for (const arg of args) {
    if (arg.startsWith("-") && !allowedLsOptions.includes(arg)) {
      return {
        valid: false,
        reason: `Unsafe ls option not allowed: ${arg}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate grep command arguments
 */
function validateGrepArguments(args: string[]): { valid: boolean; reason?: string } {
  // Allow safe grep options only
  const allowedGrepOptions = ["-i", "-v", "-n", "-c", "-l", "-r", "-E", "-F", "-e", "-A", "-B", "-C"];

  for (const arg of args) {
    if (arg.startsWith("-")) {
      // Check if it's a known short option or a known long option (none currently allowed)
      const isAllowed = allowedGrepOptions.includes(arg) ||
        (arg.length >= 2 && arg.startsWith("-") && !arg.startsWith("--") &&
          allowedGrepOptions.includes(arg.substring(0, 2)));

      if (!isAllowed) {
        return {
          valid: false,
          reason: `Unsafe grep option not allowed: ${arg}`,
        };
      }
    }
  }

  return { valid: true };
}

// ToolRegistry Implementation

export class ToolRegistry implements IToolRegistry {
  private config: Config;
  private logger?: IEventLogger;
  private traceId?: string;
  private identityId?: string;
  private pathResolver: { resolve(path: string): Promise<string> } | undefined;
  private gitServiceFactory: IGitServiceFactory | undefined;
  private applicationContext: IApplicationContext | undefined;
  private tools: Map<string, ITool>;
  private baseDir: string;
  private pipeline: IMiddlewarePipeline<IToolContext>;
  private pathSecurity: IPathSecurityOps;
  private executors: Map<string, (params: Record<string, JSONValue>) => Promise<IToolResult>> = new Map();
  private resultValidator?: IToolResultValidator;
  private validationReportContext?: IValidationReportContext;
  private remediationPolicyResolver?: RemediationPolicyResolver;
  private validationEventLogger?: IEventLogger;
  private confirmationInterceptor?: IToolConfirmationInterceptor;
  private hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  private hitlBlueprintRules?: HitlRule[];

  constructor(
    middlewarePipelineOrOptions?: Opt<
      IMiddlewarePipeline<IToolContext> | IToolRegistryConfig,
      Reason.OptionalDependency
    >,
    pathSecurity?: Opt<IPathSecurityOps, Reason.OptionalDependency>,
    options?: Opt<IToolRegistryConfig, Reason.OptionalDependency>,
  ) {
    // Support both calling patterns:
    //   new ToolRegistry({ config, db, ... })  (old-style, no DI)
    //   new ToolRegistry(pipeline, pathSecurity, { config, db, ... })  (DI style)
    const hasConfigLike = middlewarePipelineOrOptions != null && "config" in middlewarePipelineOrOptions;
    const resolvedOptions: IToolRegistryConfig | undefined = hasConfigLike
      ? (middlewarePipelineOrOptions as IToolRegistryConfig)
      : options;
    const resolvedPipeline = hasConfigLike
      ? (middlewarePipelineOrOptions as IToolRegistryConfig).middlewarePipeline
      : (middlewarePipelineOrOptions as IMiddlewarePipeline<IToolContext> | undefined);
    const resolvedPathSecurity = hasConfigLike
      ? (middlewarePipelineOrOptions as IToolRegistryConfig).pathSecurity
      : pathSecurity;

    const ctx = resolvedOptions?.context;
    this.config = ctx?.config.get() || resolvedOptions?.config || ConfigSchema.parse({
      system: { root: Deno.cwd(), log_level: LogLevel.INFO },
      paths: {},
      database: {},
      watcher: {},
      agents: {},
      models: {},
      portals: [],
      mcp: {},
    });

    this.logger = resolvedOptions?.logger;

    this.traceId = resolvedOptions?.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID;
    this.identityId = resolvedOptions?.identityId ?? DEFAULT_MCP_IDENTITY_ID;
    this.baseDir = resolvedOptions?.baseDir ? resolve(resolvedOptions.baseDir) : resolve(this.config.system.root);

    this.pathResolver = resolvedOptions?.pathResolver;
    this.gitServiceFactory = resolvedOptions?.gitServiceFactory;
    this.applicationContext = ctx;
    this.tools = new Map();
    this.pipeline = resolvedPipeline ?? createNoopPipeline<IToolContext>();
    this.pathSecurity = resolvedPathSecurity ?? createPathSecurity();
    this.resultValidator = resolvedOptions?.resultValidator;
    this.validationReportContext = resolvedOptions?.validationReportContext;
    this.remediationPolicyResolver = resolvedOptions?.remediationPolicyResolver;
    this.validationEventLogger = resolvedOptions?.validationEventLogger ?? this.logger;
    this.confirmationInterceptor = resolvedOptions?.confirmationInterceptor;
    this.hitlPolicyEvaluator = resolvedOptions?.hitlPolicyEvaluator;
    this.hitlBlueprintRules = resolvedOptions?.hitlBlueprintRules;

    this.registerCoreTools();
    this.registerCoreExecutors();
    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    // Validation Middleware
    this.pipeline.use(async (ctx, next) => {
      if (!this.tools.has(ctx.toolName)) {
        ctx.result = {
          success: false,
          error: `Tool '${ctx.toolName}' not found`,
        };
        return;
      }
      await next();
    });

    // HITL Confirmation Middleware (Phase 118 — per-action governance)
    this.pipeline.use(async (ctx, next) => {
      if (!this.hitlPolicyEvaluator) return await next();
      const match = this.hitlPolicyEvaluator.evaluate(
        this.hitlBlueprintRules ?? [],
        ctx.toolName,
        ctx.params,
      );
      if (!match) return await next();
      if (this.logger) {
        void this.logger.info(DomainEventType.HitlPolicyMatched, ctx.toolName, {
          traceId: this.traceId,
          tool: ctx.toolName,
          ruleSource: match.source,
          reason: match.rule.reason,
          surface: "tool_registry",
        }, this.traceId);
      }
      if (!this.confirmationInterceptor) {
        if (match.source === "mandatory") {
          ctx.result = this.#deniedResult(ctx.toolName, "HITL governance: no approver available");
          return;
        }
        return await next();
      }
      const request = this.#buildRequest(ctx.toolName, ctx.params, match.rule.reason);
      const decision = await this.confirmationInterceptor.requestApproval(request);
      if (!decision.approved) {
        ctx.result = this.#deniedResult(ctx.toolName, decision.reason);
        return;
      }
      await next();
    });

    // Logging Middleware
    this.pipeline.use(async (ctx, next) => {
      const startTime = Date.now();
      try {
        await next();
        this.logActivity(`tool.${ctx.toolName}`, {
          success: ctx.result?.success ?? false,
          duration_ms: Date.now() - startTime,
          params: ctx.params,
          error: ctx.result?.error ?? null,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logActivity(`tool.${ctx.toolName}`, {
          success: false,
          duration_ms: Date.now() - startTime,
          params: ctx.params,
          error: errorMsg,
        });
        throw error;
      }
    });

    // Error Handling Middleware
    this.pipeline.use(async (ctx, next) => {
      try {
        await next();
      } catch (error) {
        ctx.result = this.formatError(error);
      }
    });
  }

  #deniedResult(toolName: string, reason?: Opt<string, Reason.SensibleDefault>): IToolResult {
    return {
      success: false,
      error: `Tool '${toolName}' execution denied: ${reason ?? "HITL governance blocked"}`,
    };
  }

  #buildRequest(
    toolName: string,
    params: Record<string, JSONValue>,
    reason?: Opt<string, Reason.SensibleDefault>,
  ): ToolConfirmationRequest {
    const requestedAt = new Date();
    const expiresAt = new Date(
      requestedAt.getTime() + DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S * 1000,
    );
    return {
      id: crypto.randomUUID(),
      toolName,
      args: params as Record<string, unknown>,
      stepId: "tool:" + crypto.randomUUID(),
      traceId: this.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID,
      reason,
      requestedAt: requestedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Register all core tools
   */
  private registerCoreTools(): void {
    for (const tool of createCoreToolSchemas()) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Register all core executors
   */
  private registerCoreExecutors(): void {
    const str = (v: JSONValue): string => (typeof v === "string" ? v : String(v ?? ""));
    const optStr = (v: JSONValue): string | undefined => (typeof v === "string" ? v : undefined);
    const bool = (v: JSONValue): boolean => Boolean(v);
    const strArr = (v: JSONValue): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

    this.executors.set(ToolName.READ_FILE, (p) => this.readFile(str(p.path)));
    this.executors.set(ToolName.WRITE_FILE, (p) => this.writeFile(str(p.path), str(p.content)));
    this.executors.set(ToolName.LIST_DIRECTORY, (p) => this.listDirectory(str(p.path)));
    this.executors.set(ToolName.SEARCH_FILES, (p) => this.searchFiles(str(p.pattern), str(p.path)));
    this.executors.set(
      ToolName.RUN_COMMAND,
      (p) => this.runCommand(str(p.command), p.args ? strArr(p.args) : [], p.cwd ? str(p.cwd) : undefined),
    );
    this.executors.set(ToolName.CREATE_DIRECTORY, (p) => this.createDirectory(str(p.path)));
    this.executors.set(
      ToolName.FETCH_URL,
      (p) => this.fetchUrl(str(p.url), p.format ? str(p.format) : undefined),
    );
    this.executors.set(
      ToolName.GREP_SEARCH,
      (p) =>
        this.grepSearch(
          str(p.pattern),
          str(p.path),
          p.case_sensitive !== undefined ? bool(p.case_sensitive) : undefined,
        ),
    );
    this.executors.set(
      ToolName.MOVE_FILE,
      (p) => this.moveFile(optStr(p.from), optStr(p.to), p.overwrite !== undefined ? bool(p.overwrite) : undefined),
    );
    this.executors.set(
      ToolName.COPY_FILE,
      (p) =>
        this.copyFile(str(p.source), str(p.destination), p.overwrite !== undefined ? bool(p.overwrite) : undefined),
    );
    this.executors.set(ToolName.DELETE_FILE, (p) => this.deleteFile(str(p.path)));
    this.executors.set(
      ToolName.GIT_INFO,
      (p) => this.gitInfo(str(p.repo_path), p.scope ? str(p.scope) : undefined),
    );
    this.executors.set(
      ToolName.DENO_TASK,
      (p) => this.denoTask(str(p.task), p.path ? str(p.path) : undefined, p.args ? strArr(p.args) : undefined),
    );
    this.executors.set(
      ToolName.PATCH_FILE,
      (p) => this.patchFile(str(p.path), optStr(p.search), optStr(p.replace)),
    );
    this.executors.set(
      ToolName.QUERY_RELATIONSHIPS,
      (p) => this.queryRelationshipsTool(str(p.from), optStr(p.kind) as RelationshipEdgeKind | undefined),
    );
    this.executors.set(ToolName.WHO_DEPENDS_ON, (p) => this.whoDependsOnTool(str(p.path)));
    this.executors.set(
      ToolName.REMEMBER_FACT,
      (p) => this.rememberFactTool(str(p.content), p.tags ? strArr(p.tags) : undefined),
    );
  }

  /**
   * Get all registered tools
   */
  getTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * The resolved, absolute directory every tool call is rooted at — the
   * explicit `baseDir` constructor option when given (e.g. a plan's git
   * worktree), else config.system.root. Lets a caller that bypasses
   * ToolRegistry.execute() for its own file operations (e.g.
   * CliDelegateStrategy shelling out to an external CLI) still run in the
   * same directory ToolRegistry-mediated tool calls do.
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Sets the per-blueprint HITL rules the HITL middleware evaluates against for every
   * subsequent `execute()` call, replacing whatever was passed at construction (if any).
   * Called by `AgentOrchestrator.executeStep()` once it has loaded the blueprint about to
   * run (Phase 154 Step 3) — see `IToolRegistry.setHitlBlueprintRules` for why this exists
   * as a setter rather than a constructor-only option.
   */
  setHitlBlueprintRules(rules: HitlRule[]): void {
    this.hitlBlueprintRules = rules;
  }

  /**
   * Execute a tool by name
   */
  async execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    const context: IToolContext = {
      toolName,
      params,
      toolRegistry: this,
      traceId: this.traceId,
      identityId: this.identityId,
    };

    await this.pipeline.execute(context, async () => {
      // Core Execution Logic
      const executor = this.executors.get(toolName);
      if (executor) {
        context.result = await executor(params);
      } else {
        context.result = {
          success: false,
          error: `Tool '${toolName}' not implemented`,
        };
      }
    });

    // Validate result envelope at the registry boundary (Enforcement Point 2).
    // rawResult in the failure is for audit only — never forwarded to callers.
    if (this.resultValidator && context.result) {
      const failure = this.resultValidator.validateEnvelope(
        toolName,
        context.result as unknown as Record<string, JSONValue>,
      );
      if (failure) {
        const remediationPolicy = this.resolveRemediationPolicy(toolName);
        const remediationMetadata = lookupRemediationToolMetadata(toolName) ?? undefined;
        const retryExecutor = this.executors.get(toolName);

        if (remediationPolicy) {
          const remediationResult = await applyRemediationPolicy(
            toolName,
            remediationPolicy,
            failure,
            this.resultValidator,
            {
              normalize: (rawResult) => rawResult,
              retry: async () => {
                const retryResult = retryExecutor ? await retryExecutor(params) : {
                  success: false,
                  error: `Tool '${toolName}' not implemented`,
                };
                return retryResult as unknown as JSONValue;
              },
              toolMetadata: remediationMetadata,
            },
          );

          await this.reportValidationOutcome(toolName, remediationPolicy, remediationResult);

          if (remediationResult.outcome === "passed") {
            return remediationResult.remediatedResult as unknown as IToolResult;
          }
        } else {
          await this.reportValidationOutcome(toolName, this.getFallbackValidationPolicy(toolName), {
            outcome: REMEDIATION_OUTCOME_FAIL_CLOSED,
            failure,
            retriesAttempted: 0,
          });
        }

        return {
          success: false,
          error: `Tool result validation failed: ${failure.issues.map((i) => i.message).join("; ")}`,
        };
      }
    }

    return context.result!;
  }

  private resolveRemediationPolicy(toolName: string): IToolResultRemediationPolicy | null {
    const policy = lookupRemediationPolicy(toolName);
    if (!policy) {
      return null;
    }
    return this.remediationPolicyResolver ? this.remediationPolicyResolver(toolName, policy) : policy;
  }

  private getFallbackValidationPolicy(toolName: string): IToolResultRemediationPolicy {
    return {
      tool: toolName,
      mode: "fail_closed",
      maxRetries: 0,
      requiresIdempotency: false,
      allowRetryAfterSideEffect: false,
      logValidationFailures: true,
      triggerPlanAmendmentOnFailure: false,
    };
  }

  private async reportValidationOutcome(
    toolName: string,
    policy: IToolResultRemediationPolicy,
    result: IRemediationResult,
  ): Promise<void> {
    try {
      const traceId = this.traceId ?? this.validationReportContext?.traceId;
      const logger = this.validationEventLogger ?? createNoopEventLogger();
      await logValidationResult(
        toolName,
        policy,
        result,
        logger,
        {
          ...this.validationReportContext,
          traceId,
        },
      );
    } catch {
      // Validation reporting must not break tool execution.
    }
  }

  /** Resolves the portal alias/path this registry's baseDir is rooted at, mirroring the
   *  `ownPortal` comparison resolvePath already uses for `@`-alias resolution. */
  private currentPortal(): { alias: string; path: string } | undefined {
    const portal = this.config.portals.find((p) => resolve(p.target_path) === this.baseDir);
    return portal ? { alias: portal.alias, path: portal.target_path } : undefined;
  }

  private async queryRelationshipsTool(
    from: string,
    kind?: Opt<RelationshipEdgeKind, Reason.QueryFilter>,
  ): Promise<IToolResult> {
    const portalKnowledgeService = this.applicationContext?.portalKnowledge;
    if (!portalKnowledgeService) {
      return { success: false, error: "query_relationships requires a portal-knowledge service, none is configured" };
    }
    const portal = this.currentPortal();
    if (!portal) {
      return { success: false, error: "query_relationships: current execution root is not a configured portal" };
    }
    const knowledge = await portalKnowledgeService.getOrAnalyze(portal.alias, portal.path);
    return this.formatSuccess(queryRelationships(knowledge, from, kind) as unknown as JSONValue);
  }

  /** Captures a lightweight execution-scoped note into the per-trace scratchpad; traceId is the registry's own, never agent-supplied. */
  private rememberFactTool(content: string, tags?: string[]): Promise<IToolResult> {
    const scratchpad = this.applicationContext?.scratchpad;
    if (!scratchpad) {
      return Promise.resolve({
        success: false,
        error: "remember_fact requires a scratchpad service, none is configured",
      });
    }
    return scratchpad.append(this.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID, content, tags);
  }

  private async whoDependsOnTool(path: string): Promise<IToolResult> {
    const portalKnowledgeService = this.applicationContext?.portalKnowledge;
    if (!portalKnowledgeService) {
      return { success: false, error: "who_depends_on requires a portal-knowledge service, none is configured" };
    }
    const portal = this.currentPortal();
    if (!portal) {
      return { success: false, error: "who_depends_on: current execution root is not a configured portal" };
    }
    const knowledge = await portalKnowledgeService.getOrAnalyze(portal.alias, portal.path);
    return this.formatSuccess(whoDependsOn(knowledge, path) as unknown as JSONValue);
  }

  /**
   * Read file tool implementation
   */
  private async readFile(path: string): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(path);
      const content = await Deno.readTextFile(resolvedPath);
      return this.formatSuccess({ content });
    } catch (error) {
      return this.formatError(error, `File: ${path}`);
    }
  }

  /**
   * Write file tool implementation
   */
  private async writeFile(path: string, content: string): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(path);

      // Ensure parent directory exists
      const parentDir = join(resolvedPath, "..");
      await Deno.mkdir(parentDir, { recursive: true });

      await Deno.writeTextFile(resolvedPath, content);
      return this.formatSuccess({ path: resolvedPath });
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * List directory tool implementation
   */
  private async listDirectory(path: string): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(path);
      const entries: Array<{ name: string; isDirectory: boolean }> = [];

      for await (const entry of Deno.readDir(resolvedPath)) {
        entries.push({
          name: entry.name,
          isDirectory: entry.isDirectory,
        });
      }

      return this.formatSuccess({ entries });
    } catch (error) {
      return this.formatError(error, `Directory: ${path}`);
    }
  }

  /**
   * Search files tool implementation
   */
  private async searchFiles(pattern: string, searchPath: string): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(searchPath);
      const files: string[] = [];

      // Construct glob pattern
      const globPattern = join(resolvedPath, pattern);

      for await (const entry of expandGlob(globPattern)) {
        if (entry.isFile) {
          files.push(entry.path);
        }
      }

      return this.formatSuccess({ files });
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * The absolute filesystem roots a tool may operate within: the workspace, memory,
   * and blueprint dirs under system root, the system root itself, and every configured
   * portal target. Used to validate both resolved file paths and run_command cwd.
   */
  private async getAllowedRoots(): Promise<string[]> {
    const systemRootAbsolute = await Deno.realPath(this.config.system.root).catch(() =>
      resolve(this.config.system.root)
    );
    return [
      join(systemRootAbsolute, this.config.paths.workspace),
      join(systemRootAbsolute, this.config.paths.memory),
      join(systemRootAbsolute, this.config.paths.blueprints),
      systemRootAbsolute,
      ...this.config.portals.map((p) => p.target_path),
    ];
  }

  /**
   * A `baseDir` other than config.system.root means this registry was constructed for a
   * specific execution root (e.g. a plan's git worktree, per PlanExecutor's `repoPath` ->
   * ToolRegistry `baseDir` wiring) — mirrors resolveAuditPortalPath's identical guard in
   * agent_orchestrator.ts.
   */
  private hasExplicitExecutionRoot(): boolean {
    return this.baseDir !== resolve(this.config.system.root);
  }

  /**
   * Splits a `@<alias>/<relativePath>` string, returning the bare alias name (no `@`) and the
   * remainder. Mirrors PathResolver.resolve's own parsing so both stay in sync.
   */
  private parseAliasPath(path: string): { alias: string; relativePath: string } {
    const parts = path.split("/");
    return { alias: parts[0].slice(1), relativePath: parts.slice(1).join("/") };
  }

  /**
   * Resolve and validate a path
   * - If path starts with @ and names THIS registry's own portal while an explicit worktree
   *   baseDir is active, resolve relative to baseDir (the worktree) — matching
   *   CliDelegateStrategy.resolvePortalPath's established getBaseDir()-first pattern. This is
   *   the one alias case ToolRegistry itself can resolve correctly, since only it knows which
   *   worktree the current execution is actually rooted at.
   * - Otherwise (a non-portal alias, or a portal ToolRegistry has no worktree for), delegate to
   *   the injected pathResolver, which always resolves a portal alias to its live target_path.
   * - A bare (non-@) path validates within allowed roots, rooted at baseDir.
   */
  private async resolvePath(path: string): Promise<string> {
    if (path.startsWith("@")) {
      const { alias, relativePath } = this.parseAliasPath(path);
      const portalConfig = this.config.portals.find((p) => p.alias === alias);
      // Phase 140a Step 5: only resolve into baseDir when the portal's target_path
      // actually matches baseDir (registry's OWN portal under a worktree). This lets
      // a worktree-cloned portal isolate writes without grabbing unrelated portals.
      const ownPortal = this.hasExplicitExecutionRoot() && portalConfig &&
        resolve(portalConfig.target_path) === this.baseDir;
      if (ownPortal) {
        return await this.resolveBareRelativePath(relativePath);
      }
      if (this.pathResolver) {
        return await this.pathResolver.resolve(path);
      }
      // No pathResolver — fall through to bare-relative (best-effort via baseDir).
      // Handles ToolRegistry instances constructed without a pathResolver (e.g. some
      // test scenarios) transparently.
      return await this.resolveBareRelativePath(relativePath);
    }

    return await this.resolveBareRelativePath(path);
  }

  private async resolveBareRelativePath(path: string): Promise<string> {
    const allowedRoots = await this.getAllowedRoots();

    try {
      // Securely resolve path within allowed roots
      // Pass this.baseDir as the rootDir for resolution of relative paths
      const resolvedPath = await this.pathSecurity.resolveWithinRoots(
        path,
        allowedRoots,
        this.baseDir,
      );

      return resolvedPath;
    } catch (error) {
      if (error instanceof PathTraversalError) {
        // Log security event
        const payload = {
          attempted_path: path,
          error: error.message,
          trace_id: this.traceId ?? null,
          identity_id: this.identityId ?? null,
        };
        if (this.logger) {
          void this.logger.warn(DomainEventType.SecurityPathTraversalAttempted, path, payload, this.traceId);
        }

        throw new Error(`Access denied: Path traversal detected`);
      }

      if (error instanceof PathAccessError) {
        // Full detail — including the absolute allowed roots — goes to the operator
        // journal only; the caller-facing message stays generic (Finding 10).
        const payload = {
          attempted_path: path,
          resolved_path: error.message.includes("->") ? error.message.split("->")[1]?.trim() : null,
          allowed_roots: allowedRoots.join(", "),
          error: error.message,
          trace_id: this.traceId ?? null,
          identity_id: this.identityId ?? null,
        };
        if (this.logger) {
          void this.logger.warn(DomainEventType.SecurityPathAccessDenied, path, payload, this.traceId);
        }

        throw new Error("Access denied: path is outside the allowed directories");
      }

      // Log generic path resolution errors
      const payload = {
        input_path: path,
        error: error instanceof Error ? error.message : String(error),
        trace_id: this.traceId ?? null,
        identity_id: this.identityId ?? null,
      };
      if (this.logger) {
        void this.logger.warn(DomainEventType.PathResolutionError, path, payload, this.traceId);
      }

      throw error;
    }
  }

  /**
   * Run command tool implementation.
   *
   * Security (Finding 6): when a `cwd` is provided it is validated to be within the
   * allowed roots (e.g. the portal the caller was authorized for) before the command
   * spawns there. Without a `cwd` the command runs in baseDir (system root) as before.
   */
  public async runCommand(
    command: string,
    args: string[],
    cwd?: Opt<string, Reason.SensibleDefault>,
  ): Promise<IToolResult> {
    try {
      // Check if command is whitelisted
      if (!ALLOWED_COMMANDS.has(command)) {
        return {
          success: false,
          error: `Command '${command}' is not allowed. Allowed commands: ${Array.from(ALLOWED_COMMANDS).join(", ")}`,
        };
      }

      // Validate command arguments for security
      let validation = validateCommandArguments(command, args);
      if (validation.valid && command === SystemCommand.GIT && this.gitServiceFactory) {
        const service = this.gitServiceFactory.createGitService(
          this.baseDir,
          this.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID,
        );
        validation = service.validateArgs(args);
      }
      if (!validation.valid) {
        return {
          success: false,
          error: `Command arguments not allowed: ${validation.reason}`,
        };
      }

      let workingDir = this.baseDir;
      if (cwd !== undefined) {
        try {
          workingDir = await this.pathSecurity.resolveWithinRoots(cwd, await this.getAllowedRoots(), this.baseDir);
        } catch {
          return {
            success: false,
            error: `Command working directory is not allowed: it must be within an authorized root`,
          };
        }
      }

      const cmd = new Deno.Command(command, {
        args,
        cwd: workingDir,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await cmd.output();

      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (code !== 0) {
        return {
          success: false,
          error: `Command failed with exit code ${code}: ${errorOutput}`,
        };
      }

      return {
        success: true,
        data: {
          output,
          exitCode: code,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Log activity to database
   */
  private logActivity(actionType: string, payload: Record<string, JSONValue>): void {
    if (!this.logger) return;
    const target = (payload.params as Record<string, JSONValue>)?.path as string ||
      (payload.params as Record<string, JSONValue>)?.command as string || null;
    void this.logger.info(actionType, target, payload, this.traceId);
  }

  /**
   * Format tool result for success
   * @private
   */
  private formatSuccess(data: JSONValue): IToolResult {
    return {
      success: true,
      data,
    };
  }

  /**
   * Format tool result for error
   * @private
   */
  private formatError(error: unknown, context?: Opt<string, Reason.OptionalContext>): IToolResult {
    const normalizedError = error instanceof Error ? error : String(error);

    // Handle path security errors
    if (normalizedError instanceof Error && normalizedError.message.includes("outside allowed roots")) {
      return {
        success: false,
        error: `Access denied: ${normalizedError.message}`,
      };
    }

    // Handle not found errors
    if (normalizedError instanceof Deno.errors.NotFound) {
      let message = context || "Not found";

      // Strip portal prefix if present for cleaner error messages
      if (message.includes("@")) {
        message = message.replace(PORTAL_PREFIX_PATTERN, "");
      }

      return {
        success: false,
        error: `${message} not found`,
      };
    }

    // Generic error handling
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Create directory tool implementation
   */
  private async createDirectory(path: string): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(path);
      await Deno.mkdir(resolvedPath, { recursive: true });
      return this.formatSuccess({ path: resolvedPath });
    } catch (error) {
      return this.formatError(error, `Directory: ${path}`);
    }
  }

  /**
   * Fetch URL tool implementation
   */
  private async fetchUrl(url: string, format: string = "markdown"): Promise<IToolResult> {
    try {
      // 1. Check if enabled
      if (!this.config.tools?.fetch_url?.enabled) {
        return {
          success: false,
          error: "Tool 'fetch_url' is disabled in configuration",
        };
      }

      // 2. Validate URL and structure
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return { success: false, error: "Invalid URL format" };
      }

      // 3. Whitelist check
      const allowedDomains = this.config.tools.fetch_url.allowed_domains;
      if (!allowedDomains.includes(parsedUrl.hostname)) {
        return {
          success: false,
          error: `Domain '${parsedUrl.hostname}' is not in the allowed whitelist: ${allowedDomains.join(", ")}`,
        };
      }

      // 4. Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.tools.fetch_url.timeout_ms);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            success: false,
            error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
          };
        }

        // 5. Size check (rough approximation)
        const contentLength = response.headers.get("content-length");
        const maxBytes = this.config.tools.fetch_url.max_response_size_kb * BYTES_PER_KB;

        if (contentLength && parseInt(contentLength, 10) > maxBytes) {
          return {
            success: false,
            error: `Content length (${contentLength} bytes) exceeds maximum allowed size (${maxBytes} bytes)`,
          };
        }

        const text = await response.text();
        if (text.length > maxBytes) {
          return {
            success: false,
            error: `Content length (${text.length} bytes) exceeds maximum allowed size (${maxBytes} bytes)`,
          };
        }

        // 6. Format output
        // For now, basic text. If markdown is requested, we could add a converter later,
        // but for now raw HTML/Text is better than nothing.
        // Ideally we would use a library like 'turndown' or similar, but let's start simple.
        return this.formatSuccess({
          url,
          content: text,
          format: format, // Just echoing back what we have for now, effectively treated as text/html source
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof DOMException && error.name === "AbortError") {
          return { success: false, error: "Request timed out" };
        }
        throw error;
      }
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * Grep search tool implementation
   */
  private async grepSearch(pattern: string, searchPath: string, caseSensitive = true): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(searchPath);

      // Check if path is a directory
      const stat = await Deno.stat(resolvedPath);
      if (!stat.isDirectory) {
        return {
          success: false,
          error: `Path '${searchPath}' is not a directory`,
        };
      }

      // Construct grep arguments
      const args = ["-r", "-I", "-n"]; // Recursive, Ignore binary, Line numbers

      if (!caseSensitive) {
        args.push("-i");
      }

      // Add exclude dirs from config
      const excludeDirs = this.config.tools?.grep_search?.exclude_dirs || [".git", "node_modules", "dist", "coverage"];
      for (const dir of excludeDirs) {
        args.push(`--exclude-dir=${dir}`);
      }

      // Max results limit (soft limit via head? or hard limit via grep -m?)
      // grep -m stops reading FILE after N matches, but we want total matches?
      // grep doesn't have a global max count. We'll limit output parsing.
      // But let's check max_results config.
      const maxResults = this.config.tools?.grep_search?.max_results || 50;

      // Add pattern and path
      // Pattern must be last argument before path usually, or use -e
      args.push("-e", pattern);
      args.push(resolvedPath);

      const cmd = new Deno.Command("grep", {
        args,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await cmd.output();
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (code !== 0 && code !== 1) { // 1 means no matches found, which is fine
        return {
          success: false,
          error: `Grep failed: ${errorOutput}`,
        };
      }

      // Parse output
      // Format: filename:line:content
      const lines = output.split("\n").filter(Boolean);
      const matches: Array<{ file: string; line: number; content: string }> = [];

      for (const line of lines) {
        if (matches.length >= maxResults) break;

        // Naive split might fail if filename contains colons, but standard grep output uses : separator
        // We should split by first two colons
        const parts = line.split(":");
        if (parts.length < 3) continue;

        const fileAbs = parts[0];
        const lineNum = parseInt(parts[1], 10);
        const content = parts.slice(2).join(":");

        // Make file path relative to workspace root or search path for readability?
        // Agent usually expects relative paths.
        // Let's try to make it relative to system.root or searchPath.
        let fileRel = fileAbs;
        if (fileAbs.startsWith(this.config.system.root)) {
          fileRel = fileAbs.substring(this.config.system.root.length + 1);
        }

        matches.push({
          file: fileRel,
          line: lineNum,
          content: content.trim(),
        });
      }

      return this.formatSuccess(matches);
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * Move file tool implementation
   */
  private async moveFile(
    from?: Opt<string, Reason.ShapeValidation>,
    to?: Opt<string, Reason.ShapeValidation>,
    overwrite = false,
  ): Promise<IToolResult> {
    try {
      if (from === undefined || to === undefined) {
        return {
          success: false,
          error:
            "move_file requires 'from' and 'to' string params — the retired {source, destination} shape is no longer accepted",
        };
      }

      const resolvedFrom = await this.resolvePath(from);
      const resolvedTo = await this.resolvePath(to);

      if (!overwrite) {
        try {
          await Deno.stat(resolvedTo);
          return {
            success: false,
            error: `Destination file '${to}' already exists (overwrite=false)`,
          };
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }

      // Ensure parent directory exists for destination
      const parentDir = join(resolvedTo, "..");
      await Deno.mkdir(parentDir, { recursive: true });

      await Deno.rename(resolvedFrom, resolvedTo);
      return this.formatSuccess({ from, to });
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * Copy file tool implementation
   */
  private async copyFile(source: string, destination: string, overwrite = false): Promise<IToolResult> {
    try {
      const resolvedSource = await this.resolvePath(source);
      const resolvedDest = await this.resolvePath(destination);

      if (!overwrite) {
        try {
          await Deno.stat(resolvedDest);
          return {
            success: false,
            error: `Destination file '${destination}' already exists (overwrite=false)`,
          };
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }

      // Ensure parent directory exists for destination
      const parentDir = join(resolvedDest, "..");
      await Deno.mkdir(parentDir, { recursive: true });

      await Deno.copyFile(resolvedSource, resolvedDest);
      return this.formatSuccess({ source, destination });
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * Delete file tool implementation
   */
  private async deleteFile(path: string): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(path);
      await Deno.remove(resolvedPath);
      return this.formatSuccess({ path });
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * Git Info tool implementation
   */
  private async gitInfo(
    repoPath: string,
    scope: string = "status",
  ): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(repoPath);

      // Verify it's a directory
      const stat = await Deno.stat(resolvedPath);
      if (!stat.isDirectory) {
        return { success: false, error: `Path '${repoPath}' is not a directory` };
      }

      // Use git service when available for git operations
      if (this.gitServiceFactory) {
        return await this.runGitInfoViaService(resolvedPath, repoPath, scope);
      }

      // Fallback: run git commands directly
      return await this.runGitInfoDirect(resolvedPath, repoPath, scope);
    } catch (error) {
      return this.formatError(error);
    }
  }

  private async runGitInfoViaService(
    resolvedPath: string,
    repoPath: string,
    scope: string,
  ): Promise<IToolResult> {
    const service = this.gitServiceFactory!.createGitService(
      resolvedPath,
      this.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID,
    );

    const checkResult = await service.runGitCommand(["rev-parse", "--is-inside-work-tree"], { throwOnError: false });
    if (checkResult.exitCode !== 0) {
      return { success: false, error: `Not a git repository: ${repoPath}` };
    }

    const { args, outputParser } = this.resolveGitArgs(scope);
    if (!args) {
      return { success: false, error: `Invalid scope: ${scope}` };
    }

    const result = await service.runGitCommand(args, { throwOnError: false });
    if (result.exitCode !== 0) {
      return { success: false, error: `Git command failed: ${result.output}` };
    }
    return this.formatSuccess(outputParser(result.output));
  }

  private async runGitInfoDirect(
    resolvedPath: string,
    repoPath: string,
    scope: string,
  ): Promise<IToolResult> {
    const checkCmd = new Deno.Command("git", {
      args: ["rev-parse", "--is-inside-work-tree"],
      cwd: resolvedPath,
      stderr: "piped",
    });
    const checkOutput = await checkCmd.output();
    if (checkOutput.code !== 0) {
      return { success: false, error: `Not a git repository: ${repoPath}` };
    }

    const { args, outputParser } = this.resolveGitArgs(scope);
    if (!args) {
      return { success: false, error: `Invalid scope: ${scope}` };
    }

    const cmd = new Deno.Command("git", {
      args,
      cwd: resolvedPath,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await cmd.output();
    if (code !== 0) {
      const errorOutput = new TextDecoder().decode(stderr);
      return { success: false, error: `Git command failed: ${errorOutput}` };
    }

    const textOutput = new TextDecoder().decode(stdout);
    return this.formatSuccess(outputParser(textOutput));
  }

  private resolveGitArgs(scope: string): { args: string[] | null; outputParser: (output: string) => JSONValue } {
    const defaultParser: (output: string) => JSONValue = (o) => o.trim();

    switch (scope) {
      case "status":
        return {
          args: ["status", "--porcelain"],
          outputParser: (output) => {
            const lines = output.split("\n").filter(Boolean);
            return lines.map((line) => {
              const status = line.substring(0, 2);
              const file = line.substring(3);
              return { status, file };
            });
          },
        };
      case "branch":
        return { args: ["branch", "--show-current"], outputParser: defaultParser };
      case "diff_summary":
        return { args: ["diff", "--stat"], outputParser: defaultParser };
      default:
        return { args: null, outputParser: defaultParser };
    }
  }

  /**
   * Deno task tool implementation
   */
  private async denoTask(
    task: string,
    path?: Opt<string, Reason.SensibleDefault>,
    args: string[] = [],
  ): Promise<IToolResult> {
    try {
      const allowedTasks = ["test", "lint", "fmt", "check"];
      if (!allowedTasks.includes(task)) {
        return { success: false, error: `Invalid task: ${task}. Allowed tasks: ${allowedTasks.join(", ")}` };
      }

      const resolvedPath = path ? await this.resolvePath(path) : this.baseDir;

      // Validate extra args for security?
      // args like "--allow-all" might be dangerous?
      // Ideally we should adhere to whitelist or safe flags, but for dev tasks it's usually less critical
      // as long as we don't allow arbitary shell injection (which Deno.Command prevents).
      // However, we should prevent command chaining or redirection if Deno.Command allows it via args? No, it doesn't.

      const cmdArgs = [task];

      // Some tasks like lint/fmt/test take path as argument, usually at the end
      // We pass it explicitly.

      // Add user args first (flags)
      if (args && args.length > 0) {
        cmdArgs.push(...args);
      }

      // Add path
      cmdArgs.push(resolvedPath);

      const cmd = new Deno.Command(SystemCommand.DENO, {});

      const { code, stdout, stderr } = await cmd.output();
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (code !== 0) {
        // for lint/test, non-zero exit code usually means violations/failures, which is "success" in terms of running the tool,
        // but might be considered error. However, providing the output is useful.
        // We'll return success: true (or false?) but with data containing the output.
        // Standard convention: if tool failed to run, error. If tool ran but found issues, success: true + data.
        // But let's follow return structure. If code!=0, typically `run_command` returns error.
        // But for test/lint, we want to see the failures.
        return {
          success: false, // Mark as false so agent knows something is wrong
          error: `Task '${task}' failed with exit code ${code}:\n${output}\n${errorOutput}`,
          data: { output, errorOutput, exitCode: code },
        };
      }

      return this.formatSuccess({
        output,
        errorOutput,
        exitCode: code,
      });
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * Patch file tool implementation
   */
  private async patchFile(
    path: string,
    search: Opt<string, Reason.ShapeValidation>,
    replace: Opt<string, Reason.ShapeValidation>,
  ): Promise<IToolResult> {
    try {
      if (search === undefined || replace === undefined) {
        return {
          success: false,
          error:
            "patch_file requires 'search' and 'replace' string params — the retired {patches: [...]} array shape is no longer accepted",
        };
      }

      const resolvedPath = await this.resolvePath(path);
      const content = await Deno.readTextFile(resolvedPath);

      // Exact-one-occurrence match, mirroring the live MCP handler
      // (packages-team/mcp-server/handlers/patch_file_tool.ts): fails loudly if the search
      // string is absent or ambiguous rather than silently patching the first occurrence.
      const segments = content.split(search);
      const occurrences = segments.length - 1;
      if (occurrences === 0) {
        return {
          success: false,
          error: `Search string not found in file: ${search.substring(0, 50)}...`,
        };
      }
      if (occurrences > 1) {
        return {
          success: false,
          error: `Search string matches ${occurrences} times in file (ambiguous — must match exactly once): ${
            search.substring(0, 50)
          }...`,
        };
      }

      // Array.prototype.join writes replacement literally without interpreting substitution patterns.
      const patched = segments.join(replace);
      await Deno.writeTextFile(resolvedPath, patched);
      return this.formatSuccess({ path });
    } catch (error) {
      return this.formatError(error);
    }
  }
}

function createNoopEventLogger(): IEventLogger {
  return {
    log: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => createNoopEventLogger(),
  };
}

function createNoopPipeline<T>(): IMiddlewarePipeline<T> {
  const middlewares: Array<(ctx: T, next: () => Promise<void>) => Promise<void>> = [];
  return {
    use(fn) {
      middlewares.push(fn);
    },
    async execute(ctx, final) {
      let index = 0;
      const next = async () => {
        if (index < middlewares.length) {
          await middlewares[index++](ctx, next);
        } else {
          await final();
        }
      };
      await next();
    },
  };
}
