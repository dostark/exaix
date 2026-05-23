/**
 * @module FileWatcherTestHelper
 * @path tests/helpers/watcher_test_helper.ts
 * @description Provides common utilities for FileWatcher tests, including
 * debounced event capturing and stable simulation of rapid file modifications.
 */

import { join } from "@std/path";
import { FileWatcher } from "../../apps/daemon/src/watcher.ts";
import type { DatabaseService as DatabaseService } from "@exaix/storage-sqlite";
import { createMockConfig } from "./config.ts";
import { getWorkspaceRequestsDir } from "./paths_helper.ts";

/**
 * Test helper for FileWatcher tests
 * Provides utilities for setting up temp directories, watchers, and common test patterns
 */
export class WatcherTestHelper {
  public tempDir: string;
  public requestDir: string;
  private watcher?: FileWatcher;
  private watcherPromise?: Promise<void>;

  constructor(tempDir: string) {
    this.tempDir = tempDir;
    this.requestDir = getWorkspaceRequestsDir(tempDir);
  }

  /**
   * Creates workspace directory structure
   */
  async createWorkspaceStructure(): Promise<void> {
    await Deno.mkdir(this.requestDir, { recursive: true });
  }

  /**
   * Creates a FileWatcher instance with custom callback
   */
  createWatcher(
    callback: (event: { path: string; content: string }) => void,
    options: {
      debounceMs?: number;
      stabilityCheck?: boolean;
      db?: DatabaseService;
    } = {},
  ): FileWatcher {
    const config = createMockConfig(this.tempDir, {
      watcher: {
        debounce_ms: options.debounceMs ?? 50,
        stability_check: options.stabilityCheck ?? false,
      },
    });

    this.watcher = new FileWatcher(config, callback, { db: options.db });
    return this.watcher;
  }

  /**
   * Starts watcher and waits for initialization
   */
  async startWatcher(watcher: FileWatcher = this.watcher!): Promise<void> {
    if (!watcher) {
      throw new Error("No watcher to start. Call createWatcher() first.");
    }
    this.watcherPromise = watcher.start();
    // Wait for watcher to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * Stops watcher and awaits completion
   */
  async stopWatcher(watcher: FileWatcher = this.watcher!): Promise<void> {
    if (!watcher) return;
    watcher.stop();
    await this.watcherPromise?.catch(() => {}); // Ignore abort error
  }

  /**
   * Writes a file to the inbox and waits for processing
   */
  async writeFile(
    filename: string,
    content: string,
    waitMs: number = 200,
  ): Promise<string> {
    const filePath = join(this.requestDir, filename);
    await Deno.writeTextFile(filePath, content);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return filePath;
  }

  /**
   * Writes multiple files to inbox
   */
  async writeFiles(
    files: Array<{ name: string; content: string }>,
    waitMs: number = 200,
  ): Promise<string[]> {
    const _paths = await Promise.all(
      files.map((f) => Deno.writeTextFile(join(this.requestDir, f.name), f.content)),
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return files.map((f) => join(this.requestDir, f.name));
  }

  /**
   * Cleanup temp directory
   */
  async cleanup(): Promise<void> {
    await Deno.remove(this.tempDir, { recursive: true }).catch(() => {});
  }
}

/**
 * Creates a complete test context for watcher tests
 */
export async function createWatcherTestContext(
  prefix: string,
): Promise<{
  tempDir: string;
  helper: WatcherTestHelper;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir({ prefix });
  const helper = new WatcherTestHelper(tempDir);

  return {
    tempDir,
    helper,
    cleanup: () => helper.cleanup(),
  };
}
