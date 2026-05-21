/**
 * @module FileWatcher
 * @path src/services/utils/watcher.ts
 * @description Monitors the workspace for file system events (new requests, approved plans).
 * Implements debouncing and stability verification to ensure files are fully written before processing.
 * @architectural-layer Services
 * @related-files [src/main.ts, "src/services/request/request_processor.ts"]
 */
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { DatabaseService } from "../core/db.ts";
import { EventLogger } from "@exaix/core/logger";
import {
  DEFAULT_UNKNOWN_LABEL,
  DEFAULT_WATCHER_STABILITY_BACKOFF_MS,
  DEFAULT_WATCHER_STABILITY_MAX_ATTEMPTS,
} from "@exaix/core";
import { ActivityActor } from "@exaix/core";
import { delay } from "@exaix/core/func";

/**
 * Event emitted when a stable file is detected
 */
export interface IFileReadyEvent {
  path: string;
  content: string;
}

export interface FileWatcherOptions {
  db?: DatabaseService;
  customWatchPath?: string;
  extensions?: string[];
}

export class FileWatcher {
  private watchPath: string;
  private debounceMs: number;
  private stabilityCheck: boolean;
  private debounceTimers: Map<string, number> = new Map();
  private processingFiles: Set<string> = new Set();
  private onFileReady: (event: IFileReadyEvent) => void | Promise<void>;
  private abortController: AbortController | null = null;
  private fsWatcher: Deno.FsWatcher | null = null;
  private logger: EventLogger;
  private extensions: string[];

  constructor(
    config: Config,
    onFileReady: (event: IFileReadyEvent) => void | Promise<void>,
    options: FileWatcherOptions = {},
  ) {
    this.watchPath = options.customWatchPath || join(config.system.root, config.paths.workspace, "Requests");
    this.debounceMs = config.watcher.debounce_ms;
    this.stabilityCheck = config.watcher.stability_check;
    this.onFileReady = onFileReady;
    this.extensions = options.extensions || [".md"];

    // Initialize EventLogger
    this.logger = new EventLogger({
      db: options.db,
      defaultActor: ActivityActor.SYSTEM,
    });
  }

  /**
   * Get the number of files currently being processed
   * @returns Count of processing files
   */
  public getProcessingFilesCount(): number {
    return this.processingFiles.size;
  }

  /**
   * Start watching the directory
   */
  async start(): Promise<void> {
    this.abortController = new AbortController();

    try {
      const watcher = Deno.watchFs(this.watchPath, {
        recursive: false,
      });
      this.fsWatcher = watcher;

      await this.logger.log({
        action: "watcher.started",
        target: this.watchPath,
        payload: {
          debounce_ms: this.debounceMs,
          stability_check: this.stabilityCheck,
          extensions: this.extensions,
        },
        icon: "📁",
      });

      for await (const event of watcher) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        // Only process create, modify, or rename events (moves)
        if (event.kind === "create" || event.kind === "modify" || event.kind === "rename") {
          for (const path of event.paths) {
            // Ignore dotfiles
            const filename = path.split("/").pop() || "";
            if (filename.startsWith(".")) {
              continue;
            }

            // check extension
            const hasValidExtension = this.extensions.some((ext) => filename.endsWith(ext));
            if (!hasValidExtension) {
              continue;
            }

            // Log file event detected
            await this.logger.debug(`watcher.event_${event.kind}`, path, {
              event_kind: event.kind,
            });

            this.debounceFile(path);
          }
        }
      }
    } catch (error) {
      // Log watcher error
      await this.logger.error("watcher.error", this.watchPath, {
        error_type: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
        error_message: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Deno.errors.NotFound) {
        // Console-only message for user guidance
        console.error(`❌ Watch directory not found: ${this.watchPath}`);
        console.error(`   Create it with: mkdir -p "${this.watchPath}"`);
      }
      throw error;
    }
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }

    // Clear all pending timers
    for (const timerId of this.debounceTimers.values()) {
      clearTimeout(timerId);
    }
    this.debounceTimers.clear();

    // Clear processing files set
    this.processingFiles.clear();

    // Log watcher stopped
    await this.logger.log({
      action: "watcher.stopped",
      target: this.watchPath,
      payload: {},
      icon: "⏹️",
    });
  }

  /**
   * Stage 1: Debounce file events
   */
  private debounceFile(path: string): void {
    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timerId = setTimeout(() => {
      this.debounceTimers.delete(path);
      this.processFileQueued(path); // Use queued processing to prevent race conditions
    }, this.debounceMs);

    this.debounceTimers.set(path, timerId);
  }

  /**
   * Stage 1.5: Queued file processing to prevent race conditions
   */
  private async processFileQueued(path: string): Promise<void> {
    // Prevent concurrent processing of the same file
    if (this.processingFiles.has(path)) {
      await this.logger.debug("watcher.file_already_processing", path, {
        skipped: true,
      });
      return;
    }

    this.processingFiles.add(path);

    try {
      await this.processFile(path);
    } finally {
      this.processingFiles.delete(path);
    }
  }

  /**
   * Stage 2: Process file after debounce
   */
  private async processFile(path: string): Promise<void> {
    try {
      let content: string;

      if (this.stabilityCheck) {
        content = await this.readFileWhenStable(path);
      } else {
        // Skip stability check, read immediately
        content = await Deno.readTextFile(path);
      }

      // Log file ready
      await this.logger.info("watcher.file_ready", path, {
        content_length: content.length,
        stability_check_used: this.stabilityCheck,
      });

      // Emit event
      await this.onFileReady({ path, content });
    } catch (error) {
      // Log file processing error
      await this.logger.warn("watcher.file_error", path, {
        error_type: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Read file with stability verification (exponential backoff)
   */
  public async readFileWhenStable(path: string): Promise<string> {
    const maxAttempts = DEFAULT_WATCHER_STABILITY_MAX_ATTEMPTS;
    const backoffMs = DEFAULT_WATCHER_STABILITY_BACKOFF_MS;

    // Stage 1: Wait for file size to stabilize (metadata only, no content reading)
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Get initial size
        const stat1 = await Deno.stat(path);

        // Wait for stability
        await delay(backoffMs[attempt]);

        // Check if size changed
        const stat2 = await Deno.stat(path);

        if (stat1.size === stat2.size && stat2.size > 0) {
          // File size is stable! Now read content once
          const content = await Deno.readTextFile(path);

          // Validate it's not empty
          if (content.trim().length > 0) {
            // Log successful stability check
            await this.logger.debug("watcher.file_stable", path, {
              attempts: attempt + 1,
              final_size: stat2.size,
            });

            return content;
          }

          // Empty file, treat as unstable
          throw new Error(`File is empty: ${path}`);
        }

        // File still changing, retry with longer wait
        continue;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          // File deleted between stat and read
          throw new Error(`File disappeared: ${path}`);
        }

        if (attempt === maxAttempts - 1) {
          throw error;
        }

        // Retry on other errors
        continue;
      }
    }

    // Log file never stabilized
    await this.logger.warn("watcher.file_unstable", path, {
      max_attempts: maxAttempts,
    });

    throw new Error(`File never stabilized: ${path}`);
  }
}
