/**
 * @module ToolRegistryTestHelper
 * @path tests/helpers/tool_registry_test_helper.ts
 * @description Provides common utilities for ToolRegistry tests, ensuring stable
 * registration of mock tools and validation of JSON argument schemas.
 */

import { join } from "@std/path";
import { ToolRegistry } from "../../src/services/tool/tool_registry.ts";
import type { DatabaseService as DatabaseService } from "../../src/services/core/db.ts";
import { createMockConfig } from "./config.ts";
import { initTestDbService } from "./db.ts";
import { getMemoryProjectsDir } from "./paths_helper.ts";
import { type JSONObject, type JSONValue, toSafeJson } from "@exaix/core/types";
import type { IToolResult } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";

/**
 * Test helper for ToolRegistry tests
 * Provides utilities for setting up temp directories, tool registry, and common test patterns
 */
export class ToolRegistryTestHelper {
  public tempDir: string;
  public registry: ToolRegistry;
  public db: DatabaseService;
  public config: Config;
  private dbCleanup: () => Promise<void>;

  private constructor(
    tempDir: string,
    registry: ToolRegistry,
    db: DatabaseService,
    config: Config,
    dbCleanup: () => Promise<void>,
  ) {
    this.tempDir = tempDir;
    this.registry = registry;
    this.db = db;
    this.config = config;
    this.dbCleanup = dbCleanup;
  }

  /**
   * Creates a complete ToolRegistry test context
   */
  static async create(prefix: string): Promise<ToolRegistryTestHelper> {
    const tempDir = await Deno.makeTempDir({ prefix });
    const { db, cleanup } = await initTestDbService();
    const config = createMockConfig(tempDir);
    const registry = new ToolRegistry({ config, db });

    return new ToolRegistryTestHelper(tempDir, registry, db, config, cleanup);
  }

  /**
   * Creates the Memory/Projects directory within the temp directory
   */
  async createMemoryProjectsDir(): Promise<string> {
    const memoryDir = getMemoryProjectsDir(this.tempDir);
    await Deno.mkdir(memoryDir, { recursive: true });
    return memoryDir;
  }

  /**
   * Creates a file in the Memory/Projects directory (portal context card)
   */
  async createMemoryProjectFile(
    filename: string,
    content: string,
  ): Promise<string> {
    const memoryDir = await this.createMemoryProjectsDir();
    const filePath = join(memoryDir, filename);
    await Deno.writeTextFile(filePath, content);
    return filePath;
  }

  /**
   * Creates a file in the temp directory
   */
  async createFile(filename: string, content: string): Promise<string> {
    const filePath = join(this.tempDir, filename);
    await Deno.writeTextFile(filePath, content);
    return filePath;
  }

  /**
   * Creates a directory
   */
  async createDir(dirname: string): Promise<string> {
    const dirPath = join(this.tempDir, dirname);
    await Deno.mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  /**
   * Executes a tool and returns the result
   */
  async execute(toolName: string, params: JSONObject): Promise<IToolResult> {
    return await this.registry.execute(toolName, toSafeJson(params) as Record<string, JSONValue>);
  }

  /**
   * Waits for batched logging to complete
   */
  async waitForLogging(ms: number = 150): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets activity logs for a specific action type
   */
  getActivityLogs(actionType: string): JSONObject[] {
    return this.db.instance
      .prepare("SELECT * FROM activity WHERE action_type = ?")
      .all(actionType) as JSONObject[];
  }

  /**
   * Cleanup temp directory and database
   */
  async cleanup(): Promise<void> {
    await this.dbCleanup();
    await Deno.remove(this.tempDir, { recursive: true }).catch(() => {});
  }
}

/**
 * Creates a complete test context for tool registry tests
 */
export async function createToolRegistryTestContext(
  prefix: string,
): Promise<{
  helper: ToolRegistryTestHelper;
  tempDir: string;
  registry: ToolRegistry;
  db: DatabaseService;
  cleanup: () => Promise<void>;
}> {
  const helper = await ToolRegistryTestHelper.create(prefix);

  return {
    helper,
    tempDir: helper.tempDir,
    registry: helper.registry,
    db: helper.db,
    cleanup: () => helper.cleanup(),
  };
}
