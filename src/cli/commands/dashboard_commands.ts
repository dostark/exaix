/**
 * @module DashboardCommands
 * @path src/cli/commands/dashboard_commands.ts
 * @description Provides CLI commands for launching the Terminal User Interface (TUI) dashboard.
 * @architectural-layer CLI
 * * @related-files [src/tui/tui_dashboard.ts, src/cli/main.ts]
 */

import { BaseCommand, type ICommandContext } from "../base.ts";
import { launchTuiDashboard } from "../../tui/tui_dashboard.ts";

export type LaunchDashboardFn = typeof launchTuiDashboard;

export class DashboardCommands extends BaseCommand {
  private launchDashboard: LaunchDashboardFn;

  constructor(context: ICommandContext) {
    super(context);

    this.launchDashboard = launchTuiDashboard;
  }

  static create(context: ICommandContext, deps?: { launchDashboard?: LaunchDashboardFn }): DashboardCommands {
    const commands = new DashboardCommands(context);
    if (deps?.launchDashboard) {
      commands.launchDashboard = deps.launchDashboard;
    }
    return commands;
  }

  async show(): Promise<void> {
    await this.launchDashboard({
      databaseService: this.db,
      config: this.config,
    });
  }
}
