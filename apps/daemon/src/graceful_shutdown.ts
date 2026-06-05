/**
 * @module GracefulShutdown
 * @path apps/daemon/src/graceful_shutdown.ts
 * @description Manages graceful shutdown of the daemon process, including cleanup task
 * registration, signal handling, and LIFO cleanup execution with timeouts.
 * @architectural-layer Services
 * @related-files ["apps/daemon/main.ts", "packages/core/src/logger/event_logger.ts"]
 */
import { DEFAULT_AI_TIMEOUT_MS } from "@exaix/ai/constants.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";

export interface ICleanupTask {
  name: string;
  handler: () => Promise<void>;
  timeout: number;
}

export class GracefulShutdown {
  private readonly logger: IEventLogger;
  private readonly cleanupTasks: ICleanupTask[] = [];
  private shuttingDown = false;

  constructor(logger: IEventLogger) {
    this.logger = logger;
  }

  registerCleanup(name: string, handler: () => Promise<void>, timeout = DEFAULT_AI_TIMEOUT_MS): void {
    this.cleanupTasks.push({ name, handler, timeout });
  }

  registerSignalHandlers(): void {
    const shutdownHandler = () => {
      this.logger.info(
        DomainEventType.DaemonShutdownSignal,
        "Received termination signal, initiating graceful shutdown",
      );
      this.shutdown(0).catch((error) => {
        this.logger.fatal(DomainEventType.DaemonShutdownCleanupFailed, "Failed to execute graceful shutdown", {
          error: (error as Error).message,
        });
        Deno.exit(1);
      });
    };

    Deno.addSignalListener("SIGINT", shutdownHandler);
    Deno.addSignalListener("SIGTERM", shutdownHandler);

    this.logger.info(DomainEventType.DaemonShutdownSignal, "Signal handlers registered for graceful shutdown");
  }

  registerErrorHandlers(): void {
    globalThis.addEventListener("unhandledrejection", (event) => {
      this.logger.fatal(DomainEventType.DaemonUnhandledRejection, event.reason as string, {
        error: (event.reason as Error)?.message ?? String(event.reason),
      });
      this.shutdown(1).catch(() => {
        Deno.exit(1);
      });
    });

    globalThis.addEventListener(DOM_ERROR_EVENT, (event) => {
      this.logger.fatal(DomainEventType.DaemonUncaughtError, (event.error as Error)?.message ?? "Unknown error", {
        error: (event.error as Error)?.message ?? String(event.error),
      });
      this.shutdown(1).catch(() => {
        Deno.exit(1);
      });
    });

    this.logger.info(DomainEventType.DaemonErrorHandlersRegistered, "Error handlers registered for graceful shutdown");
  }

  async shutdown(exitCode: number, shouldExit = true): Promise<void> {
    if (this.shuttingDown) {
      this.logger.warn(
        DomainEventType.DaemonShutdownDuplicate,
        "Shutdown already in progress, ignoring duplicate shutdown request",
      );
      return;
    }

    this.shuttingDown = true;
    this.logger.info(DomainEventType.DaemonShutdownStarting, "Starting graceful shutdown");

    let hasErrors = false;

    for (let i = this.cleanupTasks.length - 1; i >= 0; i--) {
      const task = this.cleanupTasks[i];
      try {
        this.logger.info(DomainEventType.DaemonShutdownCleanupRunning, task.name);
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
          this.logger.info(DomainEventType.DaemonShutdownCleanupCompleted, task.name);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        const err = error as Error;
        if (err.message.includes("Cleanup timeout")) {
          this.logger.error(DomainEventType.DaemonShutdownCleanupTimedOut, task.name, {
            error: err.message,
          });
        } else {
          this.logger.error(DomainEventType.DaemonShutdownCleanupFailed, task.name, {
            error: err.message,
          });
        }
        hasErrors = true;
      }
    }

    if (hasErrors) {
      this.logger.error(DomainEventType.DaemonShutdownErrors, "Graceful shutdown completed with errors");
      if (shouldExit) Deno.exit(1);
    } else {
      this.logger.info(DomainEventType.DaemonShutdownComplete, "Graceful shutdown completed successfully");
      if (shouldExit) Deno.exit(exitCode);
    }
  }
}

const DOM_ERROR_EVENT = "error";
