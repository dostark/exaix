/**
 * @module PortalTestHelper
 * @path tests/helpers/portal_test_helper.ts
 * @description Provides high-level utilities for portal-based testing,
 * coordinating portal registration, alias validation, and lifecycle simulation.
 */

import { join } from "@std/path";
import { PortalCommands } from "../../src/cli/commands/portal_commands.ts";
import { initTestDbService } from "./db.ts";
import { createTestConfigService } from "./config.ts";
import type { ConfigService } from "@exaix/core/config";
import type { DatabaseService as DatabaseService } from "../../src/services/core/db.ts";
import { ContextCardGenerator } from "@exaix/context";
import { ContextCardAdapter } from "../../src/services/adapters/context_card_adapter.ts";
import { createStubDisplay, createStubGit, createStubProvider } from "../helpers/test_helpers.ts";
import { PortalService } from "@exaix/portal";
import { PortalAdapter } from "../../src/services/adapters/portal_adapter.ts";
import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";
import type { IPortalKnowledgeConfig, IPortalKnowledgeService } from "@exaix/core/types";
import { PortalAnalysisMode } from "@exaix/core";
import { getPortalsDir } from "./paths_helper.ts";

/**
 * Helper class for config-based portal tests
 */
/**
 * Create a mock PortalKnowledgeService for testing
 */
export function createMockKnowledgeService(): IPortalKnowledgeService {
  return {
    analyze: (p1, _p2, p3) =>
      Promise.resolve({
        portal: p1,
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
        metadata: { mode: p3 || PortalAnalysisMode.QUICK, durationMs: 0, filesScanned: 0, filesRead: 0 },
      }),
    getOrAnalyze: (p1, _p2) =>
      Promise.resolve({
        portal: p1,
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
        metadata: { mode: PortalAnalysisMode.QUICK, durationMs: 0, filesScanned: 0, filesRead: 0 },
      }),
    isStale: () => Promise.resolve(false),
    updateKnowledge: (p1, _p2) =>
      Promise.resolve({
        portal: p1,
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
        metadata: { mode: PortalAnalysisMode.QUICK, durationMs: 0, filesScanned: 0, filesRead: 0 },
      }),
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

    const configService = await createTestConfigService(tempRoot);

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
  async addPortal(alias: string, targetPath?: string): Promise<void> {
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
  async verifyPortal(alias?: string): Promise<Awaited<ReturnType<PortalCommands["verify"]>>> {
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
  async cleanup(additionalDirs: string[] = []): Promise<void> {
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
): Promise<{ helper: PortalConfigTestHelper; cleanup: (additionalDirs?: string[]) => Promise<void> }> {
  const helper = await PortalConfigTestHelper.create(prefix);
  return {
    helper,
    cleanup: (additionalDirs?: string[]) => helper.cleanup(additionalDirs),
  };
}
