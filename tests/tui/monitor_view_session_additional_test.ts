/**
 * @module MonitorViewSessionAdditionalTest
 * @path tests/tui/monitor_view_session_additional_test.ts
 * @description Targeted tests for the MonitorTuiSession, specifically focusing on log grouping
 * cycles, bookmarking logic, and dynamic populating of the log detail panel.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { createMonitorViewSession } from "./helpers.ts";
import type { ILogEntry, MonitorTuiSession } from "../../src/tui/monitor_view.ts";
import type { ITreeNode } from "../../src/tui/helpers/tree_view.ts";

function makeLog(overrides: Partial<ILogEntry> = {}): ILogEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    trace_id: overrides.trace_id ?? "trace",
    actor: overrides.actor ?? "actor",
    actor_type: overrides.actor_type ?? null,
    identity_id: overrides.identity_id ?? "agent",
    agent_kind: overrides.agent_kind ?? null,
    action_type: overrides.action_type ?? "request_created",
    target: overrides.target ?? "t",
    payload: overrides.payload ?? { k: 1 },
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

Deno.test("MonitorTuiSession: grouping cycles none -> identity -> action -> none", async () => {
  const logs = [
    makeLog({ id: "1", identity_id: "a1", action_type: "request_created" }),
    makeLog({ id: "2", identity_id: "a2", action_type: "plan_approved" }),
  ];

  const { monitorView: _view, session } = await createMonitorViewSession(logs);

  assertEquals(session.getGroupBy(), "none");
  session.toggleGrouping();
  assertEquals(session.getGroupBy(), "identity");
  assertExists(session.getLogTree().find((n: ITreeNode) => n.id.startsWith("identity-")));

  session.toggleGrouping();
  assertEquals(session.getGroupBy(), "action");
  assertExists(session.getLogTree().find((n: ITreeNode) => n.id.startsWith("action-")));

  session.toggleGrouping();
  assertEquals(session.getGroupBy(), "none");
});

Deno.test("MonitorTuiSession: toggleBookmark ignores group nodes and toggles log nodes", async () => {
  const logs = [makeLog({ id: "1", identity_id: "a1" })];
  const { monitorView: _view, session } = await createMonitorViewSession(logs);
  const monitorSession = session as MonitorTuiSession;

  // force a group node selection
  monitorSession.toggleGrouping();
  monitorSession.toggleBookmark();
  assertEquals(monitorSession.getBookmarkedIds().size, 0);

  // select a log node by rebuilding flat tree
  monitorSession.toggleGrouping();
  monitorSession.toggleGrouping();
  const first = monitorSession.getLogTree()[0];
  monitorSession.state.selectedId = first.id;

  monitorSession.toggleBookmark();
  assertEquals(monitorSession.isBookmarked(first.id), true);
  monitorSession.toggleBookmark();
  assertEquals(monitorSession.isBookmarked(first.id), false);
});

Deno.test("MonitorTuiSession: showLogDetail populates detail panel", async () => {
  const logs = [makeLog({ id: "1", payload: { hello: "world" } })];
  const { monitorView: _view, session } = await createMonitorViewSession(logs);
  const monitorSession = session as MonitorTuiSession;

  monitorSession.showLogDetail("1");

  assertEquals(monitorSession.isDetailVisible(), true);
  assertStringIncludes(monitorSession.getDetailContent(), "Payload:");
  assertStringIncludes(monitorSession.getDetailContent(), "world");
});

Deno.test("MonitorTuiSession: status line reflects paused, bookmarks, and grouping", async () => {
  const logs = [makeLog({ id: "1" })];
  const { monitorView: _view, session } = await createMonitorViewSession(logs);
  const monitorSession = session as MonitorTuiSession;

  // bookmark selected log
  const first = monitorSession.getLogTree()[0];
  monitorSession.state.selectedId = first.id;
  monitorSession.toggleBookmark();

  monitorSession.toggleGrouping();

  // pause
  monitorSession.togglePause();

  const status = monitorSession.renderStatusLine();
  assertStringIncludes(status, "[PAUSED]");
  assertStringIncludes(status, "bookmarked");
  assertStringIncludes(status, "Group:");
});

Deno.test("MonitorTuiSession: renderHelp includes key hints", async () => {
  const logs = [makeLog({ id: "1" })];
  const { monitorView: _view, session } = await createMonitorViewSession(logs);

  const help = session.renderHelp().join("\n");
  assertStringIncludes(help, "Monitor View Help");
  assertStringIncludes(help, "Bookmark");
});
