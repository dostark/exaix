/**
 * @module DashboardCommands
 * @path apps/exactl/src/commands/dashboard_commands.ts
 * @description Provides CLI commands for launching the Terminal User Interface (TUI) dashboard.
 * @architectural-layer CLI
 * @related-files [src/tui/tui_dashboard.ts, "apps/daemon/main.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { launchTuiDashboard } from "../../../../src/tui/tui_dashboard.ts";

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
