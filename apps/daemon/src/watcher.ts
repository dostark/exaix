/**
 * @module FileWatcher
 * @path apps/daemon/src/watcher.ts
 * @description Monitors the workspace for file system events (new requests, approved plans).
 * Implements debouncing and stability verification to ensure files are fully written before processing.
 * @architectural-layer Services
 * @related-files ["apps/daemon/main.ts", "packages/request/src/processor.ts"]
 */
import { DomainEventType } from "@exaix/core/events";
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
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

export interface IFileWatcherOptions {
  db?: DatabaseService;
  customWatchPath?: string;
  extensions?: string[];
}

export class FileWatcher {
  private watchPath: string;
  private debounceMs: number;
  private stabilityCheck: boolean;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private processingFiles: Set<string> = new Set();
  private onFileReady: (event: IFileReadyEvent) => void | Promise<void>;
  private abortController: AbortController | null = null;
  private fsWatcher: Deno.FsWatcher | null = null;
  /** The detached consume-loop promise (set by start(), awaited by run()). */
  private runPromise: Promise<void> = Promise.resolve();
  private logger: EventLogger;
  private extensions: string[];

  constructor(
    config: Config,
    onFileReady: (event: IFileReadyEvent) => void | Promise<void>,
    options: IFileWatcherOptions = {},
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
   * Establish the file-system watch and signal readiness. Returns once the watch is open and
   * `watcher.started` has been journalled — NOT when watching ends. The consume-loop runs detached
   * via `run()`, so callers awaiting `start()` know the watcher is genuinely listening (this lets
   * the daemon emit `daemon.ready` only after every watcher is ready — no race window). To block
   * until the watcher stops (e.g. to keep a process alive), await `run()` after `start()`.
   */
  async start(): Promise<void> {
    this.abortController = new AbortController();

    let watcher: Deno.FsWatcher;
    try {
      // Hand-rolled consume-loop below already debounces (per-path timers) + dedups (processingFiles
      // set) + isolates errors, so it is safe. Adopt @exaix/core/fs `consumeFsEvents` (CODE_STYLE §7
      // Filesystem Watching) when this watcher is next refactored, to converge on the shared pattern.
      watcher = Deno.watchFs(this.watchPath, { recursive: false });
    } catch (error) {
      await this.logger.error(DomainEventType.WatcherError, this.watchPath, {
        error_type: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
        error_message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Deno.errors.NotFound) {
        console.error(`❌ Watch directory not found: ${this.watchPath}`);
        console.error(`   Create it with: mkdir -p "${this.watchPath}"`);
      }
      throw error;
    }
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

    // Carry the consume-loop detached so start() resolves at readiness. The loop's promise is
    // retained so run() can await the same completion (used by long-lived hosts to stay alive).
    this.runPromise = this.consume(watcher);
  }

  /**
   * Resolves when the watcher's consume-loop ends (on stop / abort). Await this to keep a
   * long-lived process alive after start(). Safe to call before start() (resolves immediately).
   */
  async run(): Promise<void> {
    await this.runPromise;
  }

  /** The detached consume-loop: drain FS events until aborted, debouncing eligible files. */
  private async consume(watcher: Deno.FsWatcher): Promise<void> {
    try {
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
      // A close() during stop() surfaces here as a benign interruption — only log real errors.
      if (this.abortController?.signal.aborted) {
        return;
      }
      await this.logger.error(DomainEventType.WatcherError, this.watchPath, {
        error_type: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
        error_message: error instanceof Error ? error.message : String(error),
      });
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
      await this.logger.debug(DomainEventType.WatcherFileAlreadyProcessing, path, {
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
      await this.logger.info(DomainEventType.WatcherFileReady, path, {
        content_length: content.length,
        stability_check_used: this.stabilityCheck,
      });

      // Emit event
      await this.onFileReady({ path, content });
    } catch (error) {
      // Log file processing error
      await this.logger.warn(DomainEventType.WatcherFileError, path, {
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
            await this.logger.debug(DomainEventType.WatcherFileStable, path, {
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
    await this.logger.warn(DomainEventType.WatcherFileUnstable, path, {
      max_attempts: maxAttempts,
    });

    throw new Error(`File never stabilized: ${path}`);
  }
}
