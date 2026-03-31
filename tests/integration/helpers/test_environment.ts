/**
 * @module IntegrationTestEnvironment
 * @path tests/integration/helpers/test_environment.ts
 * @description Provides a comprehensive orchestration layer for isolated E2E
 * integration tests, including workspace setup, Git mock repositories, and DB initialization.
 */

import type { IRecordedResponse } from "../../../src/ai/providers/mock_llm_provider.ts";
/**
 * Test Environment Helper for Integration Tests
 *
 * Provides isolated, reproducible test workspace for end-to-end testing.
 * Creates temporary directory with complete Exaix workspace structure.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../../helpers/test_helpers.ts";
import type { ICliApplicationContext } from "../../../src/cli/cli_context.ts";
import { copySync, ensureDir, exists } from "@std/fs";
import { DatabaseService } from "../../../src/services/core/db.ts";
import { initTestDbService } from "../../helpers/db.ts";
import type { Config } from "../../../src/shared/schemas/config.ts";
import { MockLLMProvider } from "../../../src/ai/providers/mock_llm_provider.ts";
import {
  FlowStepType,
  McpToolName,
  MemoryOperation,
  MockStrategy,
  PortalOperation,
} from "../../../src/shared/enums.ts";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import { IApplicationContext } from "../../../src/shared/interfaces/i_application_context.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { ExecutionLoop } from "../../../src/services/agent/execution_loop.ts";
import {
  getBlueprintsIdentitiesDir,
  getMemoryDir,
  getMemoryExecutionDir,
  getMemoryProjectsDir,
  getMemoryTasksDir,
  getPortalsDir,
  getRuntimeDir,
  getWorkspaceActiveDir,
  getWorkspaceArchiveDir,
  getWorkspacePlansDir,
  getWorkspaceRejectedDir,
  getWorkspaceRequestsDir,
} from "../../helpers/paths_helper.ts";
import { setupGitRepo } from "../../helpers/git_test_helper.ts";

export interface ITestEnvironmentOptions {
  /** Custom config overrides */
  configOverrides?: Partial<Config>;
  /** Whether to initialize git repository */
  initGit?: boolean;
}

export interface ActionParams {
  path?: string;
  content?: string;
  [field: string]: string | number | boolean | undefined;
}

interface IRequestCreationOptions {
  traceId?: string;
  identityId?: string;
  priority?: number;
  tags?: string[];
  portal?: string;
  targetBranch?: string;
}

interface IRequestBaseOptions extends IRequestCreationOptions {
  flowId?: string;
  contentPrefix: string;
}

export class TestEnvironment {
  readonly tempDir: string;
  readonly config: Config;
  readonly db: DatabaseService;
  private readonly _dbCleanup?: () => Promise<void>;

  private constructor(
    tempDir: string,
    config: Config,
    db: DatabaseService,
    cleanup?: () => Promise<void>,
  ) {
    this.tempDir = tempDir;
    this.config = config;
    this.db = db;
    this._dbCleanup = cleanup;
  }

  /**
   * Get ICliApplicationContext for this environment
   */
  getContext(): ICliApplicationContext {
    return {
      config: createStubConfig(this.config),
      db: this.db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(this.db),
    };
  }

  /**
   * Create a new isolated test environment
   */
  static async create(options: ITestEnvironmentOptions = {}): Promise<TestEnvironment> {
    // Use centralized test DB + tempdir helper for consistency
    const { db, tempDir, config, cleanup } = await initTestDbService();

    // Create any additional directory structure required for integration tests
    await ensureDir(getWorkspaceRequestsDir(tempDir));
    await ensureDir(getWorkspacePlansDir(tempDir));
    await ensureDir(getWorkspaceRejectedDir(tempDir));
    await ensureDir(getWorkspaceActiveDir(tempDir));
    await ensureDir(getWorkspaceArchiveDir(tempDir));
    await ensureDir(getMemoryExecutionDir(tempDir));
    await ensureDir(getMemoryProjectsDir(tempDir));
    await ensureDir(getMemoryTasksDir(tempDir));
    await ensureDir(getMemoryDir(tempDir));
    await ensureDir(getRuntimeDir(tempDir));
    await ensureDir(getBlueprintsIdentitiesDir(tempDir));
    await ensureDir(getPortalsDir(tempDir));

    // Copy flows for integration tests that need them
    const flowsSrcDir = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..", "Blueprints", "Flows");
    const flowsDestDir = join(tempDir, "Blueprints", "Flows");
    try {
      // `copySync()` throws if destination exists. Some tests create `Blueprints/Flows` up-front.
      // Avoid noisy warnings and just reuse the existing directory.
      const destExists = await exists(flowsDestDir);
      if (!destExists) {
        copySync(flowsSrcDir, flowsDestDir);
      }
    } catch (error) {
      // Flows directory might not exist in some test scenarios, ignore.
      // Also ignore benign "already exists" errors.
      if (error instanceof Deno.errors.NotFound) {
        // ignore
      } else if (error instanceof Deno.errors.AlreadyExists) {
        // ignore
      } else {
        console.warn("Could not copy flows directory:", (error as Error).message);
      }
    }

    // Initialize git if requested
    if (options.initGit !== false) {
      await setupGitRepo(tempDir, {
        initialCommit: false, // We'll do a custom commit with gitignore
        branch: "main",
      });

      // Create initial commit with .gitignore to prevent collateral damage from git reset --hard
      await Deno.writeTextFile(
        join(tempDir, ".gitignore"),
        "Workspace/\n.exa/journal.db*\n.exa/daemon.*\ndeno.lock\n",
      );
      await Deno.writeTextFile(join(tempDir, ".gitkeep"), "");

      await new Deno.Command(PortalOperation.GIT, {
        args: [MemoryOperation.ADD, "."],
        cwd: tempDir,
      }).output();
      await new Deno.Command(PortalOperation.GIT, {
        args: ["commit", "-m", "Initial commit"],
        cwd: tempDir,
      }).output();
    }

    // Write config to file so CLI commands can find it
    const configPath = join(tempDir, "exa.config.toml");

    Deno.writeTextFileSync(
      configPath,
      `
[system]
version = "1.0.0"
log_level = "info"
root = "${tempDir}"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./.exa"
workspace = "./Workspace"
portals = "./Portals"
active = "Active"
archive = "Archive"
plans = "Plans"
requests = "Requests"
rejected = "Rejected"
identities = "Identities"
flows = "Flows"
memoryProjects = "Projects"
memoryExecution = "Execution"
memoryIndex = "Index"
memorySkills = "Skills"
memoryPending = "Pending"
memoryTasks = "Tasks"
memoryGlobal = "Global"

[watcher]
debounce_ms = 200
stability_check = true

[database]
batch_flush_ms = 100
batch_max_size = 100

[database.sqlite]
journal_mode = "WAL"
foreign_keys = true
busy_timeout_ms = 5000

[agents]
default_model = "default"
timeout_sec = 60
max_iterations = 10

[models.default]
provider = "mock"
model = "gpt-5.2-pro"
timeout_ms = 30000

[mcp]
enabled = true
transport = "stdio"
server_name = "exaix"
version = "1.0.0"

[ai_retry]
max_attempts = 3
backoff_base_ms = 1000
timeout_per_request_ms = 30000

[ai_anthropic]
api_version = "2023-06-01"
default_model = "claude-3-7-sonnet-20250219"
max_tokens_default = 4096

[mcp_defaults]
identity_id = "default"

[git]
branch_prefix_pattern = "feature/"
allowed_prefixes = ["feature/", "bugfix/", "hotfix/"]

[git.operations]
status_timeout_ms = 5000
ls_files_timeout_ms = 5000
checkout_timeout_ms = 10000
clean_timeout_ms = 10000
log_timeout_ms = 5000
diff_timeout_ms = 10000
command_timeout_ms = 30000
max_retries = 3
retry_backoff_base_ms = 1000
`.trim(),
    );

    const env = new TestEnvironment(tempDir, config, db, cleanup);
    return env;
  }

  /**
   * Create a request file in /Workspace/Requests
   */
  /**
   * Helper to generate frontmatter
   */
  private generateFrontmatter(options: {
    traceId: string;
    created?: string;
    requestId?: string;
    flowId?: string;
    status?: string;
    priority?: number;
    identityId?: string;
    portal?: string;
    tags?: string[];
    targetBranch?: string;
  }): string {
    return [
      "---",
      `trace_id: "${options.traceId}"`,
      `created: "${options.created ?? new Date().toISOString()}"`,
      `status: ${options.status ?? "pending"}`,
      `priority: ${options.priority ?? 5}`,
      options.flowId ? `flow: ${options.flowId}` : null,
      options.identityId ? `identity: ${options.identityId}` : (options.flowId ? null : `identity: senior-coder`),
      `source: test`,
      `created_by: test_environment`,
      options.portal ? `portal: "${options.portal}"` : null,
      options.targetBranch ? `target_branch: "${options.targetBranch}"` : null,
      `tags: [${(options.tags ?? []).map((t) => `"${t}"`).join(", ")}]`,
      "---",
    ].filter(Boolean).join("\n");
  }

  /**
   * Create a request file in /Workspace/Requests
   */
  private createRequestWithPrefix(
    description: string,
    options: IRequestCreationOptions,
    contentPrefix: string,
    flowId?: string,
  ): Promise<{ filePath: string; traceId: string }> {
    return this.createRequestBase(description, {
      ...options,
      flowId,
      contentPrefix,
    });
  }

  /**
   * Create a request file in /Workspace/Requests
   */
  createRequest(
    description: string,
    options: IRequestCreationOptions = {},
  ): Promise<{ filePath: string; traceId: string }> {
    return this.createRequestWithPrefix(description, options, "# Request");
  }

  /**
   * Create a flow request file in /Workspace/Requests
   */
  createFlowRequest(
    description: string,
    flowId: string,
    options: IRequestCreationOptions = {},
  ): Promise<{ filePath: string; traceId: string }> {
    return this.createRequestWithPrefix(description, options, "# Flow Request", flowId);
  }

  /**
   * Base method for creating request files
   */
  private async createRequestBase(
    description: string,
    options: IRequestBaseOptions,
  ): Promise<{ filePath: string; traceId: string }> {
    const traceId = options.traceId ?? crypto.randomUUID();
    const shortId = traceId.substring(0, 8);
    const fileName = `request-${shortId}.md`;
    const filePath = join(getWorkspaceRequestsDir(this.tempDir), fileName);

    const frontmatter = this.generateFrontmatter({
      traceId,
      flowId: options.flowId,
      priority: options.priority,
      identityId: options.identityId,
      tags: options.tags,
      portal: options.portal,
      targetBranch: options.targetBranch,
    });

    const content = `${frontmatter}\n\n${options.contentPrefix}\n\n${description}\n`;
    await Deno.writeTextFile(filePath, content);
    return { filePath, traceId };
  }

  /**
   * Create a plan file in /Workspace/Plans (simulating plan generation)
   */

  async createPlan(
    traceId: string,
    requestId: string,
    options: {
      status?: string;
      identityId?: string;
      portal?: string;
      targetBranch?: string;
      actions?: Array<{ tool: string; params: ActionParams }>;
    } = {},
  ): Promise<string> {
    const _shortId = traceId.substring(0, 8);
    const fileName = `${requestId}_plan.md`;
    const filePath = join(getWorkspacePlansDir(this.tempDir), fileName);

    // Ensure plans directory exists (some tests may remove/recreate dirs concurrently)
    await ensureDir(getWorkspacePlansDir(this.tempDir));

    const actions = options.actions ?? [
      { tool: McpToolName.WRITE_FILE, params: { path: "test.txt", content: "Hello World" } },
    ];

    const frontmatter = [
      "---",
      `trace_id: "${traceId}"`,
      `request_id: "${requestId}"`,
      `identity_id: ${options.identityId ?? "senior-coder"}`,
      `status: ${options.status ?? "review"}`,
      `created_at: "${new Date().toISOString()}"`,
      options.portal ? `portal: "${options.portal}"` : null,
      options.targetBranch ? `target_branch: "${options.targetBranch}"` : null,
      "---",
    ].join("\n");

    const toTomlValue = (value: unknown): string => {
      if (typeof value === "string") return JSON.stringify(value);
      if (typeof value === "number") return String(value);
      if (typeof value === "boolean") return value ? "true" : "false";
      if (value === null || value === undefined) return JSON.stringify("");
      return JSON.stringify(JSON.stringify(value));
    };

    const actionBlocks = actions.map((action) => {
      const paramsLines = Object.entries(action.params)
        .map(([key, value]) => `${key} = ${toTomlValue(value)}`)
        .join("\n");

      return `\`\`\`toml\n` +
        `tool = ${JSON.stringify(action.tool)}\n` +
        `[params]\n` +
        `${paramsLines}\n` +
        `\`\`\``;
    }).join("\n\n");

    const content = `${frontmatter}

# Proposed Plan

## Actions

${actionBlocks}

## Reasoning

This plan will accomplish the requested task.
`;

    await Deno.writeTextFile(filePath, content);

    return filePath;
  }

  /**
   * Move plan to Workspace/Active (approve)
   */
  async approvePlan(planPath: string): Promise<string> {
    const fileName = planPath.split("/").pop()!;
    const requestId = fileName.replace(/_plan\.md$/, "");
    const activePath = join(getWorkspaceActiveDir(this.tempDir), fileName);

    // Robustly wait for the plan to appear. In high-concurrency tests the file may
    // be created slightly later or with a slightly different name/format. We poll
    // for up to 2 seconds and also scan the Plans directory for matching files by
    // name prefix or content that references the expected request_id or trace_id.
    let planExists = await exists(planPath);

    if (!planExists) {
      const start = Date.now();
      const timeoutMs = 2000;
      const intervalMs = 50;

      while (Date.now() - start < timeoutMs) {
        if (await exists(planPath)) {
          planExists = true;
          break;
        }

        // Scan Workspace/Plans for file with exact name or matching prefix
        try {
          const plansDir = getWorkspacePlansDir(this.tempDir);
          for await (const entry of Deno.readDir(plansDir)) {
            if (!entry.isFile) continue;
            // Exact name match
            if (entry.name === fileName) {
              planPath = join(plansDir, entry.name);
              planExists = true;
              break;
            }
            // Prefix match: sometimes files may have timestamps/suffixes
            if (entry.name.startsWith(requestId)) {
              const candidatePath = join(plansDir, entry.name);
              try {
                const c = await Deno.readTextFile(candidatePath);
                if (c.includes(`request_id: "${requestId}"`) || c.includes(`trace_id: "${requestId}"`)) {
                  planPath = candidatePath;
                  planExists = true;
                  break;
                }
              } catch {
                // ignore read errors and continue searching
              }
            }
          }
          if (planExists) break;
        } catch {
          // ignore directory read errors
        }

        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    if (!planExists) {
      // As a last resort, scan both Workspace/Plans and Workspace/Active for a matching
      // plan by `request_id` or `trace_id`. If an approved copy already exists in
      // Workspace/Active, return that path (tests are happy as long as the plan is
      // available for processing).
      const plansDir = getWorkspacePlansDir(this.tempDir);
      const activeDir = getWorkspaceActiveDir(this.tempDir);

      try {
        for await (const dir of [plansDir, activeDir]) {
          for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile) continue;
            const candidatePath = join(dir, entry.name);
            try {
              const c = await Deno.readTextFile(candidatePath);
              if (c.includes(`request_id: "${requestId}"`) || c.includes(`trace_id: "${requestId}"`)) {
                // If found in Active, ensure status is approved and return it.
                if (dir === activeDir) {
                  return candidatePath;
                }

                // Found in Plans; use this as planPath and proceed
                planPath = candidatePath;
                planExists = true;
                break;
              }
            } catch {
              // ignore read errors
            }
          }
          if (planExists) break;
        }
      } catch {
        // ignore
      }
    }

    if (!planExists) {
      throw new Error(`Plan file not found: ${planPath}`);
    }

    // Read and update status (be tolerant of different status formats)
    let content = await Deno.readTextFile(planPath);
    if (/status: review/.test(content)) {
      content = content.replace(/status: review/, "status: approved");
    } else if (/status: \w+/.test(content)) {
      content = content.replace(/status: \w+/, "status: approved");
    } else {
      // append status if missing
      content = content.replace(/---\s*\n/, `---\nstatus: approved\n`);
    }

    // Ensure active directory exists (some tests may remove/recreate dirs)
    await ensureDir(getWorkspaceActiveDir(this.tempDir));

    await Deno.writeTextFile(activePath, content);

    // Attempt to remove original plan file (ignore if already moved/removed)
    try {
      await Deno.remove(planPath);
    } catch {
      // ignore
    }

    return activePath;
  }

  /**
   * Move plan to /Workspace/Rejected
   */
  async rejectPlan(planPath: string, reason: string): Promise<string> {
    const fileName = planPath.split("/").pop()!;
    const rejectedPath = join(getWorkspaceRejectedDir(this.tempDir), fileName);

    // Read and update status
    let content = await Deno.readTextFile(planPath);
    content = content.replace(/status: review/, "status: rejected");
    content += `\n\n## Rejection Reason\n\n${reason}\n`;

    await Deno.writeTextFile(rejectedPath, content);
    await Deno.remove(planPath);

    return rejectedPath;
  }

  /**
   * Get plan from /Workspace/Plans by trace ID
   */
  async getPlanByTraceId(traceId: string): Promise<string | null> {
    const plansDir = getWorkspacePlansDir(this.tempDir);

    try {
      for await (const entry of Deno.readDir(plansDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          const content = await Deno.readTextFile(join(plansDir, entry.name));
          if (content.includes(`trace_id: "${traceId}"`)) {
            return join(plansDir, entry.name);
          }
        }
      }
    } catch {
      // Directory might not exist
    }

    return null;
  }

  /**
   * Get report from /Memory/Reports by trace ID
   */
  async getReportByTraceId(traceId: string): Promise<string | null> {
    const reportsDir = join(this.tempDir, "Memory", "Reports");

    try {
      for await (const entry of Deno.readDir(reportsDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          const content = await Deno.readTextFile(join(reportsDir, entry.name));
          if (content.includes(traceId)) {
            return content;
          }
        }
      }
    } catch {
      // Directory might not exist
    }

    return null;
  }

  /**
   * List git branches with Exaix naming convention
   */
  async getGitBranches(): Promise<string[]> {
    const cmd = new Deno.Command(PortalOperation.GIT, {
      args: [FlowStepType.BRANCH, "-a"],
      cwd: this.tempDir,
      stdout: "piped",
    });

    const { stdout } = await cmd.output();
    const output = new TextDecoder().decode(stdout);

    return output
      .split("\n")
      .map((b) => b.trim().replace(/^\* /, ""))
      .filter((b) => b.length > 0);
  }

  /**
   * Get activity log entries by trace ID
   */
  getActivityLog(traceId: string): Array<{
    action_type: string;
    actor: string | null;
    target: string | null;
    payload: string;
    timestamp: string;
  }> {
    // Flush pending logs
    this.db.waitForFlush();

    return this.db.getActivitiesByTrace(traceId);
  }

  /**
   * Create an ExecutionLoop instance for testing
   */
  createExecutionLoop(identityId: string = "test-agent"): ExecutionLoop {
    return new ExecutionLoop({
      config: this.config,
      db: this.db,
      identityId,
    });
  }

  /**
   * Inject failure marker into plan to trigger intentional failure
   */
  async injectFailureMarker(planPath: string): Promise<void> {
    let content = await Deno.readTextFile(planPath);
    content = content.replace(
      "# Proposed Plan",
      "# Proposed Plan\n\nIntentionally fail",
    );
    await Deno.writeTextFile(planPath, content);
  }

  /**
   * Wait for a condition with timeout
   */
  async waitFor(
    condition: () => Promise<boolean>,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<boolean> {
    const timeout = options.timeout ?? 5000;
    const interval = options.interval ?? 100;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return false;
  }

  /**
   * Create a blueprint agent file
   */
  async createBlueprint(
    identityId: string,
    content?: string,
  ): Promise<string> {
    const blueprintsPath = join(this.tempDir, "Blueprints", "Identities");
    await ensureDir(blueprintsPath);

    const defaultContent = `# ${identityId} Blueprint

You are an expert software developer with deep knowledge of multiple programming languages and frameworks.

## Response Format

Always respond with valid JSON containing a plan with actionable steps.`;

    const blueprintPath = join(blueprintsPath, `${identityId}.md`);
    await Deno.writeTextFile(blueprintPath, content ?? defaultContent);

    return blueprintPath;
  }

  /**
   * Create a RequestProcessor with MockLLMProvider
   */
  createRequestProcessor(options?: {
    providerMode?: MockStrategy;
    recordings?: IRecordedResponse[];
    includeReasoning?: boolean;
    requestsDir?: string;
    blueprintsPath?: string;
  }): {
    provider: MockLLMProvider;
    processor: RequestProcessor;
  } {
    const provider = new MockLLMProvider(
      options?.providerMode ?? MockStrategy.RECORDED,
      { recordings: options?.recordings ?? [] },
    );

    const context: IApplicationContext = {
      config: { get: () => this.config, getChecksum: () => "test" } as any,
      db: this.db,
      provider,
      git: {} as any,
      display: new EventLogger({ db: this.db, defaultActor: "test" }),
    };

    const processor = new RequestProcessor({
      workspacePath: join(this.tempDir, "Workspace"),
      requestsDir: options?.requestsDir ?? getWorkspaceRequestsDir(this.tempDir),
      blueprintsPath: options?.blueprintsPath ??
        join(this.tempDir, "Blueprints", "Identities"),
      includeReasoning: options?.includeReasoning ?? true,
      context,
      testProvider: provider,
    });

    return { provider, processor };
  }

  /**
   * Create a mock LLM provider with optional recordings
   */
  createMockProvider(
    mode: MockStrategy = MockStrategy.RECORDED,
    recordings: IRecordedResponse[] = [],
  ): MockLLMProvider {
    return new MockLLMProvider(mode, { recordings });
  }

  /**
   * Check if file exists
   */
  async fileExists(relativePath: string): Promise<boolean> {
    return await exists(join(this.tempDir, relativePath));
  }

  /**
   * Read file content
   */
  async readFile(relativePath: string): Promise<string> {
    return await Deno.readTextFile(join(this.tempDir, relativePath));
  }

  /**
   * Write file content
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = join(this.tempDir, relativePath);
    await ensureDir(fullPath.substring(0, fullPath.lastIndexOf("/")));
    await Deno.writeTextFile(fullPath, content);
  }

  /**
   * List files in directory
   */
  async listFiles(relativePath: string): Promise<string[]> {
    const fullPath = join(this.tempDir, relativePath);
    const files: string[] = [];
    try {
      for await (const entry of Deno.readDir(fullPath)) {
        if (entry.isFile) {
          files.push(entry.name);
        }
      }
    } catch {
      // Directory might not exist
    }
    return files;
  }

  /**
   * Cleanup test environment
   */
  async cleanup(): Promise<void> {
    // Prefer the DB helper's cleanup (it closes DB and removes the tempdir),
    // but fall back to manual cleanup if not available.
    if (this._dbCleanup) {
      try {
        await this._dbCleanup();
        return;
      } catch {
        // Fall back to manual cleanup
      }
    }

    try {
      await this.db.close();
    } catch {
      // Ignore close errors
    }

    try {
      await Deno.remove(this.tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
