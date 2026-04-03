/**
 * @module ProcessManager
 * @path src/services/agent/process_manager.ts
 * @description Service for managing subprocess lifecycles, ensuring cleanup of child PIDs on exit.
 * @architectural-layer Services
 * @related-files [src/services/agent/strategies/mcp_agent_strategy.ts]
 */

/**
 * Process manager for tracking and cleaning up spawned subprocesses
 */
export class ProcessManager {
  private activeProcesses: Set<number> = new Set();
  private signalHandlers: Map<Deno.Signal, () => void> = new Map();

  constructor() {
    this.registerSignalHandlers();
  }

  /**
   * Track a new PID
   */
  track(pid: number): void {
    this.activeProcesses.add(pid);
  }

  /**
   * Stop tracking a PID (e.g., after clean exit)
   */
  untrack(pid: number): void {
    this.activeProcesses.delete(pid);
  }

  /**
   * Terminate all tracked processes
   */
  terminateAll(): void {
    for (const pid of this.activeProcesses) {
      try {
        console.log(`[ProcessManager] Terminating child process PID ${pid}...`);
        Deno.kill(pid, "SIGTERM");
      } catch (_error) {
        // PID might already be gone
      }
    }
    this.activeProcesses.clear();
  }

  private registerSignalHandlers(): void {
    const signals: Deno.Signal[] = ["SIGINT", "SIGTERM"];

    for (const signal of signals) {
      const handler = () => {
        console.log(`[ProcessManager] Caught ${signal}, cleaning up subprocesses...`);
        this.terminateAll();
        // Since we are adding our own listeners, we need to make sure we don't block the exit
        // but we also don't want to prematurely exit.
        // Deno by default exits after SIGINT unless we prevent it.
        Deno.exit(0);
      };

      this.signalHandlers.set(signal, handler);
      try {
        Deno.addSignalListener(signal, handler);
      } catch (_error) {
        // Signals might not be supported in some environments (e.g. Windows)
      }
    }
  }

  /**
   * Cleanup signal listeners (for testing/shutdown)
   */
  cleanup(): void {
    for (const [signal, handler] of this.signalHandlers) {
      try {
        Deno.removeSignalListener(signal, handler);
      } catch (_error) {
        // Ignore
      }
    }
  }
}
