/**
 * @module DaemonAdapter
 * @path src/services/adapters/daemon_adapter.ts
 * @description Module for DaemonAdapter.
 * @architectural-layer Services
 * * @related-files [src/cli/commands/daemon_commands.ts, src/shared/interfaces/i_daemon_service.ts]
 */

import { DaemonCommands } from "../../cli/commands/daemon_commands.ts";
import { IDaemonService } from "../../shared/interfaces/i_daemon_service.ts";
import { DaemonStatus } from "../../shared/enums.ts";
import { join } from "@std/path";
import { exists } from "@std/fs";

export class DaemonServiceAdapter implements IDaemonService {
  constructor(private commands: DaemonCommands) {}

  async start(): Promise<void> {
    await this.commands.start();
  }

  async stop(): Promise<void> {
    await this.commands.stop();
  }

  async restart(): Promise<void> {
    await this.commands.restart();
  }

  async getStatus(): Promise<DaemonStatus> {
    const status = await this.commands.status();
    return status.running ? DaemonStatus.RUNNING : DaemonStatus.STOPPED;
  }

  async getLogs(): Promise<string[]> {
    // Access protected config via any casting for now
    const config = this.commands.getConfig();
    if (!config) return ["Configuration not available."];

    const logFile = join(config.system.root!, config.paths.runtime!, "daemon.log");

    try {
      if (!await exists(logFile)) {
        return ["No logs found (daemon may not have started)."];
      }
      const content = await Deno.readTextFile(logFile);
      return content.split("\n").slice(-50);
    } catch (error) {
      return [`Error reading logs: ${error instanceof Error ? error.message : String(error)}`];
    }
  }

  getErrors(): Promise<string[]> {
    // Daemon errors are usually in the log file.
    return Promise.resolve([]);
  }
}
