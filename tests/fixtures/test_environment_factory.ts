/**
 * @module TestEnvironmentFactory
 * @path tests/fixtures/test_environment_factory.ts
 * @description Provides high-level factories for orchestrating isolated test
 * workspaces, including mock service injection and temporary portal setup.
 */

import type { Config } from "@exaix/schemas/config.ts";
import { MemoryCommands } from "../../apps/exactl/src/commands/memory_commands.ts";
import { MemoryBankService } from "@exaix/memory";
import { MemoryExtractorService } from "@exaix/memory";
import { MemoryEmbeddingService } from "@exaix/memory";
import { SkillsService } from "@exaix/core/skills";
import type { DatabaseService as DatabaseService } from "@exaix/storage-sqlite";
import {
  MemoryBankAdapter,
  MemoryEmbeddingAdapter,
  MemoryExtractorAdapter,
  SkillsAdapter,
} from "../../apps/common/adapters/mod.ts";
import { initTestDbService } from "@exaix/testing";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import {
  getMemoryDir,
  getMemoryExecutionDir,
  getMemoryGlobalDir,
  getMemoryIndexDir,
  getMemoryPendingDir,
  getMemoryProjectsDir,
  getMemorySkillsDir,
  getMemoryTasksDir,
} from "@exaix/testing";

export interface IMemoryTestEnvironment {
  tempRoot: string;
  config: Config;
  db: DatabaseService;
  commands: MemoryCommands;
  memoryBank: MemoryBankService;
  extractor: MemoryExtractorService;
  cleanup: () => Promise<void>;
}

export interface IEnvironmentOptions {
  prefix?: string;
  withExtractor?: boolean;
}

/**
 * Factory for creating standardized test environments
 */
export class TestEnvironmentFactory {
  /**
   * Creates a complete memory test environment with all required services and directories
   */
  public static async createMemoryEnvironment(_options: IEnvironmentOptions = {}): Promise<IMemoryTestEnvironment> {
    // Initialize DB and base environment
    const { db, cleanup: dbCleanup, tempDir, config: baseConfig } = await initTestDbService();

    // initTestDbService creates .exa; Memory directories still need to be created here.
    await Deno.mkdir(getMemoryProjectsDir(tempDir), { recursive: true });
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });
    await Deno.mkdir(getMemoryIndexDir(tempDir), { recursive: true });
    await Deno.mkdir(getMemoryGlobalDir(tempDir), { recursive: true });
    await Deno.mkdir(getMemoryPendingDir(tempDir), { recursive: true });
    await Deno.mkdir(getMemorySkillsDir(tempDir), { recursive: true });
    await Deno.mkdir(getMemoryTasksDir(tempDir), { recursive: true });

    // Re-create config if we need specific overrides, but baseConfig should be fine for most.
    // Use the config returned by initTestDbService
    const config = baseConfig;

    const context: ICliApplicationContext = {
      config: createStubConfig(config),
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(db),
    };

    const memoryBank = new MemoryBankService(config);
    const embedding = new MemoryEmbeddingService(config);
    const skills = new SkillsService({
      memoryDir: getMemoryDir(tempDir),
      portal: config.paths.workspace,
    }, db);
    const extractor = new MemoryExtractorService(config, db, memoryBank);

    context.memoryBank = new MemoryBankAdapter(memoryBank);
    context.extractor = new MemoryExtractorAdapter(extractor);
    context.embeddings = new MemoryEmbeddingAdapter(embedding);
    context.skills = new SkillsAdapter(skills);

    const commands = new MemoryCommands(context);

    const cleanup = async () => {
      await dbCleanup();
      // initTestDbService's cleanup handles dir removal
    };

    return {
      tempRoot: tempDir,
      config,
      db,
      commands,
      memoryBank,
      extractor,
      cleanup,
    };
  }
}
