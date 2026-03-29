/**
 * @module CLITestSetup
 * @path tests/cli/helpers/test_setup.ts
 * @description Provides common setup and teardown routines for CLI tests, including
 * temporary workspace creation and mock Git repository initialization.
 */

import { join } from "@std/path";
import { ConfigService } from "../../../src/config/service.ts";
import { PortalCommands } from "../../../src/cli/commands/portal_commands.ts";
import { ContextCardGenerator } from "../../../src/services/context_card_generator.ts";
import { ContextCardAdapter } from "../../../src/services/adapters/context_card_adapter.ts";
import { RequestService } from "../../../src/services/request.ts";
import { RequestAdapter } from "../../../src/services/adapters/request_adapter.ts";
import { PortalService } from "../../../src/services/portal.ts";
import { PortalAdapter } from "../../../src/services/adapters/portal_adapter.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { getMemoryProjectsDir } from "../../helpers/paths_helper.ts";
import { GitTestHelper, setupGitRepo } from "../../helpers/git_test_helper.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../../helpers/test_helpers.ts";
import { createMockKnowledgeService, DEFAULT_KNOWLEDGE_CONFIG } from "../../helpers/portal_test_helper.ts";
import type {
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
} from "../../../src/shared/interfaces/i_portal_knowledge_service.ts";
import type { ICliApplicationContext } from "../../../src/cli/cli_context.ts";

/**
 * Creates a complete portal test environment with all necessary directories
 */
export async function initPortalTest(options?: {
  createTarget?: boolean;
  targetFiles?: Record<string, string>;
  portalKnowledge?: IPortalKnowledgeService;
  portalKnowledgeConfig?: IPortalKnowledgeConfig;
}) {
  const tempRoot = await Deno.makeTempDir({ prefix: "portal-test-" });
  const targetDir = options?.createTarget !== false ? await Deno.makeTempDir({ prefix: "portal-target-" }) : "";

  const { db, cleanup: dbCleanup } = await initTestDbService();

  // Create required directories
  await Deno.mkdir(join(tempRoot, "Portals"), { recursive: true });
  await Deno.mkdir(getMemoryProjectsDir(tempRoot), { recursive: true });

  // Create target directory files if specified
  if (targetDir && options?.targetFiles) {
    for (const [filePath, content] of Object.entries(options.targetFiles)) {
      const fullPath = join(targetDir, filePath);
      await Deno.mkdir(join(fullPath, ".."), { recursive: true });
      await Deno.writeTextFile(fullPath, content);
    }
  }

  const config = createMockConfig(tempRoot);
  const contextCards = new ContextCardAdapter(new ContextCardGenerator(config));
  const portalKnowledge: IPortalKnowledgeService = options?.portalKnowledge || createMockKnowledgeService();
  const portalKnowledgeConfig: IPortalKnowledgeConfig = options?.portalKnowledgeConfig || DEFAULT_KNOWLEDGE_CONFIG;

  const context: ICliApplicationContext = {
    config: createStubConfig(config),
    db,
    git: createStubGit(),
    provider: createStubProvider(),
    display: createStubDisplay(db),
    contextCards,
    portalKnowledge,
    portalKnowledgeConfig,
    portals: new PortalAdapter(
      new PortalService(
        config,
        createStubConfig(config),
        contextCards,
        createStubDisplay(db),
        portalKnowledge,
        portalKnowledgeConfig,
      ),
    ),
  };
  const commands = new PortalCommands(context);

  const cleanup = async () => {
    await dbCleanup();
    await Deno.remove(tempRoot, { recursive: true }).catch(() => {});
    if (targetDir) {
      await Deno.remove(targetDir, { recursive: true }).catch(() => {});
    }
  };

  return {
    tempRoot,
    targetDir,
    config,
    db,
    commands,
    context,
    cleanup,
  };
}

/**
 * Creates a portal with symlink and context card
 */
export async function createTestPortal(
  commands: PortalCommands,
  targetDir: string,
  alias: string,
) {
  await commands.add(targetDir, alias);
  // Wait for async operations to complete
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Verifies a portal's symlink exists
 */
export async function verifySymlink(tempRoot: string, alias: string): Promise<boolean> {
  const symlinkPath = join(tempRoot, "Portals", alias);
  try {
    const info = await Deno.lstat(symlinkPath);
    return info.isSymlink;
  } catch {
    return false;
  }
}

/**
 * Verifies a portal's context card exists
 */
export async function verifyContextCard(tempRoot: string, alias: string): Promise<boolean> {
  const cardPath = join(tempRoot, "Memory", "Projects", alias, "portal.md");
  try {
    await Deno.stat(cardPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the path to a portal's symlink
 */
export function getPortalSymlinkPath(tempRoot: string, alias: string): string {
  return join(tempRoot, "Portals", alias);
}

/**
 * Gets the path to a portal's context card
 */
export function getPortalCardPath(tempRoot: string, alias: string): string {
  return join(tempRoot, "Memory", "Projects", alias, "portal.md");
}

/**
 * Creates a unified CLI test context for tests.
 * Delegates to `initTestDbService()` and optionally creates extra directories.
 */
export async function createCliTestContext(options?: { createDirs?: string[] }) {
  // Set test mode for CLI operations to suppress warnings
  Deno.env.set("EXA_TEST_CLI_MODE", "1");

  const { db, tempDir, config, cleanup } = await initTestDbService();

  // Always create required Workspace and .exa directories for CLI tests
  const requiredDirs = [
    "Workspace/Plans",
    "Workspace/Active",
    "Workspace/Archive",
    "Workspace/Rejected",
    ".exa",
    "Memory",
    "Portals",
    "Blueprints/Identities",
  ];
  for (const dir of requiredDirs) {
    await Deno.mkdir(join(tempDir, dir), { recursive: true });
  }

  if (options?.createDirs) {
    for (const dir of options.createDirs) {
      await Deno.mkdir(join(tempDir, dir), { recursive: true });
    }
  }

  const configPath = join(tempDir, "exa.config.toml");
  const configService = new ConfigService(configPath);
  const contextCards = new ContextCardAdapter(new ContextCardGenerator(config));
  const display = createStubDisplay(db);
  const requests = new RequestAdapter(
    new RequestService(config, configService, display, () => Promise.resolve("tester")),
  );

  const context: ICliApplicationContext = {
    config: configService,
    db,
    git: createStubGit(),
    provider: createStubProvider(),
    display,
    contextCards,
    requests,
    portals: new PortalAdapter(
      new PortalService(
        config,
        configService,
        contextCards,
        display,
        createMockKnowledgeService(),
        DEFAULT_KNOWLEDGE_CONFIG,
      ),
    ),
  };

  const cleanupAll = async () => {
    Deno.env.delete("EXA_TEST_CLI_MODE");
    await cleanup();
  };

  return { db, tempDir, config, configService, context, cleanup: cleanupAll };
}

/**
 * Helper to run git commands in tests
 */
export async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  return await new GitTestHelper(cwd).runGit(args);
}

/**
 * Initialize a git repository in the temp directory with a default user and initial commit
 */
export async function initGitRepo(tempDir: string): Promise<void> {
  await setupGitRepo(tempDir, { initialCommit: true });
}
