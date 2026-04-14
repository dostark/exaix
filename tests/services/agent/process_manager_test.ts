/**
 * @module ProcessManagerTest
 * @path tests/services/agent/process_manager_test.ts
 * @description Unit tests for ProcessManager, verifying subprocess tracking,
 * termination, and signal handling.
 */

import { assertEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { ProcessManager } from "../../../src/services/agent/process_manager.ts";

Deno.test("ProcessManager: tracks and untracks PIDs", () => {
  const pm = new ProcessManager();
  try {
    pm.track(123);
    pm.track(456);

    // Internal state is private, but we can verify via terminateAll
    const killStub = stub(Deno, "kill", () => {});
    try {
      pm.terminateAll();
      assertEquals(killStub.calls.length, 2);

      pm.track(789);
      pm.untrack(789);
      pm.terminateAll();
      assertEquals(killStub.calls.length, 2); // No new calls
    } finally {
      killStub.restore();
    }
  } finally {
    pm.cleanup();
  }
});

Deno.test("ProcessManager: terminateAll handles missing PIDs", () => {
  const pm = new ProcessManager();
  pm.track(12345);
  // Mock Deno.kill to throw
  const killStub = stub(Deno, "kill", () => {
    throw new Error("Process not found");
  });

  try {
    // Should not throw
    pm.terminateAll();
    assertEquals(killStub.calls.length, 1);
  } finally {
    killStub.restore();
    pm.cleanup();
  }
});

Deno.test("ProcessManager: cleanup removes signal listeners", () => {
  const addListenerSpy = spy(Deno, "addSignalListener");
  const removeListenerSpy = spy(Deno, "removeSignalListener");

  try {
    const pm = new ProcessManager();
    // Constructor adds listeners for SIGINT and SIGTERM
    // Note: addSignalListener might have been called by other things in the environment,
    // so we check relative increase if possible, but for unit test we assume clear start.
    const _initialAddCount = addListenerSpy.calls.length;

    pm.cleanup();

    // Should have called removeSignalListener for the same signals
    assertEquals(removeListenerSpy.calls.length >= 2, true);
  } finally {
    addListenerSpy.restore();
    removeListenerSpy.restore();
  }
});

Deno.test("ProcessManager: dispose terminates and cleans up", () => {
  const pm = new ProcessManager();
  pm.track(100);
  const killStub = stub(Deno, "kill", () => {});
  const removeListenerSpy = spy(Deno, "removeSignalListener");

  try {
    pm.dispose();
    assertEquals(killStub.calls.length, 1);
    assertEquals(removeListenerSpy.calls.length >= 2, true);
  } finally {
    killStub.restore();
    removeListenerSpy.restore();
  }
});
