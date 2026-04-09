/**
 * @module DaemonControlViewTest
 * @path tests/tui/daemon_control_view_test.ts
 * @description Verifies the DaemonControlView TUI component, ensuring interactive control
 * over the Exaix daemon, including lifecycle actions and real-time log streaming.
 */

import { assert, assertEquals } from "@std/assert";
import { DaemonKeyAction, DaemonStatus } from "../../src/shared/enums.ts";
import { setupDaemonTest } from "./daemon_test_utils.ts";
import type { IDaemonService } from "../../src/shared/interfaces/i_daemon_service.ts";
import {
  CLIDaemonService,
  DAEMON_KEY_BINDINGS,
  DAEMON_STATUS_COLORS,
  DAEMON_STATUS_ICONS,
  DaemonControlView,
  type IDaemonViewState,
  MinimalDaemonServiceMock,
} from "../../src/tui/daemon_control_view.ts";
import { KEYS } from "../../src/tui/helpers/keyboard.ts";

// ===== Mock CLI Daemon Service for testing (no real process spawn) =====

class MockCLIDaemonService implements IDaemonService {
  state = DaemonStatus.STOPPED;
  logs: string[] = [];
  errors: string[] = [];

  start() {
    this.state = DaemonStatus.RUNNING;
    return Promise.resolve();
  }
  stop() {
    this.state = DaemonStatus.STOPPED;
    return Promise.resolve();
  }
  restart() {
    this.state = DaemonStatus.RUNNING;
    return Promise.resolve();
  }
  getStatus() {
    return Promise.resolve(this.state);
  }
  getLogs() {
    return Promise.resolve(this.logs);
  }
  getErrors() {
    return Promise.resolve(this.errors);
  }
}

// ===== Existing Tests (Updated) =====

Deno.test("DaemonControlView: shows daemon status and logs", async () => {
  const service = new MockCLIDaemonService();
  service.state = DaemonStatus.RUNNING;
  service.logs = ["Started", "No errors"];
  const view = new DaemonControlView(service);
  assertEquals(await view.getStatus(), DaemonStatus.RUNNING);
  assertEquals((await view.getLogs()).length, 2);
});

Deno.test("DaemonControlView: can start, stop, and restart daemon", async () => {
  const service = new MockCLIDaemonService();
  const view = new DaemonControlView(service);
  await view.start();
  assertEquals(await service.getStatus(), DaemonStatus.RUNNING);
  await view.stop();
  assertEquals(await service.getStatus(), DaemonStatus.STOPPED);
  await view.restart();
  assertEquals(await service.getStatus(), DaemonStatus.RUNNING);
});

Deno.test("DaemonControlView: displays errors and handles error state", async () => {
  const service = new MockCLIDaemonService();
  service.errors = ["Crash detected", "Permission denied"];
  const view = new DaemonControlView(service);
  assertEquals((await view.getErrors()).length, 2);
  assert((await view.getErrors())[0].includes("Crash"));
});

Deno.test("DaemonControlView: handles rapid state changes and recovers", async () => {
  const service = new MockCLIDaemonService();
  const view = new DaemonControlView(service);
  await view.start();
  await view.stop();
  await view.start();
  assertEquals(await service.getStatus(), DaemonStatus.RUNNING);
});

Deno.test("CLIDaemonService: start, stop, restart, getStatus, getLogs, getErrors", async () => {
  const service = new CLIDaemonService();
  // These will actually run CLI commands; in CI, may need to mock Deno.Command
  await service.start();
  await service.stop();
  await service.restart();
  const status = await service.getStatus();
  const logs = await service.getLogs();
  const errors = await service.getErrors();
  // Just check types and basic expectations
  assert(typeof status === "string");
  assert(Array.isArray(logs));
  assert(Array.isArray(errors));
});

// ===== Phase 13.8: DaemonViewState Tests =====

Deno.test("DaemonViewState: interface has all required properties", () => {
  // TypeScript compile-time check via usage
  const state: IDaemonViewState = {
    status: DaemonStatus.UNKNOWN,
    showHelp: false,
    showLogs: false,
    showConfig: false,
    logContent: [],
    errorContent: [],
    activeDialog: null,
    lastStatusCheck: null,
    autoRefresh: false,
    autoRefreshInterval: 5000,
  };
  assertEquals(state.status, DaemonStatus.UNKNOWN);
});

// ===== Phase 13.8: Icon Tests =====

Deno.test("DAEMON_STATUS_ICONS: has all status types", () => {
  const requiredKeys = [DaemonStatus.RUNNING, DaemonStatus.STOPPED, "error", DaemonStatus.UNKNOWN];
  for (const key of requiredKeys) {
    if (!DAEMON_STATUS_ICONS[key]) {
      throw new Error(`Missing status icon for: ${key}`);
    }
  }
});

Deno.test("DAEMON_STATUS_COLORS: has all status types", () => {
  const requiredKeys = [DaemonStatus.RUNNING, DaemonStatus.STOPPED, "error", DaemonStatus.UNKNOWN];
  for (const key of requiredKeys) {
    if (!DAEMON_STATUS_COLORS[key]) {
      throw new Error(`Missing color for: ${key}`);
    }
  }
});

// ===== Phase 13.8: Key Bindings Tests =====

Deno.test("DAEMON_KEY_BINDINGS: has all expected bindings", () => {
  const requiredActions = [
    DaemonKeyAction.START,
    DaemonKeyAction.STOP,
    DaemonKeyAction.RESTART,
    DaemonKeyAction.VIEW_LOGS,
    DaemonKeyAction.VIEW_CONFIG,
    DaemonKeyAction.REFRESH,
    DaemonKeyAction.HELP,
  ];
  const bindingActions = DAEMON_KEY_BINDINGS.map((b) => b.action);
  for (const action of requiredActions) {
    if (!bindingActions.includes(action)) {
      throw new Error(`Missing key binding for action: ${action}`);
    }
  }
});

Deno.test("DAEMON_KEY_BINDINGS: each has key, action, description, category", () => {
  for (const binding of DAEMON_KEY_BINDINGS) {
    if (!binding.key || !binding.action || !binding.description || !binding.category) {
      throw new Error(`Incomplete key binding: ${JSON.stringify(binding)}`);
    }
  }
});

// ===== Phase 13.8: TUI Session Tests =====

Deno.test("DaemonControlTuiSession: initializes correctly", async () => {
  const { session } = await setupDaemonTest({
    initialStatus: DaemonStatus.RUNNING,
  });
  await session.initialize();
  assertEquals(session.getDaemonStatus(), DaemonStatus.RUNNING);
});

Deno.test("DaemonControlTuiSession: help screen toggle", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  assert(!session.isHelpVisible());

  session.toggleHelp();
  assert(session.isHelpVisible());

  session.toggleHelp();
  assert(!session.isHelpVisible());
});

Deno.test("DaemonControlTuiSession: getHelpSections returns sections", async () => {
  const { session } = await setupDaemonTest();

  const sections = session.getHelpSections();
  assert(sections.length >= 3);

  for (const section of sections) {
    if (!section.title || !section.items || section.items.length === 0) {
      throw new Error(`Invalid help section: ${JSON.stringify(section)}`);
    }
  }
});

Deno.test("DaemonControlTuiSession: renderStatusPanel returns lines", async () => {
  const { session } = await setupDaemonTest({
    initialStatus: DaemonStatus.RUNNING,
  });
  await session.initialize();

  const lines = session.renderStatusPanel();
  assert(Array.isArray(lines));
  assert(lines.length > 5);
  assert(lines.some((line) => line.includes("STATUS")));
});

Deno.test("DaemonControlTuiSession: renderLogs returns lines", async () => {
  const { session } = await setupDaemonTest({
    logs: ["Log line 1", "Log line 2"],
  });
  await session.initialize();

  await session.showLogs();
  const lines = session.renderLogs();
  assert(Array.isArray(lines));
  assert(lines.length > 3);
});

Deno.test("DaemonControlTuiSession: renderConfig returns lines", async () => {
  const { session } = await setupDaemonTest();

  session.showConfig();
  const lines = session.renderConfig();
  assert(Array.isArray(lines));
  assert(lines.length > 3);
});

Deno.test("DaemonControlTuiSession: renderHelp returns lines", async () => {
  const { session } = await setupDaemonTest();

  const lines = session.renderHelp();
  assert(Array.isArray(lines));
  assert(lines.length > 0);
});

Deno.test("DaemonControlTuiSession: logs view show/hide", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  assert(!session.isLogsVisible());

  await session.showLogs();
  assert(session.isLogsVisible());

  session.hideLogs();
  assert(!session.isLogsVisible());
});

Deno.test("DaemonControlTuiSession: config view show/hide", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  assert(!session.isConfigVisible());

  session.showConfig();
  assert(session.isConfigVisible());

  session.hideConfig();
  assert(!session.isConfigVisible());
});

Deno.test("DaemonControlTuiSession: auto-refresh toggle", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  assert(!session.isAutoRefreshEnabled());

  session.toggleAutoRefresh();
  assert(session.isAutoRefreshEnabled());

  session.toggleAutoRefresh();
  assert(!session.isAutoRefreshEnabled());

  session.dispose();
});

Deno.test("DaemonControlTuiSession: confirm dialogs for start", async () => {
  const { session } = await setupDaemonTest({
    initialStatus: DaemonStatus.STOPPED,
  });
  await session.initialize();

  session.showStartConfirm();
  assert(session.hasActiveDialog());
});

Deno.test("DaemonControlTuiSession: confirm dialogs for stop", async () => {
  const { session } = await setupDaemonTest({
    initialStatus: DaemonStatus.RUNNING,
  });
  await session.initialize();

  session.showStopConfirm();
  assert(session.hasActiveDialog());
});

Deno.test("DaemonControlTuiSession: confirm dialogs for restart", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  session.showRestartConfirm();
  assert(session.hasActiveDialog());
});

Deno.test("DaemonControlTuiSession: getFocusableElements", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  const elements = session.getFocusableElements();
  assert(Array.isArray(elements));
  assert(elements.length >= 4);
});

Deno.test("DaemonControlTuiSession: handleKey help toggle", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  await session.handleKey(KEYS.QUESTION);
  assert(session.isHelpVisible());

  await session.handleKey(KEYS.ESCAPE);
  assert(!session.isHelpVisible());
});

Deno.test("DaemonControlTuiSession: handleKey logs", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  await session.handleKey(KEYS.L);
  assert(session.isLogsVisible());

  await session.handleKey(KEYS.Q);
  assert(!session.isLogsVisible());
});

Deno.test("DaemonControlTuiSession: handleKey config", async () => {
  const { session } = await setupDaemonTest();
  await session.initialize();

  await session.handleKey(KEYS.C);
  assert(session.isConfigVisible());

  await session.handleKey(KEYS.ESCAPE);
  assert(!session.isConfigVisible());
});

Deno.test("DaemonControlTuiSession: getViewName", async () => {
  const { session } = await setupDaemonTest();

  assertEquals(session.getViewName(), "Daemon Control");
});

Deno.test("DaemonControlTuiSession: getKeyBindings", async () => {
  const { session } = await setupDaemonTest();

  const bindings = session.getKeyBindings();
  assertEquals(bindings, DAEMON_KEY_BINDINGS);
});

Deno.test("MinimalDaemonServiceMock: works correctly", async () => {
  const mock = new MinimalDaemonServiceMock();

  assertEquals(await mock.getStatus(), DaemonStatus.STOPPED);

  await mock.start();
  assertEquals(await mock.getStatus(), DaemonStatus.RUNNING);

  await mock.stop();
  assertEquals(await mock.getStatus(), DaemonStatus.STOPPED);

  const logs = await mock.getLogs();
  assert(Array.isArray(logs));
  assert(logs.length >= 2); // start and stop logs

  mock.setErrors(["Test error"]);
  const errors = await mock.getErrors();
  assertEquals(errors.length, 1);
});
