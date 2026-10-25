/**
 * @module ToolRegistry
 * @path packages/tool-runtime/src/tool_registry.ts
 * @description Central registry for available tools. Maps abstract tool names (e.g., 'read_file')
 * to concrete implementations with security validation and logging.
 * @architectural-layer Services
 * @related-files ["packages/core/src/planning/plan_executor.ts", exaix-team/packages/mcp-server/tools.ts]
 */
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { isAbsolute, join, resolve, SEPARATOR } from "@std/path";
import { expandGlob } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import {
  buildChildEnv,
  BYTES_PER_KB,
  DEFAULT_AI_MODEL,
  DEFAULT_DENO_TASK_TOOL_TIMEOUT_MS,
  JsonSchemaType,
  LOG_REDACTION_MIN_CHARS,
  LogLevel,
  MAX_GRAPH_TOOL_DEPTH,
  MAX_GRAPH_TOOL_DOC_TOKENS,
  MAX_GRAPH_TOOL_RESULT_TOKENS,
  MAX_GRAPH_TOOL_RESULTS,
  PORTAL_PREFIX_PATTERN,
  SystemCommand,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
  TOOL_AUTH_ONLY_PARAMS,
  TOOL_PATH_PARAMS,
  ToolCallEntryPoint,
  ToolName,
} from "@exaix/core";
import { DEFAULT_MCP_AGENT_ROLE_ID, type IGitServiceFactory } from "@exaix/core/types";
import { AiTokenEstimatorTokenizer, type ITokenizer, normalizePortalPath, redactKnownSecrets } from "@exaix/core/func";
import {
  type IMiddlewarePipeline,
  type IPathSecurityOps,
  PATH_ACCESS_DENIED_MESSAGE,
  PathAccessError,
  PathTraversalError,
} from "./types.ts";
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
import {
  queryRelationships,
  type RelationshipEdgeKind,
  traverseModuleDependencies,
  whoDependsOn,
} from "@exaix/portal/knowledge";
import type { IPortalKnowledge, ISymbolEntry } from "@exaix/schemas/portal_knowledge.ts";
import type { IToolConfirmationInterceptor } from "@exaix/core/types";
import { createNoopEventLogger, type IEventLogger } from "@exaix/core/logger";
import { DomainEventType, type IToolAliasRewrittenPayload, type IToolParamUnknownPayload } from "@exaix/core/events";
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
import { acceptedParamsFor, canonicalizeForRegistry } from "./tool_call_canonicalizer.ts";
import { createCoreToolSchemas } from "./tool_schemas.ts";
import { runDenoTask } from "./deno_task_runner.ts";

type RemediationPolicyResolver = (
  toolName: string,
  policy: IToolResultRemediationPolicy,
) => IToolResultRemediationPolicy;

export interface IToolRegistryConfig {
  config: Config;
  logger?: IEventLogger;
  traceId?: string;
  agentRole?: string;
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

// Combined whitelist for backward compatibility. The general-purpose runtimes (`deno`, `npm`, `node`) are not run_command-reachable.
// The `deno_task` tool is the agent build and test path. It spawns `deno` directly, so the OS-level `--allow-run=deno` grant remains.
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
  SystemCommand.EXACTL,
  SystemCommand.GREP,
]);

// Argument Validation Functions

/**
 * Validate command arguments for security and safety
 */
function validateCommandArguments(command: string, args: string[]): IArgumentValidation {
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
      // ToolRegistry.runCommand applies the injected GitService validator. It fails closed without one.
      return { valid: true };
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

/** Validates runtime command arguments for the run_command allowlist. Only `exactl` reaches it, because `deno`, `npm` and `node` are not in ALLOWED_COMMANDS.
 *  Only inert subcommands pass, and the whole argument vector is checked. Code-executing subcommands (`test`, `run`, `eval`, `repl`, `task`, `bench`, `exec`, `start`) are rejected.
 *  Any Deno permission flag (`-A` or `--allow-*`) is rejected too. */
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

/** Result of argv validation. `operands` lists the file operands that must resolve within the allowed roots. */
interface IArgumentValidation {
  valid: boolean;
  reason?: string;
  operands?: string[];
}

/** ls options that take no value. Recursive listing is not offered. */
const ALLOWED_LS_OPTIONS: readonly string[] = ["-l", "-a", "-h", "-1", "--color=never"];

/** Validates ls arguments. Every non-option argument is a file operand. */
function validateLsArguments(args: string[]): IArgumentValidation {
  const operands: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("-")) {
      operands.push(arg);
      continue;
    }
    if (!ALLOWED_LS_OPTIONS.includes(arg)) {
      return { valid: false, reason: `Unsafe ls option not allowed: ${arg}` };
    }
  }
  return { valid: true, operands };
}

/** grep short flags that take no value. They may be combined, e.g. `-rn`. */
const GREP_FLAG_CHARS: ReadonlySet<string> = new Set(["i", "v", "n", "c", "l", "r", "E", "F"]);
/** grep context options. Their value is a line count. */
const GREP_CONTEXT_OPTIONS: readonly string[] = ["-A", "-B", "-C"];
const GREP_PATTERN_OPTION = "-e";
const GREP_ATTACHED_CONTEXT_PATTERN = /^-[ABC]\d+$/;
const DIGITS_PATTERN = /^\d+$/;

/** Validates grep arguments against a closed grammar and returns its file operands.
 *  The first positional is the pattern unless `-e` supplies it. Long options are rejected. */
function validateGrepArguments(args: string[]): IArgumentValidation {
  const positionals: string[] = [];
  let hasPatternOption = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    if (arg === GREP_PATTERN_OPTION || GREP_CONTEXT_OPTIONS.includes(arg)) {
      const value = args[++index];
      if (value === undefined) return { valid: false, reason: `grep option needs a value, not allowed: ${arg}` };
      if (arg === GREP_PATTERN_OPTION) hasPatternOption = true;
      else if (!DIGITS_PATTERN.test(value)) return { valid: false, reason: `grep ${arg} value not allowed` };
      continue;
    }
    if (GREP_ATTACHED_CONTEXT_PATTERN.test(arg)) continue;
    if ([...arg.slice(1)].every((char) => GREP_FLAG_CHARS.has(char))) continue;
    return { valid: false, reason: `Unsafe grep option not allowed: ${arg}` };
  }
  return { valid: true, operands: hasPatternOption ? positionals : positionals.slice(1) };
}

/** The deno subcommands run_deno_task may run. */
const DENO_TASK_ALLOWED_TASKS: readonly string[] = ["test", "lint", "fmt", "check"];

/** Inert flags per task. Permission, config, preload and import-map flags are never listed. */
const DENO_TASK_ALLOWED_FLAGS: Readonly<Record<string, readonly string[]>> = {
  test: ["--fail-fast", "--quiet", "--parallel"],
  lint: ["--json", "--compact", "--quiet"],
  fmt: ["--check", "--quiet"],
  check: ["--quiet"],
};

/** Flags that carry a value. They must use the single-argument `--flag=value` form. */
const DENO_TASK_ALLOWED_VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  test: ["--filter"],
};

/** Validates run_deno_task arguments against the per-task allowlist.
 *  Every argument must be an allowlisted flag. Extra operands are rejected. */
function validateDenoTaskArguments(task: string, args: string[]): { valid: boolean; reason?: string } {
  const flags = DENO_TASK_ALLOWED_FLAGS[task] ?? [];
  const valueFlags = DENO_TASK_ALLOWED_VALUE_FLAGS[task] ?? [];
  for (const arg of args) {
    const name = arg.split("=")[0];
    const isFlag = flags.includes(arg);
    const isValueFlag = valueFlags.includes(name) && arg.length > name.length + 1;
    if (!isFlag && !isValueFlag) {
      return { valid: false, reason: `Task argument not allowed: ${arg}` };
    }
  }
  return { valid: true };
}

/** The journaled view of tool params. Path params keep their value. Every other param keeps only its kind and size. */
function summarizeToolParams(params: Record<string, JSONValue>): Record<string, JSONValue> {
  const summary: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (TOOL_PATH_PARAMS.includes(key) && typeof value === "string") summary[key] = value;
    else if (typeof value === "string") summary[key] = { type: JsonSchemaType.STRING, chars: value.length };
    else if (Array.isArray(value)) summary[key] = { type: JsonSchemaType.ARRAY, items: value.length };
    else summary[key] = { type: value === null ? JsonSchemaType.NULL : typeof value };
  }
  return summary;
}

/** Removes every non-path string param value, including array items, from an error before it is logged. */
function redactParamValues(error: string, params: Record<string, JSONValue>): string {
  const values = Object.entries(params)
    .filter(([key]) => !TOOL_PATH_PARAMS.includes(key))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && value.length >= LOG_REDACTION_MIN_CHARS);
  return redactKnownSecrets(error, values).text;
}

// ToolRegistry Implementation

/** Converts a tool-result value into a JSONValue with a JSON round-trip, once at the registry boundary.
 *  Tool handlers build typed objects that are not assignable to JSONValue. */
function toJsonValue<T>(value: T): JSONValue {
  return JSON.parse(JSON.stringify(value) ?? "null") as JSONValue;
}

export class ToolRegistry implements IToolRegistry {
  private config: Config;
  private logger?: IEventLogger;
  private traceId?: string;
  private agentRole?: string;
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
  /** Bounds query_symbols/get_module_dependencies results to MAX_GRAPH_TOOL_RESULT_TOKENS. */
  private readonly graphToolTokenizer: ITokenizer = new AiTokenEstimatorTokenizer();

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
    this.agentRole = resolvedOptions?.agentRole ?? DEFAULT_MCP_AGENT_ROLE_ID;
    this.baseDir = resolvedOptions?.baseDir ? resolve(resolvedOptions.baseDir) : resolve(this.config.system.root);

    this.pathResolver = resolvedOptions?.pathResolver;
    this.gitServiceFactory = resolvedOptions?.gitServiceFactory ?? ctx?.gitServiceFactory;
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

    // HITL confirmation middleware: per-action governance.
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

    // Logging Middleware. It logs a param summary, never raw values, because params can carry secrets.
    this.pipeline.use(async (ctx, next) => {
      const startTime = Date.now();
      try {
        await next();
        const error = ctx.result?.error;
        this.logActivity(`tool.${ctx.toolName}`, ctx.params, {
          success: ctx.result?.success ?? false,
          duration_ms: Date.now() - startTime,
          params: summarizeToolParams(ctx.params),
          error: error ? redactParamValues(error, ctx.params) : null,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logActivity(`tool.${ctx.toolName}`, ctx.params, {
          success: false,
          duration_ms: Date.now() - startTime,
          params: summarizeToolParams(ctx.params),
          error: redactParamValues(errorMsg, ctx.params),
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
      args: params,
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
      ToolName.QUERY_SYMBOL_REFERENCES,
      (p) => this.querySymbolReferencesTool(str(p.symbol), optStr(p.direction), optStr(p.limit)),
    );
    this.executors.set(
      ToolName.REMEMBER_FACT,
      (p) => this.rememberFactTool(str(p.content), p.tags ? strArr(p.tags) : undefined),
    );
    this.executors.set(
      ToolName.SEARCH_MEMORY,
      (p) => this.searchMemoryTool(str(p.query), p.limit !== undefined ? Number(p.limit) : undefined),
    );
    this.executors.set(ToolName.LIST_AVAILABLE_TOOLS, () => this.listAvailableToolsTool());
    this.registerGraphToolExecutors(str, optStr);
  }

  /** Read-only AST graph tools, split out of registerCoreExecutors to keep it under the
   *  complexity threshold. */
  private registerGraphToolExecutors(
    str: (v: JSONValue) => string,
    optStr: (v: JSONValue) => string | undefined,
  ): void {
    this.executors.set(
      ToolName.QUERY_SYMBOLS,
      (p) =>
        this.querySymbolsTool(
          optStr(p.name),
          optStr(p.kind),
          optStr(p.file),
          p.limit !== undefined ? Number(p.limit) : undefined,
        ),
    );
    this.executors.set(
      ToolName.GET_MODULE_DEPENDENCIES,
      (p) => this.getModuleDependenciesTool(str(p.path), p.depth !== undefined ? Number(p.depth) : undefined),
    );
  }

  /**
   * Get all registered tools
   */
  getTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  /** The resolved absolute directory every tool call is rooted at.
   *  It is the `baseDir` constructor option when given, else config.system.root.
   *  A caller can bypass ToolRegistry.execute() for its own file operations. CliDelegateStrategy does this. */
  getBaseDir(): string {
    return this.baseDir;
  }

  /** Sets the per-blueprint HITL rules that the HITL middleware checks on every later `execute()` call. They replace any rules passed at construction.
   *  AgentComposer.executeStep() calls it after loading the blueprint. See `IToolRegistry.setHitlBlueprintRules` for why it is a setter. */
  setHitlBlueprintRules(rules: HitlRule[]): void {
    this.hitlBlueprintRules = rules;
  }

  /**
   * Execute a tool by name
   */
  async execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    const call = canonicalizeForRegistry(this, toolName, params);
    toolName = call.name;
    params = call.params;
    if (call.rewritten) {
      const payload: IToolAliasRewrittenPayload = {
        requestedName: call.requestedName,
        canonicalName: call.name,
        renamedParams: [...call.renamedParams],
        droppedParams: [...call.droppedParams],
        entryPoint: ToolCallEntryPoint.REGISTRY,
      };
      await this.logger?.info(DomainEventType.ToolAliasRewritten, toolName, { ...payload }, this.traceId);
    }
    const parameterError = await this.validateKnownParams(toolName, params);
    if (parameterError) return { success: false, error: parameterError };

    const context: IToolContext = {
      toolName,
      params,
      toolRegistry: this,
      traceId: this.traceId,
      agentRole: this.agentRole,
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
        toJsonValue(context.result),
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
                return toJsonValue(retryResult);
              },
              toolMetadata: remediationMetadata,
            },
          );

          await this.reportValidationOutcome(toolName, remediationPolicy, remediationResult);

          if (remediationResult.outcome === "passed") {
            const remediated = remediationResult.remediatedResult;
            if (remediated === null || typeof remediated !== "object" || Array.isArray(remediated)) {
              return { success: false, error: "Remediation produced a non-object result" };
            }
            const envelope = remediated as { [key: string]: JSONValue };
            return {
              success: envelope.success === true,
              data: envelope.data,
              error: typeof envelope.error === "string" ? envelope.error : undefined,
            };
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

  /** Journal unknown keys before middleware. Strict mode rejects them before any side effect. */
  private async validateKnownParams(toolName: string, params: Record<string, JSONValue>): Promise<string | undefined> {
    const accepted = acceptedParamsFor(this, toolName);
    if (!accepted) return undefined;
    const unknownParams = Object.keys(params).filter((key) =>
      !accepted.has(key) && !TOOL_AUTH_ONLY_PARAMS.some((authKey) => authKey === key)
    );
    if (unknownParams.length === 0) return undefined;
    const configDbStrict = this.applicationContext?.configAdapter?.getOverride<boolean>?.("tools.strict_params");
    const strict = typeof configDbStrict === "boolean"
      ? configDbStrict
      : (this.applicationContext?.config.get() ?? this.config).tools?.strict_params ?? false;
    const payload: IToolParamUnknownPayload = { tool: toolName, unknownParams, acceptedParams: [...accepted], strict };
    await this.logger?.info(DomainEventType.ToolParamUnknown, toolName, { ...payload }, this.traceId);
    return strict
      ? `Unknown parameter(s) [${unknownParams.join(", ")}] for tool '${toolName}'; accepted: [${
        [...accepted].join(", ")
      }]`
      : undefined;
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
    return this.formatSuccess(
      toJsonValue(queryRelationships(knowledge, this.stripPortalQualifier(from), kind)),
    );
  }

  /** Captures a lightweight execution-scoped note into the per-trace execution memory store; traceId is the registry's own, never agent-supplied. */
  private rememberFactTool(content: string, tags?: Opt<string[], Reason.OptionalInput>): Promise<IToolResult> {
    if (content.trim().length === 0) {
      return Promise.resolve({ success: false, error: "remember_fact requires non-empty content" });
    }
    const store = this.applicationContext?.executionMemoryStore;
    if (!store) {
      return Promise.resolve({
        success: false,
        error: "remember_fact requires an execution memory store, none is configured",
      });
    }
    return store.appendNote(this.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID, content, tags);
  }

  /** Scoped to the current portal via `currentPortal()` — no caller-supplied portal argument
   *  is ever honored, matching queryRelationshipsTool/whoDependsOnTool's own scoping. */
  private async searchMemoryTool(query: string, limit?: Opt<number, Reason.OptionalInput>): Promise<IToolResult> {
    const memoryService = this.applicationContext?.memory;
    if (!memoryService) {
      return { success: false, error: "search_memory requires a memory service, none is configured" };
    }
    const portal = this.currentPortal();
    const results = await memoryService.search(query, { portal: portal?.alias, limit });
    return this.formatSuccess(toJsonValue(results));
  }

  /** Read-only discovery: returns the registered tools with their description and parameter schema.
   *  A model selects a tool by what it does. With `cli_delegate.tool_exposure` set to "shell_only", the catalog collapses to `run_command`.
   *  That is the only tool the CLI provider exposes. */
  private listAvailableToolsTool(): Promise<IToolResult> {
    const shellOnly = this.config.cli_delegate?.tool_exposure === "shell_only";
    const catalog = Array.from(this.tools.values())
      .filter((t) => !shellOnly || t.name === ToolName.RUN_COMMAND)
      .map((t) => ({
        name: t.name,
        description: t.nativeDescription ?? t.description,
        parameters: t.parameters,
      }));
    return Promise.resolve(this.formatSuccess(toJsonValue(catalog)));
  }

  /** Strips a leading `@<alias>/` portal qualifier from a graph query target. Models prefix endpoints that way,
   *  but the knowledge graph stores portal-relative keys. Without the strip the lookup answers empty and the caller concludes the graph holds nothing. */
  private stripPortalQualifier(target: string): string {
    const portal = this.currentPortal();
    if (!portal) return target;
    const prefix = `@${portal.alias}/`;
    return target.startsWith(prefix) ? target.slice(prefix.length) : target;
  }

  private async whoDependsOnTool(path: string): Promise<IToolResult> {
    const portalKnowledgeService = this.applicationContext?.portalKnowledge;
    if (!portalKnowledgeService) {
      return { success: false, error: "find_dependents requires a portal-knowledge service, none is configured" };
    }
    const portal = this.currentPortal();
    if (!portal) {
      return { success: false, error: "find_dependents: current execution root is not a configured portal" };
    }
    const knowledge = await portalKnowledgeService.getOrAnalyze(portal.alias, portal.path);
    return this.formatSuccess(toJsonValue(whoDependsOn(knowledge, this.stripPortalQualifier(path))));
  }

  /** Lists symbol-level reference edges for the current portal, filtered by kind.
   *  It is read-only and scoped to the current portal, matching the other graph tools. */
  private async querySymbolReferencesTool(
    symbol: string,
    direction?: Opt<string, Reason.QueryFilter>,
    limit?: Opt<string, Reason.QueryFilter>,
  ): Promise<IToolResult> {
    const resolved = await this.resolveGraphToolKnowledge("query_symbol_references");
    if (!("knowledge" in resolved)) return { success: false, error: resolved.error };

    const inbound = direction === "referenced_by";
    const edges = inbound ? whoDependsOn(resolved.knowledge, symbol) : queryRelationships(resolved.knowledge, symbol);
    const symbolEdges = edges.filter((edge) => edge.kind === "symbol_references_symbol");
    const capped = typeof limit === "string" && Number.isSafeInteger(Number(limit))
      ? symbolEdges.slice(0, Number(limit))
      : symbolEdges;

    return this.formatSuccess(toJsonValue(capped));
  }

  /** Model identity for graph-tool token counting: the bare configured model name.
   *  ai-token-estimator's catalog keys are bare names. A provider-prefixed composite such as "claude-cli:claude-haiku-4-5" throws "Unknown model". */
  private graphToolModelId(): string {
    return this.config.ai?.model ?? DEFAULT_AI_MODEL;
  }

  /** Like graphToolTokenizer.countTokens, but never throws. ai-token-estimator rejects model ids outside its catalog.
   *  A bounding utility must not crash the tool call over that. It falls back to the chars-per-token heuristic of TokenCounter. */
  private async safeCountTokens(text: string, modelId: string): Promise<number> {
    try {
      return await this.graphToolTokenizer.countTokens(text, modelId);
    } catch {
      return Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
    }
  }

  /** Binary-search prefix fit, mirroring portal_knowledge_selector.ts's tokenBoundedPrefix —
   *  duplicated locally since tool-runtime cannot import execution/core func internals across
   *  that boundary for a single helper. */
  private async fitToTokenBudget(text: string, maxTokens: number, modelId: string): Promise<string> {
    if (await this.safeCountTokens(text, modelId) <= maxTokens) return text;
    let low = 1;
    let high = text.length;
    let best = "";
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = text.slice(0, mid);
      if (await this.safeCountTokens(candidate, modelId) <= maxTokens) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  /** Drops trailing records until the whole serialized result fits
   *  MAX_GRAPH_TOOL_RESULT_TOKENS. Never breaks JSON — a dropped array element is still
   *  valid JSON. */
  private async boundGraphResult<T>(records: T[]): Promise<{ records: T[]; truncated: boolean }> {
    const modelId = this.graphToolModelId();
    let candidate = records;
    let truncated = false;
    while (candidate.length > 0) {
      const tokens = await this.safeCountTokens(JSON.stringify(candidate), modelId);
      if (tokens <= MAX_GRAPH_TOOL_RESULT_TOKENS) break;
      candidate = candidate.slice(0, -1);
      truncated = true;
    }
    return { records: candidate, truncated };
  }

  /** Shortens each symbol's `doc` field to MAX_GRAPH_TOOL_DOC_TOKENS before the whole-result
   *  budget in boundGraphResult is applied — keeps one oversized doc from crowding out every
   *  other symbol in the result. */
  private async shortenSymbolDocs(
    symbols: ISymbolEntry[],
  ): Promise<{ records: ISymbolEntry[]; truncated: boolean }> {
    const modelId = this.graphToolModelId();
    let truncated = false;
    const records = await Promise.all(symbols.map(async (symbol) => {
      if (!symbol.doc) return symbol;
      const shortDoc = await this.fitToTokenBudget(symbol.doc, MAX_GRAPH_TOOL_DOC_TOKENS, modelId);
      if (shortDoc === symbol.doc) return symbol;
      truncated = true;
      return { ...symbol, doc: shortDoc };
    }));
    return { records, truncated };
  }

  /** Shared portal + cached-knowledge resolution for the read-only graph tools — service
   *  configured, current root is a portal, cache is warm, and the cache matches this portal. */
  private async resolveGraphToolKnowledge(
    toolLabel: string,
  ): Promise<{ knowledge: IPortalKnowledge } | { error: string }> {
    const portalKnowledgeService = this.applicationContext?.portalKnowledge;
    if (!portalKnowledgeService) {
      return { error: `${toolLabel} requires a portal-knowledge service, none is configured` };
    }
    const portal = this.currentPortal();
    if (!portal) {
      return { error: `${toolLabel}: current execution root is not a configured portal` };
    }
    const knowledge = await portalKnowledgeService.loadCachedKnowledge(portal.alias);
    if (!knowledge) {
      return { error: `${toolLabel}: no cached knowledge for this portal — run 'portal analyze' first` };
    }
    if (knowledge.portal !== portal.alias) {
      return { error: `${toolLabel}: cached knowledge portal mismatch` };
    }
    return { knowledge };
  }

  /** Filters symbolMap by name substring/kind/file, then ranks by pageRankScore descending,
   *  then name/file ascending. */
  private rankSymbols(
    symbolMap: ISymbolEntry[],
    name?: Opt<string, Reason.QueryFilter>,
    kind?: Opt<string, Reason.QueryFilter>,
    file?: Opt<string, Reason.QueryFilter>,
  ): ISymbolEntry[] {
    const nameLower = name?.toLowerCase();
    return symbolMap
      .filter((symbol) =>
        (nameLower === undefined || symbol.name.toLowerCase().includes(nameLower)) &&
        (kind === undefined || symbol.kind === kind) &&
        (file === undefined || symbol.file === file)
      )
      .sort((a, b) => {
        const scoreDiff = (b.pageRankScore ?? 0) - (a.pageRankScore ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return a.name === b.name ? a.file.localeCompare(b.file) : a.name.localeCompare(b.name);
      });
  }

  private async querySymbolsTool(
    name?: Opt<string, Reason.QueryFilter>,
    kind?: Opt<string, Reason.QueryFilter>,
    file?: Opt<string, Reason.QueryFilter>,
    limit?: Opt<number, Reason.QueryFilter>,
  ): Promise<IToolResult> {
    let normalizedFile: string | undefined;
    if (file !== undefined) {
      normalizedFile = normalizePortalPath(file);
      if (!normalizedFile) {
        return { success: false, error: "query_symbols: file must be a portal-relative path with no '..' segments" };
      }
    }
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
      return { success: false, error: "query_symbols: limit must be a positive integer" };
    }
    const resolved = await this.resolveGraphToolKnowledge("query_symbols");
    if (!("knowledge" in resolved)) return { success: false, error: resolved.error };

    const ranked = this.rankSymbols(resolved.knowledge.symbolMap, name, kind, normalizedFile);
    const effectiveLimit = Math.min(limit ?? MAX_GRAPH_TOOL_RESULTS, MAX_GRAPH_TOOL_RESULTS);
    const { records: shortened, truncated: docsShortened } = await this.shortenSymbolDocs(
      ranked.slice(0, effectiveLimit),
    );
    const { records, truncated: recordsDropped } = await this.boundGraphResult(shortened);
    return this.formatSuccess(toJsonValue({ symbols: records, truncated: docsShortened || recordsDropped }));
  }

  /** Validates path/depth before any cache lookup; returns the effective depth or an error. */
  private validateModuleDependenciesArgs(
    path: string,
    depth: Opt<number, Reason.QueryFilter>,
  ): { path: string; depth: number } | { error: string } {
    const normalizedPath = normalizePortalPath(path);
    if (!normalizedPath) {
      return { error: "get_module_dependencies: path must be a non-empty portal-relative path with no '..' segments" };
    }
    const effectiveDepth = depth ?? 1;
    if (!Number.isSafeInteger(effectiveDepth) || effectiveDepth <= 0) {
      return { error: "get_module_dependencies: depth must be a positive integer" };
    }
    if (effectiveDepth > MAX_GRAPH_TOOL_DEPTH) {
      return { error: `get_module_dependencies: depth must not exceed ${MAX_GRAPH_TOOL_DEPTH}` };
    }
    return { path: normalizedPath, depth: effectiveDepth };
  }

  private async getModuleDependenciesTool(
    path: string,
    depth?: Opt<number, Reason.QueryFilter>,
  ): Promise<IToolResult> {
    const validated = this.validateModuleDependenciesArgs(path, depth);
    if (!("path" in validated)) return { success: false, error: validated.error };

    const resolved = await this.resolveGraphToolKnowledge("get_module_dependencies");
    if (!("knowledge" in resolved)) return { success: false, error: resolved.error };

    const edges = traverseModuleDependencies(resolved.knowledge, validated.path, validated.depth)
      .slice(0, MAX_GRAPH_TOOL_RESULTS);
    const { records, truncated } = await this.boundGraphResult(edges);
    return this.formatSuccess(toJsonValue({ edges: records, truncated }));
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

      // A pattern may only descend from the search root; `..` or an absolute prefix would
      // make join() glob above it and list files the root never contained.
      if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
        throw new Error("Access denied: Path traversal detected");
      }
      const globPattern = join(resolvedPath, pattern);

      for await (const entry of expandGlob(globPattern)) {
        if (entry.isFile && entry.path.startsWith(resolvedPath + SEPARATOR)) {
          files.push(entry.path);
        }
      }

      return this.formatSuccess({ files });
    } catch (error) {
      return this.formatError(error);
    }
  }

  /** The absolute roots a tool may operate within.
   *  The roots are the system root's workspace, memory and blueprint dirs, the root itself, and each configured portal.
   *  It validates both resolved file paths and run_command cwd. */
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

  /** A `baseDir` other than config.system.root means a specific execution root.
   *  Such a root is a plan's git worktree, for example.
   *  It mirrors the guard in resolveAuditPortalPath in agent_composer.ts. */
  private hasExplicitExecutionRoot(): boolean {
    return this.baseDir !== resolve(this.config.system.root);
  }

  /** Splits a `@<alias>/<relativePath>` string into the bare alias (no `@`) and the remainder. Mirrors PathResolver.resolve's parsing. */
  private parseAliasPath(path: string): { alias: string; relativePath: string } {
    const parts = path.split("/");
    return { alias: parts[0].slice(1), relativePath: parts.slice(1).join("/") };
  }

  /** Resolves and validates a path. A path starting with @ that names this registry's own portal, with a worktree baseDir active, resolves against baseDir.
   *  Any other alias goes to the injected pathResolver, which resolves a portal alias to its live target_path.
   *  A bare path validates within the allowed roots, rooted at baseDir. */
  private async resolvePath(path: string): Promise<string> {
    if (path.startsWith("@")) {
      const { alias, relativePath } = this.parseAliasPath(path);
      const portalConfig = this.config.portals.find((p) => p.alias === alias);
      // Resolve into baseDir only when the portal's target_path matches baseDir, which is the registry's own portal under a worktree.
      // A worktree-cloned portal then isolates its writes without capturing unrelated portals.
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
          agent_role: this.agentRole ?? null,
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
          resolved_path: error.resolvedPath ?? null,
          allowed_roots: allowedRoots.join(", "),
          error: error.message,
          trace_id: this.traceId ?? null,
          agent_role: this.agentRole ?? null,
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
        agent_role: this.agentRole ?? null,
      };
      if (this.logger) {
        void this.logger.warn(DomainEventType.PathResolutionError, path, payload, this.traceId);
      }

      throw error;
    }
  }

  /** Run command tool implementation. A provided `cwd` must lie within the allowed roots, such as the authorized portal, before the command spawns there.
   *  Without a `cwd` the command runs in baseDir. */
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
      if (validation.valid && command === SystemCommand.GIT) {
        validation = this.validateGitArgs(args);
      }
      if (!validation.valid) {
        return {
          success: false,
          error: `Command arguments not allowed: ${validation.reason}`,
        };
      }

      const allowedRoots = await this.getAllowedRoots();
      let workingDir = this.baseDir;
      if (cwd !== undefined) {
        try {
          workingDir = await this.pathSecurity.resolveWithinRoots(cwd, allowedRoots, this.baseDir);
        } catch {
          return {
            success: false,
            error: `Command working directory is not allowed: it must be within an authorized root`,
          };
        }
      }

      if (!(await this.operandsWithinRoots(validation.operands ?? [], allowedRoots, workingDir))) {
        return {
          success: false,
          error: "Command arguments not allowed: a file operand is outside the authorized roots",
        };
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

  /** Validates git argv with the injected GitService. Without a validator every git command is rejected. */
  private validateGitArgs(args: string[]): IArgumentValidation {
    if (!this.gitServiceFactory) {
      return { valid: false, reason: "git argument validation is unavailable" };
    }
    const service = this.gitServiceFactory.createGitService(
      this.baseDir,
      this.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID,
    );
    return service.validateArgs(args);
  }

  /** True when every file operand resolves, through symlinks, within the allowed roots. */
  private async operandsWithinRoots(operands: string[], allowedRoots: string[], workingDir: string): Promise<boolean> {
    for (const operand of operands) {
      try {
        await this.pathSecurity.resolveWithinRoots(operand, allowedRoots, workingDir);
      } catch {
        return false;
      }
    }
    return true;
  }

  /** Logs one tool call. The target is the path param, or the command when it is on the allowlist. */
  private logActivity(actionType: string, params: Record<string, JSONValue>, payload: Record<string, JSONValue>): void {
    if (!this.logger) return;
    const command = typeof params.command === "string" && ALLOWED_COMMANDS.has(params.command) ? params.command : null;
    const target = (typeof params.path === "string" && params.path) || command;
    void this.logger.info(actionType, target, payload, this.traceId);
  }

  /** Formats a successful tool result. */
  private formatSuccess(data: JSONValue): IToolResult {
    return {
      success: true,
      data,
    };
  }

  /** Formats a tool error result. */
  private formatError<T>(error: T, context?: Opt<string, Reason.OptionalContext>): IToolResult {
    const normalizedError = error instanceof Error ? error : String(error);

    // Path security errors get the generic denial. It never names the resolved host path.
    if (
      normalizedError instanceof PathAccessError ||
      (normalizedError instanceof Error && normalizedError.message.includes("outside allowed roots"))
    ) {
      return {
        success: false,
        error: PATH_ACCESS_DENIED_MESSAGE,
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

        // Basic text output: raw HTML or text, with no markdown converter yet.
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
      // Keep the existing configuration keys when the tool name changes.
      const excludeDirs = this.config.tools?.grep_search?.exclude_dirs || [".git", "node_modules", "dist", "coverage"];
      for (const dir of excludeDirs) {
        args.push(`--exclude-dir=${dir}`);
      }

      // grep has no global max count (`-m` is per file), so the output parsing enforces max_results.
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
      if (!DENO_TASK_ALLOWED_TASKS.includes(task)) {
        return {
          success: false,
          error: `Invalid task: ${task}. Allowed tasks: ${DENO_TASK_ALLOWED_TASKS.join(", ")}`,
        };
      }

      const validation = validateDenoTaskArguments(task, args);
      if (!validation.valid) {
        return { success: false, error: validation.reason };
      }

      const resolvedPath = path ? await this.resolvePath(path) : this.baseDir;
      const { env, clearEnv } = buildChildEnv({ mode: "allowlist" });

      const outcome = await runDenoTask({
        task,
        args,
        absPath: resolvedPath,
        cwd: this.baseDir,
        timeoutMs: DEFAULT_DENO_TASK_TOOL_TIMEOUT_MS,
        env,
        clearEnv,
      });

      switch (outcome.kind) {
        case "exited":
          if (outcome.code !== 0) {
            return {
              success: false,
              error: `Task '${task}' failed with exit code ${outcome.code}:\n${outcome.stdout}\n${outcome.stderr}`,
              data: { output: outcome.stdout, errorOutput: outcome.stderr, exitCode: outcome.code },
            };
          }

          return this.formatSuccess({
            output: outcome.stdout,
            errorOutput: outcome.stderr,
            exitCode: outcome.code,
          });
        case "timed_out":
          return {
            success: false,
            error: `Task '${task}' timed out after ${DEFAULT_DENO_TASK_TOOL_TIMEOUT_MS}ms`,
          };
        case "spawn_failed":
          return {
            success: false,
            error: `Task '${task}' failed to start: ${outcome.error_class}`,
          };
      }
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
      // (exaix-team/packages/mcp-server/handlers/patch_file_tool.ts): fails loudly if the search
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
