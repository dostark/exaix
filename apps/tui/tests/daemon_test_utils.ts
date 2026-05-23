/**
 * @module DaemonTestUtils
 * @path apps/tui/tests/daemon_test_utils.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Common utilities for TUI daemon tests, providing mock services for
 * simulating daemon state, lifecycle operations, and activity logs.
 */

import type { DaemonStatus } from "@exaix/core";
import { DaemonControlView, MinimalDaemonServiceMock } from "../src/daemon_control_view.ts";

export function setupDaemonTest(options: {
  autoRefresh?: boolean;
  initialStatus?: DaemonStatus;
  logs?: string[];
  errors?: string[];
} = {}): {
  mock: MinimalDaemonServiceMock;
  view: DaemonControlView;
  session: ReturnType<DaemonControlView["createTuiSession"]>;
} {
  // await Promise.resolve(); // Satisfy linter for async function if needed, but not strictly required
  const mock = new MinimalDaemonServiceMock();
  if (options.initialStatus) mock.setStatus(options.initialStatus);
  if (options.logs) mock.setLogs(options.logs);
  if (options.errors) mock.setErrors(options.errors);

  const view = new DaemonControlView(mock);
  const session = view.createTuiSession(options.autoRefresh ?? false);

  if (options.initialStatus) {
    // Logic from original test helper
  }

  return { mock, view, session };
}
