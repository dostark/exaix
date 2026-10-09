/**
 * @module DaemonEventWaitTest
 * @path tests/integration/daemon_event_wait_test.ts
 * @description Proves the daemon harness waits on journaled events and daemon exit, never on a
 *   wall-clock budget. A condition that holds resolves the wait. A daemon that exits first fails
 *   the wait at once, and the failure names the awaited event and the daemon's exit code.
 * @architectural-layer Test
 * @related-files ["tests/integration/helpers/daemon_config.ts", "tests/integration/agent_runner_daemon_cutover_test.ts"]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { type IDaemonExit, waitForDaemonEvent } from "./helpers/daemon_config.ts";

const NEVER_EXITS = new Promise<IDaemonExit>(() => {});

Deno.test("[daemon-wait] resolves once the awaited event is journaled, with no clock involved", async () => {
  let checks = 0;
  await waitForDaemonEvent(
    () => {
      checks++;
      return checks >= 3;
    },
    NEVER_EXITS,
    "the event",
  );
  assertEquals(checks, 3);
});

Deno.test("[daemon-wait] fails at once when the daemon exits before the event, naming both", async () => {
  const exited = Promise.resolve<IDaemonExit>({ code: 3, stderrTail: "boom" });
  await assertRejects(
    () => waitForDaemonEvent(() => false, exited, "daemon.ready"),
    Error,
    "daemon exited with code 3 before daemon.ready",
  );
});

Deno.test("[daemon-wait] an event journaled just before the daemon exits still resolves the wait", async () => {
  const exited = Promise.resolve<IDaemonExit>({ code: 1, stderrTail: "" });
  let checks = 0;
  await waitForDaemonEvent(
    () => {
      checks++;
      return checks >= 2;
    },
    exited,
    "the event",
  );
  assertEquals(checks, 2);
});
