/**
 * @module TUIRendererTestUtils
 * @path tests/tui/renderer_test_utils.ts
 * @description Common utilities for TUI rendering tests, providing shared visual
 * primitives and ANSI-aware line matching logic.
 */

import process from "node:process";
import { type IPane } from "../../src/tui/tui_dashboard.ts";
import { noColorTheme } from "../../src/tui/helpers/colors.ts";
import { prodRender } from "../../src/tui/dashboard/renderer.ts";
import { type INotificationService } from "../../src/services/notification.ts";
import { type IMemoryNotification } from "../../src/shared/types/notification.ts";
import { type IPortalDetails, type IPortalInfo } from "../../src/shared/types/portal.ts";
import { type IDashboardViewState } from "../../src/tui/tui_dashboard.ts";
import { type IPortalService } from "../../src/shared/interfaces/i_portal_service.ts";
import { makePane } from "./layout_test_utils.ts";

// ===== Types =====

export type CapturedConsole = {
  logs: string[];
  clears: number;
};

export { makePane };

export function captureConsole(): { captured: CapturedConsole; restore: () => void } {
  const captured: CapturedConsole = { logs: [], clears: 0 };

  const originalLog = console.log;
  const originalClear = console.clear;
  const originalDebug = console.debug;
  const originalError = console.error;

  console.log = (...args: string[]) => captured.logs.push(args.map(String).join(" "));
  console.clear = () => {
    captured.clears++;
  };
  console.debug = () => {};
  console.error = () => {};

  return {
    captured,
    restore: () => {
      console.log = originalLog;
      console.clear = originalClear;
      console.debug = originalDebug;
      console.error = originalError;
    },
  };
}

export function captureStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  (process.stdout as Partial<{ write: (chunk: string) => boolean }> as { write: (chunk: string) => boolean }).write = (
    chunk: string,
  ) => {
    writes.push(chunk);
    return true;
  };

  return {
    writes,
    restore: () => {
      (process.stdout as Partial<{ write: unknown }> as { write: unknown }).write = originalWrite;
    },
  };
}

export async function testProdRender(
  panes: IPane[],
  options: {
    showHelp?: boolean;
    showNotifications?: boolean;
    showMemoryNotifications?: boolean;
    notifications?: IMemoryNotification[];
    portals?: IPortalInfo[];
  } = {},
) {
  const { captured, restore } = captureConsole();
  const { writes, restore: restoreStdout } = captureStdout();
  try {
    await prodRender(
      panes,
      "main",
      {
        showHelp: options.showHelp ?? false,
        showNotifications: options.showNotifications ?? false,
        showMemoryNotifications: options.showMemoryNotifications ?? false,
        showViewPicker: false,
        isLoading: false,
        loadingMessage: "",
        error: null,
        currentTheme: "default",
        highContrast: false,
        screenReader: false,
        selectedMemoryNotifIndex: 0,
      } as IDashboardViewState,
      noColorTheme,
      {
        getNotifications: () => Promise.resolve(options.notifications ?? []),
      } as Partial<INotificationService> as INotificationService,
      {
        listPortals: () => Promise.resolve(options.portals ?? []),
        getPortalDetails: () => Promise.resolve({} as Partial<IPortalDetails> as IPortalDetails),
        openPortal: () => Promise.resolve(true),
        closePortal: () => Promise.resolve(true),
        refreshPortal: () => Promise.resolve(true),
        removePortal: () => Promise.resolve(true),
        quickJumpToPortalDir: () => Promise.resolve(""),
        getPortalFilesystemPath: () => Promise.resolve(""),
        getPortalActivityLog: () => [],
      } as Partial<IPortalService> as IPortalService,
    );
    return { captured, writes };
  } finally {
    restoreStdout();
    restore();
  }
}
