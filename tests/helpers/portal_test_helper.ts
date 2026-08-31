/**
 * @module PortalTestHelper
 * @path tests/helpers/portal_test_helper.ts
 * @description Provides high-level utilities for portal-based testing,
 * coordinating portal registration, alias validation, and lifecycle simulation.
 */

import { join } from "@std/path";
import { PortalCommands } from "../../apps/exactl/src/commands/portal_commands.ts";
import { initTestDbService } from "@exaix/testing";
import { writeTestConfigFile } from "@exaix/testing";
import { ConfigService } from "@exaix/core/config";
import type { DatabaseService as DatabaseService } from "@exaix/storage-sqlite";
import { ContextCardGenerator } from "@exaix/core/context";
import { ContextCardAdapter } from "../../apps/common/adapters/context_card_adapter.ts";
import { createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import { PortalService } from "@exaix/portal";
import { PortalAdapter } from "../../apps/common/adapters/portal_adapter.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { IPortalKnowledgeConfig, IPortalKnowledgeService, Opt, Reason } from "@exaix/core/types";
import { PortalAnalysisMode } from "@exaix/core";
import { getPortalsDir } from "@exaix/testing";

// Build an empty portal-knowledge snapshot, used by the mock PortalKnowledgeService below.
// Extracted so the three producing methods (analyze / getOrAnalyze / updateKnowledge) share
// one shape.
function emptyKnowledge(portal: string, mode: PortalAnalysisMode = PortalAnalysisMode.QUICK) {
  return {
    portal,
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "",
    layers: [],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: { totalFiles: 0, totalDirectories: 0, extensionDistribution: {} },
    metadata: { mode, durationMs: 0, filesScanned: 0, filesRead: 0 },
  };
}

/**
 * Create a mock PortalKnowledgeService for testing
 */
export function createMockKnowledgeService(): IPortalKnowledgeService {
  return {
    analyze: (p1, _p2, p3) => Promise.resolve(emptyKnowledge(p1, p3 || PortalAnalysisMode.QUICK)),
    getOrAnalyze: (p1, _p2) => Promise.resolve(emptyKnowledge(p1)),
    isStale: () => Promise.resolve(false),
    updateKnowledge: (p1, _p2) => Promise.resolve(emptyKnowledge(p1)),
    getRelevantContext: () => Promise.resolve(undefined),
  };
}

/**
 * Default portal knowledge config for testing
 */
export const DEFAULT_KNOWLEDGE_CONFIG: IPortalKnowledgeConfig = {
  autoAnalyzeOnMount: false,
  defaultMode: PortalAnalysisMode.QUICK,
  quickScanLimit: 0,
  maxFilesToRead: 0,
  ignorePatterns: [],
  staleness: 0,
  useLlmInference: false,
  relevanceSearchEmbeddingEnabled: false,
};

export class PortalConfigTestHelper {
  constructor(
    public tempRoot: string,
    public targetDir: string,
    public commands: PortalCommands,
    public configService: ConfigService,
    public db: DatabaseService,
    private dbCleanup: () => Promise<void>,
  ) {}

  /**
   * Create a new portal config test context
   */
  static async create(prefix: string): Promise<PortalConfigTestHelper> {
    const tempRoot = await Deno.makeTempDir({ prefix: `portal-test-${prefix}-` });
    const targetDir = await Deno.makeTempDir({ prefix: "portal-target-" });
    const { db, cleanup: dbCleanup } = await initTestDbService();

    const configPath = await writeTestConfigFile(tempRoot);
    const configService = new ConfigService(configPath);

    // Create portal symlink directory (Portals/) for mounted projects
    // and portal context store (Memory/Portals/) for portal context cards (Markdown)
    await Deno.mkdir(join(tempRoot, "Portals"), { recursive: true });
    await Deno.mkdir(getPortalsDir(tempRoot), { recursive: true });

    const contextCards = new ContextCardAdapter(new ContextCardGenerator(configService.getAll()));

    const context: ICliApplicationContext = {
      config: configService,
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(db),
      contextCards,
      portals: new PortalAdapter(
        new PortalService(
          configService.getAll(),
          configService,
          contextCards,
          createStubDisplay(db),
          createMockKnowledgeService(),
          DEFAULT_KNOWLEDGE_CONFIG,
        ),
      ),
    };

    const commands = new PortalCommands(context);

    return new PortalConfigTestHelper(
      tempRoot,
      targetDir,
      commands,
      configService,
      db,
      dbCleanup,
    );
  }

  /**
   * Create an additional target directory (for tests needing multiple targets)
   */
  async createAdditionalTarget(): Promise<string> {
    return await Deno.makeTempDir({ prefix: "portal-target-" });
  }

  /**
   * Add a portal
   */
  async addPortal(alias: string, targetPath?: Opt<string, Reason.TestOverride>): Promise<void> {
    await this.commands.add(targetPath || this.targetDir, alias);
  }

  /**
   * Remove a portal
   */
  async removePortal(alias: string): Promise<void> {
    await this.commands.remove(alias);
  }

  /**
   * List all portals
   */
  async listPortals(): Promise<Awaited<ReturnType<PortalCommands["list"]>>> {
    return await this.commands.list();
  }

  /**
   * Verify portal(s)
   */
  async verifyPortal(alias?: Opt<string, Reason.QueryFilter>): Promise<Awaited<ReturnType<PortalCommands["verify"]>>> {
    return await this.commands.verify(alias);
  }

  /**
   * Get portal symlink path
   */
  getSymlinkPath(alias: string): string {
    return join(this.tempRoot, "Portals", alias);
  }

  /**
   * Get portal context card path
   */
  getCardPath(alias: string): string {
    return join(this.tempRoot, "Memory", "Portals", `${alias}.md`);
  }

  /**
   * Get fresh commands instance with updated config
   */
  getRefreshedCommands(): PortalCommands {
    const contextCards = new ContextCardAdapter(new ContextCardGenerator(this.configService.getAll()));
    const context: ICliApplicationContext = {
      config: this.configService,
      db: this.db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(this.db),
      contextCards,
      portals: new PortalAdapter(
        new PortalService(
          this.configService.getAll(),
          this.configService,
          contextCards,
          createStubDisplay(this.db),
          createMockKnowledgeService(),
          DEFAULT_KNOWLEDGE_CONFIG,
        ),
      ),
    };
    return new PortalCommands(context);
  }

  /**
   * Cleanup all resources
   */
  async cleanup(additionalDirs: Opt<string[], Reason.TestOverride> = []): Promise<void> {
    await this.dbCleanup();
    await Deno.remove(this.tempRoot, { recursive: true }).catch(() => {});
    await Deno.remove(this.targetDir, { recursive: true }).catch(() => {});

    for (const dir of additionalDirs) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  }
}

/**
 * Factory function to create portal config test context
 */
export async function createPortalConfigTestContext(
  prefix: string,
): Promise<{
  helper: PortalConfigTestHelper;
  cleanup: (additionalDirs?: Opt<string[], Reason.TestOverride>) => Promise<void>;
}> {
  const helper = await PortalConfigTestHelper.create(prefix);
  return {
    helper,
    cleanup: (additionalDirs?: Opt<string[], Reason.TestOverride>) => helper.cleanup(additionalDirs),
  };
}
