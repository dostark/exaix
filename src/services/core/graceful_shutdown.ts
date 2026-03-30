/**
 * @module GracefulShutdown
 * @path src/services/graceful_shutdown.ts
 * @description Module for GracefulShutdown.
 * @architectural-layer Services
 * @dependencies [StructuredLogger]
 * @related-files [src/main.ts, src/services/structured_logger.ts]
 */

import type { IStructuredLogger } from "../logger/structured_logger.ts";

/**
 * Cleanup task interface for graceful shutdown
 */
export interface ICleanupTask {
  name: string;
  handler: () => Promise<void>;
  timeout: number;
}
export class GracefulShutdown {
  private readonly logger: IStructuredLogger;
  private readonly cleanupTasks: ICleanupTask[] = [];
  private shuttingDown = false;

  constructor(logger: IStructuredLogger) {
    this.logger = logger;
  }

  /**
   * Register a cleanup task to be executed during shutdown
   * @param name - Unique name for the cleanup task
   * @param handler - Async function to execute during shutdown
   * @param timeout - Timeout in milliseconds (default: 30000)
   */
  registerCleanup(name: string, handler: () => Promise<void>, timeout = 30000): void {
    this.cleanupTasks.push({ name, handler, timeout });
  }

  /**
   * Register signal handlers for SIGINT and SIGTERM
   */
  registerSignalHandlers(): void {
    const shutdownHandler = () => {
      this.logger.info("Received termination signal, initiating graceful shutdown");
      this.shutdown(0).catch((error) => {
        this.logger.fatal("Failed to execute graceful shutdown", error as Error);
        Deno.exit(1);
      });
    };

    // Register signal listeners
    Deno.addSignalListener("SIGINT", shutdownHandler);
    Deno.addSignalListener("SIGTERM", shutdownHandler);

    this.logger.info("Signal handlers registered for graceful shutdown");
  }

  /**
   * Register handlers for unhandled errors and promise rejections
   */
  registerErrorHandlers(): void {
    // Handle unhandled promise rejections
    globalThis.addEventListener("unhandledrejection", (event) => {
      this.logger.fatal("Unhandled promise rejection", event.reason as Error);
      this.shutdown(1).catch(() => {
        // If shutdown fails, force exit
        Deno.exit(1);
      });
    });

    // Handle uncaught errors
    globalThis.addEventListener("error", (event) => {
      this.logger.fatal("Uncaught error", event.error as Error);
      this.shutdown(1).catch(() => {
        // If shutdown fails, force exit
        Deno.exit(1);
      });
    });

    this.logger.info("Error handlers registered for graceful shutdown");
  }

  /**
   * Execute graceful shutdown sequence
   * @param exitCode - The exit code to use when shutting down
   * @param shouldExit - Whether to actually exit the process (default: true)
   */
  async shutdown(exitCode: number, shouldExit = true): Promise<void> {
    if (this.shuttingDown) {
      this.logger.warn("Shutdown already in progress, ignoring duplicate shutdown request");
      return;
    }

    this.shuttingDown = true;
    this.logger.info("Starting graceful shutdown");

    let hasErrors = false;

    // Execute cleanup tasks in reverse order (LIFO)
    for (let i = this.cleanupTasks.length - 1; i >= 0; i--) {
      const task = this.cleanupTasks[i];
      try {
        this.logger.info(`Running cleanup: ${task.name}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, task.timeout);

        try {
          await Promise.race([
            task.handler(),
            new Promise<never>((_, reject) => {
              controller.signal.addEventListener("abort", () => {
                reject(new Error(`Cleanup timeout: ${task.name}`));
              });
            }),
          ]);
          this.logger.info(`Cleanup completed: ${task.name}`);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        const err = error as Error;
        if (err.message.includes("Cleanup timeout")) {
          this.logger.error(`Cleanup timed out: ${task.name}`, err);
        } else {
          this.logger.error(`Cleanup failed: ${task.name}`, err);
        }
        hasErrors = true;
      }
    }

    if (hasErrors) {
      this.logger.error("Graceful shutdown completed with errors");
      if (shouldExit) Deno.exit(1);
    } else {
      this.logger.info("Graceful shutdown completed successfully");
      if (shouldExit) Deno.exit(exitCode);
    }
  }
}
