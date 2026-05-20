/**
 * @module ToolRegistry
 * @path packages/tool-runtime/src/tool_registry.ts
 * @description Central registry for available tools. Maps abstract tool names (e.g., 'read_file')
 * to concrete implementations with security validation and logging.
 * @architectural-layer Services
 * @related-files ["src/services/plan/plan_executor.ts", src/mcp/tools.ts]
 */
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { join, resolve } from "@std/path";
import { expandGlob } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import { PathResolver } from "@exaix/portal";
import {
  ActivityActor,
  BYTES_PER_KB,
  JsonSchemaType,
  LogLevel,
  PORTAL_PREFIX_PATTERN,
  SystemCommand,
  ToolName,
} from "@exaix/core";
import { GIT_CMD_BRANCH, GIT_CMD_REV_PARSE, GIT_CMD_STATUS, GitBranchName } from "@exaix/git";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";
import { type IMiddlewarePipeline, type IPathSecurityOps, PathAccessError, PathTraversalError } from "./types.ts";
import type { JSONValue } from "@exaix/core";
import type {
  IApplicationContext,
  IDatabaseService,
  IServiceContext,
  ITool,
  IToolRegistry,
  IToolResult,
} from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { IToolResultRemediationPolicy } from "@exaix/schemas/tool_result.ts";
import type { IToolResultValidator } from "@exaix/schemas/tool_result_validator.ts";
import {
  applyRemediationPolicy,
  type IRemediationResult,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
} from "@exaix/schemas/tool_result_remediation.ts";
import { lookupRemediationPolicy, lookupRemediationToolMetadata } from "@exaix/mcp";
import { type IValidationReportContext, logValidationResult } from "./tool_validation_reporter.ts";

type RemediationPolicyResolver = (
  toolName: string,
  policy: IToolResultRemediationPolicy,
) => IToolResultRemediationPolicy;

export interface IToolRegistryConfig {
  config: Config;
  db?: IDatabaseService;
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
}

interface IToolContext extends IServiceContext {
  toolName: string;
  params: Record<string, JSONValue>;
  result?: IToolResult;
  toolRegistry: ToolRegistry;
}

// ============================================================================
// Command Whitelist
// ============================================================================

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
  SystemCommand.EXOCTL,
  SystemCommand.GREP,
]);

// ============================================================================
// Argument Validation Functions
// ============================================================================

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
      return validateGitArguments(args);
    case SystemCommand.NPM:
    case SystemCommand.NODE:
    case SystemCommand.DENO:
    case SystemCommand.EXOCTL:
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
 * Validate git command arguments
 */
function validateGitArguments(args: string[]): { valid: boolean; reason?: string } {
  const dangerousGitOptions = [
    "--exec-path",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--config",
    "--config-env",
    "--exec",
    "--html-path",
  ];

  const fullCommand = args.join(" ").toLowerCase();

  // Prohibit destructive operations
  const isDestructive = (fullCommand.includes("reset") && fullCommand.includes("--hard")) ||
    (fullCommand.includes("clean") && (fullCommand.includes("-f") || fullCommand.includes("-d")));

  if (isDestructive) {
    return {
      valid: false,
      reason: `Destructive git operation prohibited: git ${args.join(" ")}`,
    };
  }

  // Protect system branches from direct checkout/modification
  const protectedBranches: string[] = [
    GitBranchName.MAIN,
    GitBranchName.MASTER,
    GitBranchName.DEVELOP,
    GitBranchName.PROD,
    GitBranchName.PRODUCTION,
  ];
  if (args.includes("checkout") || args.includes(GIT_CMD_BRANCH)) {
    if (args.some((arg) => protectedBranches.includes(arg.toLowerCase()))) {
      return {
        valid: false,
        reason: `Operations on protected branches (main, master, etc.) are prohibited for safety.`,
      };
    }
  }

  for (const arg of args) {
    if (dangerousGitOptions.some((option) => arg.startsWith(option))) {
      return {
        valid: false,
        reason: `Dangerous git option not allowed: ${arg}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate runtime command arguments (npm, node, deno, exoctl)
 */
function validateRuntimeArguments(runtime: string, args: string[]): { valid: boolean; reason?: string } {
  // Only allow specific safe subcommands
  const safeSubcommands = ["--version", "--help", "version", "info", "test", "lint", "fmt", "check", "status"];

  if (args.length === 0) return { valid: true }; // Allow bare command

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

// ============================================================================
// ToolRegistry Implementation
// ============================================================================

export class ToolRegistry implements IToolRegistry {
  private config: Config;
  private db?: IDatabaseService;
  private traceId?: string;
  private identityId?: string;
  private pathResolver: PathResolver;
  private tools: Map<string, ITool>;
  private baseDir: string;
  private pipeline: IMiddlewarePipeline<IToolContext>;
  private pathSecurity: IPathSecurityOps;
  private executors: Map<string, (params: Record<string, JSONValue>) => Promise<IToolResult>> = new Map();
  private resultValidator?: IToolResultValidator;
  private validationReportContext?: IValidationReportContext;
  private remediationPolicyResolver?: RemediationPolicyResolver;
  private validationEventLogger?: IEventLogger;

  constructor(
    middlewarePipelineOrOptions?: IMiddlewarePipeline<IToolContext> | IToolRegistryConfig,
    pathSecurity?: IPathSecurityOps,
    options?: IToolRegistryConfig,
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

    this.db = ctx?.db || resolvedOptions?.db;

    this.traceId = resolvedOptions?.traceId ?? "tool-registry";
    this.identityId = resolvedOptions?.identityId ?? DEFAULT_MCP_IDENTITY_ID;
    this.baseDir = resolvedOptions?.baseDir ? resolve(resolvedOptions.baseDir) : resolve(this.config.system.root);

    this.pathResolver = new PathResolver(this.config);
    this.tools = new Map();
    this.pipeline = resolvedPipeline ?? createNoopPipeline<IToolContext>();
    this.pathSecurity = resolvedPathSecurity ?? createDefaultPathSecurity();
    this.resultValidator = resolvedOptions?.resultValidator;
    this.validationReportContext = resolvedOptions?.validationReportContext;
    this.remediationPolicyResolver = resolvedOptions?.remediationPolicyResolver;
    this.validationEventLogger = resolvedOptions?.validationEventLogger ??
      (this.db ? createDbEventLogger(this.db, this.identityId) : undefined);

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
        return; // Stop pipeline
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

  /**
   * Register all core tools
   */
  private registerCoreTools(): void {
    this.tools.set("read_file", {
      name: "read_file",
      description:
        "Return the full text content of a file at the given path. Use when you need to read or analyze file contents; for searching within files use grep_search; for finding files by pattern use search_files. Returns file text as a string in data.content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to read",
          },
        },
        required: ["path"],
      },
    });

    this.tools.set(ToolName.WRITE_FILE, {
      name: ToolName.WRITE_FILE,
      description:
        "Write or overwrite a file with the given content. Use when you need to create or replace a file in full; for targeted in-place edits use patch_file. Returns data.path (resolved absolute path) on success. Fails if path is outside allowed roots.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to write",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
        required: ["path", "content"],
      },
    });

    this.tools.set(ToolName.LIST_DIRECTORY, {
      name: ToolName.LIST_DIRECTORY,
      description:
        "List files and directories at the given path. Use when you need to explore a directory or verify a file exists; for pattern-matching files use search_files. Returns data.entries as an array of { name, isDirectory } objects.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the directory to list",
          },
        },
        required: ["path"],
      },
    });

    this.tools.set(ToolName.SEARCH_FILES, {
      name: ToolName.SEARCH_FILES,
      description:
        "Find files matching a glob pattern (e.g. '**/*.ts') under a directory. Use when you need to locate files by name pattern; for searching file contents use grep_search; for listing all items use list_directory. Returns data.files as an array of absolute file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern to match (e.g., '*.ts', '**/*.md')",
          },
          path: {
            type: "string",
            description: "Directory to search in",
          },
        },
        required: ["pattern", "path"],
      },
    });

    this.tools.set(ToolName.CREATE_DIRECTORY, {
      name: ToolName.CREATE_DIRECTORY,
      description:
        "Create a directory and all required parent directories. Use when you need to ensure a path exists before writing or moving files into it. Returns data.path (resolved absolute path) on success. Fails if path is outside allowed roots.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the directory to create",
          },
        },
        required: ["path"],
      },
    });

    this.tools.set(ToolName.RUN_COMMAND, {
      name: ToolName.RUN_COMMAND,
      description:
        "Execute a whitelisted shell command (git, deno, npm, grep, ls, etc.) with argument validation. Use when you need to run a CLI tool or build script; for git repo inspection use git_info instead. Returns data.output (stdout string) and data.exitCode. Blocked or failed commands return a descriptive error.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Command to execute (must be whitelisted)",
          },
          args: {
            type: JsonSchemaType.ARRAY,
            items: { type: "string" },
            description: "Command arguments",
          },
        },
        required: ["command"],
      },
    });

    this.tools.set(ToolName.FETCH_URL, {
      name: ToolName.FETCH_URL,
      description:
        "Fetch text content from a URL in the configured allowed-domains whitelist. Use when you need to retrieve web content for analysis; only whitelisted domains are accessible. Returns data.content (response text), data.url, and data.format. Fails if the domain is not whitelisted or content exceeds the size limit.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to fetch",
          },
          format: {
            type: "string",
            enum: ["text", "markdown"],
            description: "Output format (default: markdown)",
          },
        },
        required: ["url"],
      },
    });

    this.tools.set(ToolName.GREP_SEARCH, {
      name: ToolName.GREP_SEARCH,
      description:
        "Search files under a directory for a string or regex pattern and return line-level matches. Use for code and text search within the workspace; prefer over read_file when scanning many files for a specific pattern. Returns an array of { file, line, content } match objects up to the configured max_results limit.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex or literal string to search for",
          },
          path: {
            type: "string",
            description: "Root directory to search in (relative to workspace or portal)",
          },
          case_sensitive: {
            type: "boolean",
            description: "Case sensitive search (default: true)",
          },
        },
        required: ["pattern", "path"],
      },
    });

    this.tools.set(ToolName.MOVE_FILE, {
      name: ToolName.MOVE_FILE,
      description:
        "Move or rename a file from source to destination. Use when you need to relocate or rename a file; for duplicating a file without removing the original use copy_file. Returns data.source and data.destination on success. Fails if destination exists and overwrite is false.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Source path" },
          destination: { type: "string", description: "Destination path" },
          overwrite: { type: "boolean", description: "Overwrite existing file (default: false)" },
        },
        required: ["source", "destination"],
      },
    });

    this.tools.set(ToolName.COPY_FILE, {
      name: ToolName.COPY_FILE,
      description:
        "Copy a file from source to destination, leaving the original in place. Use when you need to duplicate a file; for renaming or relocating without keeping the original use move_file. Returns data.source and data.destination on success. Fails if destination exists and overwrite is false.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Source path" },
          destination: { type: "string", description: "Destination path" },
          overwrite: { type: "boolean", description: "Overwrite existing file (default: false)" },
        },
        required: ["source", "destination"],
      },
    });

    this.tools.set("delete_file", {
      name: "delete_file",
      description:
        "Permanently remove a file at the given path. Use when you need to delete a file; this action is irreversible. Returns data.path on success. Fails if the file does not exist or the path is outside allowed roots.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to file to delete" },
        },
        required: ["path"],
      },
    });

    this.tools.set("git_info", {
      name: "git_info",
      description:
        "Retrieve git repository information: working-tree status, current branch name, or diff summary. Use when you need to inspect repo state without running run_command directly; scope 'status' returns changed files, 'branch' returns the branch name, 'diff_summary' returns a diff stat. Returns parsed git output in data.",
      parameters: {
        type: "object",
        properties: {
          repo_path: {
            type: "string",
            description: "Path to git repository root (default: workspace root)",
          },
          scope: {
            type: "string",
            enum: [GIT_CMD_STATUS, GIT_CMD_BRANCH, "diff_summary"],
            description: "Information to retrieve (default: status)",
          },
        },
        required: ["repo_path"],
      },
    });

    this.tools.set("deno_task", {
      name: "deno_task",
      description:
        "Run a standard Deno task (test, lint, fmt, check) at the given path. Use when you need to validate code quality or run tests within an agent strategy; returns output even when the task finds issues. Returns data.output (stdout), data.errorOutput, and data.exitCode.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            enum: ["test", "lint", "fmt", "check"],
            description: "Task to run",
          },
          path: {
            type: "string",
            description: "Target path (file or directory, default: workspace root)",
          },
          args: {
            type: JsonSchemaType.ARRAY,
            items: { type: "string" },
            description: "Additional arguments or flags",
          },
        },
        required: ["task"],
      },
    });

    this.tools.set(ToolName.PATCH_FILE, {
      name: ToolName.PATCH_FILE,
      description:
        "Apply sequential search-and-replace patches to an existing file without full replacement. Use for targeted edits to a file; for complete file replacement use write_file. Returns data.path and data.appliedCount on success. Fails if any search string is not found.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to file to patch",
          },
          patches: {
            type: JsonSchemaType.ARRAY,
            items: {
              type: "object",
              properties: {
                search: { type: "string", description: "String to search for (exact match)" },
                replace: { type: "string", description: "String to replace with" },
              },
              required: ["search", "replace"],
            },
            description: "List of patches to apply sequentially",
          },
        },
        required: ["path", "patches"],
      },
    });
  }

  /**
   * Register all core executors
   */
  private registerCoreExecutors(): void {
    const str = (v: JSONValue): string => (typeof v === "string" ? v : String(v ?? ""));
    const bool = (v: JSONValue): boolean => Boolean(v);
    const strArr = (v: JSONValue): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

    this.executors.set(ToolName.READ_FILE, (p) => this.readFile(str(p.path)));
    this.executors.set(ToolName.WRITE_FILE, (p) => this.writeFile(str(p.path), str(p.content)));
    this.executors.set(ToolName.LIST_DIRECTORY, (p) => this.listDirectory(str(p.path)));
    this.executors.set(ToolName.SEARCH_FILES, (p) => this.searchFiles(str(p.pattern), str(p.path)));
    this.executors.set(ToolName.RUN_COMMAND, (p) => this.runCommand(str(p.command), p.args ? strArr(p.args) : []));
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
      (p) =>
        this.moveFile(str(p.source), str(p.destination), p.overwrite !== undefined ? bool(p.overwrite) : undefined),
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
      (p) => this.patchFile(str(p.path), p.patches as Array<{ search: string; replace: string }>),
    );
  }

  /**
   * Get all registered tools
   */
  getTools(): ITool[] {
    return Array.from(this.tools.values());
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
   * Resolve and validate a path
   * - If path starts with @, use PathResolver (for alias resolution)
   * - Otherwise, validate it's within allowed roots
   */
  private async resolvePath(path: string): Promise<string> {
    // Use PathResolver for alias paths
    if (path.startsWith("@")) {
      return await this.pathResolver.resolve(path);
    }

    // Define allowed roots - RESOLVE TO ABSOLUTE PATHS
    // We must resolve config.system.root to absolute first if receiving relative paths
    // But typically config.system.root should be correct.
    // The issue is mixing relative config paths with absolute Portal paths.
    // We normalize all to absolute here.
    const systemRootAbsolute = await Deno.realPath(this.config.system.root).catch(() =>
      resolve(this.config.system.root)
    );

    const allowedRoots = [
      join(systemRootAbsolute, this.config.paths.workspace),
      join(systemRootAbsolute, this.config.paths.memory),
      join(systemRootAbsolute, this.config.paths.blueprints),
      systemRootAbsolute,
      ...this.config.portals.map((p) => p.target_path),
    ];

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
        this.db?.logActivity(
          ActivityActor.SYSTEM,
          "security.path_traversal_attempted",
          path,
          {
            attempted_path: path,
            error: error.message,
            trace_id: this.traceId ?? null,
            identity_id: this.identityId ?? null,
          },
          this.traceId,
          this.identityId,
        );

        throw new Error(`Access denied: Path traversal detected`);
      }

      if (error instanceof PathAccessError) {
        // Log access violation
        this.db?.logActivity(
          ActivityActor.SYSTEM,
          "security.path_access_denied",
          path,
          {
            attempted_path: path,
            resolved_path: error.message.includes("->") ? error.message.split("->")[1]?.trim() : null,
            error: error.message,
            trace_id: this.traceId ?? null,
            identity_id: this.identityId ?? null,
          },
          this.traceId,
          this.identityId,
        );

        const allowedRootsList = allowedRoots.join(", ");
        throw new Error(`Access denied: Path outside allowed directories. Allowed roots: ${allowedRootsList}`);
      }

      // Log generic path resolution errors
      this.db?.logActivity(
        ActivityActor.SYSTEM,
        "path.resolution_error",
        path,
        {
          input_path: path,
          error: error instanceof Error ? error.message : String(error),
          trace_id: this.traceId ?? null,
          identity_id: this.identityId ?? null,
        },
        this.traceId,
        this.identityId,
      );

      throw error;
    }
  }

  /**
   * Run command tool implementation
   */
  public async runCommand(command: string, args: string[]): Promise<IToolResult> {
    try {
      // Check if command is whitelisted
      if (!ALLOWED_COMMANDS.has(command)) {
        return {
          success: false,
          error: `Command '${command}' is not allowed. Allowed commands: ${Array.from(ALLOWED_COMMANDS).join(", ")}`,
        };
      }

      // Validate command arguments for security
      const validation = validateCommandArguments(command, args);
      if (!validation.valid) {
        return {
          success: false,
          error: `Command arguments not allowed: ${validation.reason}`,
        };
      }

      const cmd = new Deno.Command(command, {
        args,
        cwd: this.baseDir,
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
    if (!this.db) return;

    try {
      this.db.logActivity(
        ActivityActor.IDENTITY,
        actionType,
        (payload.params as Record<string, JSONValue>)?.path as string ||
          (payload.params as Record<string, JSONValue>)?.command as string ||
          null,
        payload,
        this.traceId,
        this.identityId,
      );
    } catch (error) {
      console.error("Failed to log tool activity:", error);
    }
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
  private formatError(error: unknown, context?: string): IToolResult {
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
  private async moveFile(source: string, destination: string, overwrite = false): Promise<IToolResult> {
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

      await Deno.rename(resolvedSource, resolvedDest);
      return this.formatSuccess({ source, destination });
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
    scope: string = GIT_CMD_STATUS,
  ): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(repoPath);

      // Verify it's a directory
      const stat = await Deno.stat(resolvedPath);
      if (!stat.isDirectory) {
        return { success: false, error: `Path '${repoPath}' is not a directory` };
      }

      // Check if it's a git repo
      const checkCmd = new Deno.Command("git", {
        args: [GIT_CMD_REV_PARSE, "--is-inside-work-tree"],
        cwd: resolvedPath,
        stderr: "piped",
      });
      const checkOutput = await checkCmd.output();
      if (checkOutput.code !== 0) {
        return { success: false, error: `Not a git repository: ${repoPath}` };
      }

      let args: string[] = [];
      let outputParser: (output: string) => JSONValue = (o) => o.trim();

      switch (scope) {
        case GIT_CMD_STATUS:
          args = [GIT_CMD_STATUS, "--porcelain"];
          outputParser = (output) => {
            const lines = output.split("\n").filter(Boolean);
            return lines.map((line) => {
              const status = line.substring(0, 2);
              const file = line.substring(3);
              return { status, file };
            });
          };
          break;
        case GIT_CMD_BRANCH:
          args = [GIT_CMD_BRANCH, "--show-current"];
          break;
        case "diff_summary":
          args = ["diff", "--stat"];
          break;
        default:
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
    } catch (error) {
      return this.formatError(error);
    }
  }

  /**
   * Deno task tool implementation
   */
  private async denoTask(task: string, path?: string, args: string[] = []): Promise<IToolResult> {
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
  private async patchFile(path: string, patches: Array<{ search: string; replace: string }>): Promise<IToolResult> {
    try {
      const resolvedPath = await this.resolvePath(path);
      let content = await Deno.readTextFile(resolvedPath);
      let appliedCount = 0;

      for (const patch of patches) {
        if (!content.includes(patch.search)) {
          return {
            success: false,
            error: `Search string not found in file: ${patch.search.substring(0, 50)}...`,
          };
        }

        // Replace ONLY the first occurrence to be safe and predictable
        content = content.replace(patch.search, patch.replace);
        appliedCount++;
      }

      await Deno.writeTextFile(resolvedPath, content);
      return this.formatSuccess({ path, appliedCount });
    } catch (error) {
      return this.formatError(error);
    }
  }
}

function createDbEventLogger(db: IDatabaseService, identityId?: string): IEventLogger {
  return {
    log: (event) =>
      db.logActivity(
        ActivityActor.SYSTEM,
        event.action,
        event.target || "",
        event.payload || {},
        event.traceId,
        identityId,
      ),
    info: (action, target, payload, traceId) =>
      db.logActivity(ActivityActor.SYSTEM, action, target || "", payload || {}, traceId, identityId),
    warn: (action, target, payload, traceId) =>
      db.logActivity(ActivityActor.SYSTEM, action, target || "", payload || {}, traceId, identityId),
    error: (action, target, payload, traceId) =>
      db.logActivity(ActivityActor.SYSTEM, action, target || "", payload || {}, traceId, identityId),
    fatal: (action, target, payload, traceId) =>
      db.logActivity(ActivityActor.SYSTEM, action, target || "", payload || {}, traceId, identityId),
    debug: (action, target, payload, traceId) =>
      db.logActivity(ActivityActor.SYSTEM, action, target || "", payload || {}, traceId, identityId),
    child: () => createNoopEventLogger(),
  };
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

function createDefaultPathSecurity(): IPathSecurityOps {
  return {
    async resolveWithinRoots(inputPath: string, allowedRoots: string[], rootDir: string): Promise<string> {
      const normalized = inputPath.replace(/\0/g, "").replace(/\\/g, "/").replace(/\/+/g, "/");
      if (normalized.includes("..")) {
        throw new PathTraversalError(`Path traversal detected: ${inputPath}`);
      }
      const absolutePath = normalized.startsWith("/") ? normalized : join(rootDir, normalized);
      const realPath = absolutePath;
      const isUnderAllowed = allowedRoots.length === 0 ||
        allowedRoots.some((root) => realPath.startsWith(root));
      if (!isUnderAllowed) {
        throw new PathAccessError(`Access denied: ${inputPath} is not within allowed roots`);
      }
      try {
        return await Deno.realPath(absolutePath);
      } catch {
        return absolutePath;
      }
    },
  };
}
