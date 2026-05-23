/**
 * @module TUIDashboardRawModeTest
 * @path apps/tui/tests/tui_dashboard_rawmode_test.ts
 * @description Verifies the logic for entering terminal raw mode, ensuring correct behavior
 * in both interactive and non-interactive environments.
 */

import { assert, assertEquals } from "@std/assert";
import { launchTuiDashboard, tryDisableRawMode, tryEnableRawMode } from "../src/tui_dashboard.ts";

Deno.test("tryEnableRawMode enables raw mode when supported", () => {
  const stdinAny = Deno.stdin as Partial<
    { isTerminal: () => boolean; setRaw: ((flag: boolean) => void) | undefined }
  > as { isTerminal: () => boolean; setRaw: ((flag: boolean) => void) | undefined };
  const origIsTerminal = stdinAny.isTerminal;
  const origSetRaw = stdinAny.setRaw;

  const setRawCalls: Array<{ flag: boolean }> = [];

  try {
    // Stub isTerminal to true and setRaw to record calls
    stdinAny.isTerminal = () => true;
    stdinAny.setRaw = (flag: boolean) => {
      setRawCalls.push({ flag });
    };

    const enabled = tryEnableRawMode();
    assert(enabled);
    assertEquals(setRawCalls.length, 1);
    assertEquals(setRawCalls[0].flag, true);

    const disabled = tryDisableRawMode();
    assert(disabled);
    assertEquals(setRawCalls.length, 2);
    assertEquals(setRawCalls[1].flag, false);
  } finally {
    // Restore
    stdinAny.isTerminal = origIsTerminal;
    stdinAny.setRaw = origSetRaw;
  }
});

Deno.test("tryEnableRawMode returns false when setRaw missing", () => {
  const stdinAny = Deno.stdin as Partial<
    { isTerminal: () => boolean; setRaw: ((flag: boolean) => void) | undefined }
  > as { isTerminal: () => boolean; setRaw: ((flag: boolean) => void) | undefined };
  const origIsTerminal = stdinAny.isTerminal;
  const origSetRaw = stdinAny.setRaw;

  try {
    stdinAny.isTerminal = () => true;
    stdinAny.setRaw = undefined;

    const enabled = tryEnableRawMode();
    assertEquals(enabled, false);
  } finally {
    stdinAny.isTerminal = origIsTerminal;
    stdinAny.setRaw = origSetRaw;
  }
});

Deno.test({
  name: "launchTuiDashboard({ nonInteractive: true }) does not enable raw mode",
  // Production mode creates timers for auto-refresh that we don't want to wait for
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const stdinAny = Deno.stdin as Partial<{ setRaw: (flag: boolean) => void }> as { setRaw: (flag: boolean) => void };
    const origSetRaw = stdinAny.setRaw;

    try {
      // If setRaw is called, throw so the test fails
      stdinAny.setRaw = () => {
        throw new Error("setRaw should not be called in nonInteractive mode");
      };

      await launchTuiDashboard({ nonInteractive: true });
    } finally {
      stdinAny.setRaw = origSetRaw;
    }
  },
});
