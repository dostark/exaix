/**
 * @module ProcessManager
 * @path packages/core/src/process_manager.ts
 * @description Service for managing subprocess lifecycles, ensuring cleanup of child PIDs on exit.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [packages/execution/src/strategies/mcp_agent_strategy.ts]
 */

export class ProcessManager {
  private activeProcesses: Set<number> = new Set();
  private signalHandlers: Map<Deno.Signal, () => void> = new Map();

  constructor() {
    this.registerSignalHandlers();
  }

  track(pid: number): void {
    this.activeProcesses.add(pid);
  }

  untrack(pid: number): void {
    this.activeProcesses.delete(pid);
  }

  terminateAll(): void {
    for (const pid of this.activeProcesses) {
      try {
        console.log(`[ProcessManager] Terminating child process PID ${pid}...`);
        Deno.kill(pid, "SIGTERM");
      } catch {
        // ignore
        // Process may already be terminated
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
        Deno.exit(0);
      };

      this.signalHandlers.set(signal, handler);
      try {
        Deno.addSignalListener(signal, handler);
      } catch {
        // ignore
        // Process may already be terminated
      }
    }
  }

  cleanup(): void {
    for (const [signal, handler] of this.signalHandlers) {
      try {
        Deno.removeSignalListener(signal, handler);
      } catch {
        // ignore
        // Process may already be terminated
      }
    }
  }

  dispose(): void {
    this.terminateAll();
    this.cleanup();
    this.signalHandlers.clear();
  }
}
