/**
 * @module DashboardCommands
 * @path apps/exactl/src/commands/dashboard_commands.ts
 * @description Provides CLI commands for launching the Terminal User Interface (TUI) dashboard.
 * Delegates to apps/tui/main.ts via subprocess.
 * @architectural-layer CLI
 * @related-files ["apps/tui/main.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { dirname, fromFileUrl, join } from "@std/path";
import { STDIO_INHERIT } from "./constants.ts";

const TUI_ENTRY = "apps/tui/main.ts";

export class DashboardCommands extends BaseCommand {
  private launchDashboard: () => Promise<void>;

  constructor(context: ICommandContext) {
    super(context);
    this.launchDashboard = () => this.runTuiSubprocess();
  }

  static create(
    context: ICommandContext,
    deps?: { launchDashboard?: () => Promise<void> },
  ): DashboardCommands {
    const commands = new DashboardCommands(context);
    if (deps?.launchDashboard) {
      commands.launchDashboard = deps.launchDashboard;
    }
    return commands;
  }

  protected runTuiSubprocess(): Promise<void> {
    const repoRoot = resolveRepoRoot();
    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", TUI_ENTRY],
      cwd: repoRoot,
      stdout: STDIO_INHERIT,
      stderr: STDIO_INHERIT,
      stdin: STDIO_INHERIT,
    });
    const child = cmd.spawn();
    return child.status.then((status) => {
      if (!status.success) {
        throw new Error(`TUI dashboard exited with code ${status.code}`);
      }
    });
  }

  async show(): Promise<void> {
    await this.launchDashboard();
  }
}

function resolveRepoRoot(): string {
  const __dirname = dirname(fromFileUrl(import.meta.url));
  return join(__dirname, "..", "..", "..", "..");
}
