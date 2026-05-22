/**
 * @module LayoutPersistenceTest
 * @path packages/tui/tests/layout/layout_persistence_test.ts
 * @description Verifies the logic for saving and restoring TUI layout configurations,
 * ensuring stable filesystem persistence and graceful handling of missing or malformed data.
 */

import { assertAlmostEquals, assertEquals, assertExists, assertStringIncludes } from "@std/assert";

import {
  getLayoutFile,
  type ITuiLayoutPersistencePane,
  type ITuiLayoutPersistenceView,
  resetToDefault,
  restoreLayout,
  saveLayout,
} from "@exaix/tui/layout/persistence.ts";
import { TUI_LAYOUT_DEFAULT_HEIGHT, TUI_LAYOUT_FULL_WIDTH } from "@exaix/tui/helpers/constants.ts";

import { makePersistencePane } from "./layout_test_helper.ts";

async function withTempHome(fn: (home: string) => Promise<void> | void): Promise<void> {
  const originalHome = Deno.env.get("HOME");
  const tempHome = await Deno.makeTempDir({ prefix: "exaix-home-" });
  Deno.env.set("HOME", tempHome);
  try {
    await fn(tempHome);
  } finally {
    if (originalHome === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", originalHome);

    await Deno.remove(tempHome, { recursive: true });
  }
}

Deno.test("saveLayout: writes layout JSON and notifies success", async () => {
  await withTempHome(async () => {
    const panes: ITuiLayoutPersistencePane[] = [
      makePersistencePane("main", "MainView", {
        focused: true,
        flexX: 0.1,
        flexY: 0.2,
        flexWidth: 0.5,
        flexHeight: 0.6,
      }),
      makePersistencePane("side", "SideView", { flexX: 0.6, flexY: 0.2, flexWidth: 0.4, flexHeight: 0.6 }),
    ];

    const notifications: Array<{ m: string; t?: string }> = [];
    await saveLayout(panes, "main", (m, t) => notifications.push({ m, t }));

    assertEquals(notifications.at(-1)?.m, "Layout saved");
    assertEquals(notifications.at(-1)?.t, "SUCCESS");

    const layoutPath = getLayoutFile();
    const raw = await Deno.readTextFile(layoutPath);
    const parsed = JSON.parse(raw);

    assertEquals(parsed.version, "1.2");
    assertEquals(parsed.activePaneId, "main");
    assertEquals(parsed.panes.length, 2);
    assertEquals(parsed.panes[0].id, "main");
    assertEquals(parsed.panes[0].viewName, "MainView");
  });
});

Deno.test("saveLayout: notifies error when ~/.exaix is a file", async () => {
  await withTempHome(async (home) => {
    await Deno.writeTextFile(`${home}/.exaix`, "not a dir");

    const panes: ITuiLayoutPersistencePane[] = [makePersistencePane("main", "MainView")];
    const notifications: Array<{ m: string; t?: string }> = [];

    await saveLayout(panes, "main", (m, t) => notifications.push({ m, t }));

    const last = notifications.at(-1);
    assertExists(last);
    assertStringIncludes(last.m, "Failed to save layout:");
    assertEquals(last.t, "ERROR");
  });
});

Deno.test("restoreLayout: returns null when file missing", async () => {
  await withTempHome(async () => {
    const panes: ITuiLayoutPersistencePane[] = [makePersistencePane("main", "MainView")];
    const notifications: Array<{ m: string; t?: string }> = [];

    const result = await restoreLayout(panes, [{ name: "MainView" }], (m, t) => notifications.push({ m, t }));

    assertEquals(result, null);
    assertEquals(notifications.length, 0);
  });
});

Deno.test("restoreLayout: restores v1.2 flex layout and notifies", async () => {
  await withTempHome(async () => {
    const panes: ITuiLayoutPersistencePane[] = [makePersistencePane("main", "MainView")];
    const views: ITuiLayoutPersistenceView[] = [{ name: "MainView" }, { name: "OtherView" }];

    const layout = {
      version: "1.2",
      activePaneId: "side",
      panes: [
        {
          id: "side",
          viewName: "OtherView",
          flexX: 0.25,
          flexY: 0.5,
          flexWidth: 0.5,
          flexHeight: 0.25,
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          focused: true,
          maximized: true,
        },
      ],
    };

    await Deno.mkdir(`${Deno.env.get("HOME")}/.exaix`, { recursive: true });
    await Deno.writeTextFile(getLayoutFile(), JSON.stringify(layout));

    const notifications: Array<{ m: string; t?: string }> = [];
    const result = await restoreLayout(panes, views, (m, t) => notifications.push({ m, t }));

    assertEquals(result?.activePaneId, "side");
    assertEquals(notifications.at(-1)?.m, "Layout restored");
    assertEquals(notifications.at(-1)?.t, "SUCCESS");

    assertEquals(panes.length, 1);
    assertEquals(panes[0].id, "side");
    assertEquals(panes[0].view.name, "OtherView");
    assertEquals(panes[0].maximized, true);
  });
});

Deno.test("restoreLayout: upgrades v1.0 absolute coords to flex", async () => {
  await withTempHome(async () => {
    const panes: ITuiLayoutPersistencePane[] = [makePersistencePane("main", "MainView")];
    const views: ITuiLayoutPersistenceView[] = [{ name: "MainView" }];

    const x = 10;
    const y = 5;
    const width = 20;
    const height = 10;

    const layout = {
      version: "1.0",
      panes: [
        {
          id: "main",
          viewName: "MainView",
          x,
          y,
          width,
          height,
          focused: true,
        },
      ],
    };

    await Deno.mkdir(`${Deno.env.get("HOME")}/.exaix`, { recursive: true });
    await Deno.writeTextFile(getLayoutFile(), JSON.stringify(layout));

    const result = await restoreLayout(panes, views, () => {});
    assertEquals(result?.activePaneId, "main");

    assertAlmostEquals(panes[0].flexX, x / TUI_LAYOUT_FULL_WIDTH);
    assertAlmostEquals(panes[0].flexY, y / TUI_LAYOUT_DEFAULT_HEIGHT);
    assertAlmostEquals(panes[0].flexWidth, width / TUI_LAYOUT_FULL_WIDTH);
    assertAlmostEquals(panes[0].flexHeight, height / TUI_LAYOUT_DEFAULT_HEIGHT);
  });
});

Deno.test("resetToDefault: resets panes and returns 'main'", () => {
  const panes: ITuiLayoutPersistencePane[] = [makePersistencePane("a", "A"), makePersistencePane("b", "B")];
  const views: ITuiLayoutPersistenceView[] = [{ name: "MainView" }];
  const notifications: string[] = [];

  const active = resetToDefault(panes, views, (m) => notifications.push(m));

  assertEquals(active, "main");
  assertEquals(panes.length, 1);
  assertEquals(panes[0].id, "main");
  assertEquals(panes[0].width, TUI_LAYOUT_FULL_WIDTH);
  assertEquals(panes[0].height, TUI_LAYOUT_DEFAULT_HEIGHT);
  assertEquals(notifications.at(-1), "Layout reset to default");
});
