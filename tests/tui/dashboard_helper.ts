/**
 * @module TUIDashboardHelper
 * @path tests/tui/dashboard_helper.ts
 * @description Provides shared setup and assertion logic for the main TUI Dashboard,
 * coordinating mock services and keyboard event routing.
 */

import { launchTuiDashboard } from "../../src/tui/tui_dashboard.ts";
import { NotificationService } from "@exaix/core/notification";
import { initTestDbService } from "../helpers/db.ts";

import type { ITuiDashboard } from "../../src/tui/tui_dashboard.ts";
import type { IDatabaseService } from "../../src/services/core/db.ts";

interface TestDashboardProps {
  nonInteractive?: boolean;
  databaseService?: IDatabaseService;
  notificationService?: NotificationService;
  testMode?: boolean;
}

/**
 * Creates a TUI dashboard with a real NotificationService backed by an ephemeral test DB.
 */
export async function createTuiDashboardWithNotification(testProps: TestDashboardProps = {}): Promise<{
  dashboard: ITuiDashboard;
  notificationService: NotificationService;
  db: IDatabaseService;
  cleanup: () => Promise<void>;
}> {
  const { db, config, cleanup } = await initTestDbService();
  const notificationService = new NotificationService(config, db);

  const dashboard = await launchTuiDashboard({
    testMode: true,
    notificationService,
    ...testProps,
  }) as ITuiDashboard;

  return { dashboard, notificationService, db, cleanup };
}
