/**
 * @module ProcessManagerTest
 * @path packages/core/tests/process_manager_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Unit tests for ProcessManager.
 */

import { assertEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { ProcessManager } from "@exaix/core";

Deno.test("ProcessManager: tracks and untracks PIDs", () => {
  const pm = new ProcessManager();
  try {
    pm.track(123);
    pm.track(456);

    const killStub = stub(Deno, "kill", () => {});
    try {
      pm.terminateAll();
      assertEquals(killStub.calls.length, 2);

      pm.track(789);
      pm.untrack(789);
      pm.terminateAll();
      assertEquals(killStub.calls.length, 2);
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
  const killStub = stub(Deno, "kill", () => {
    throw new Error("Process not found");
  });

  try {
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
    pm.cleanup();
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
