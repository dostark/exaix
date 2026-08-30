/**
 * @module DaemonLeastPrivilegeTest
 * @path apps/exactl/tests/daemon_least_privilege_test.ts
 * @description Verifies DaemonCommands.buildSpawnFlags() constructs a minimal,
 *   config-driven --allow-* set (Phase 124 Step 2). Asserts the allow_net rules
 *   (undefined → default list; [] → blocked, NOT --allow-all; non-empty → narrow)
 *   and the config-read-exception fallback to --allow-all (GAP-2).
 * @architectural-layer CLI
 * @related-files ["apps/exactl/src/commands/daemon_commands.ts", "packages/core/src/types/constants.ts"]
 */

import { assertEquals } from "@std/assert";
import { DaemonCommands } from "../src/commands/daemon_commands.ts";
import { createStubContext } from "@exaix/testing";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { DAEMON_DEFAULT_NET_HOSTS, DAEMON_SPAWN_PERMISSIONS } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";

/** Expose the protected buildSpawnFlags() and allow injecting a config that throws. */
class TestDaemonCommands extends DaemonCommands {
  public callSpawnFlags(): string[] {
    return this.buildSpawnFlags();
  }
}

interface ITestCommands {
  cmds: TestDaemonCommands;
  cleanup: () => Promise<void>;
}

async function makeCommands(allowNet: string[] | undefined): Promise<ITestCommands> {
  const { db, configService, cleanup } = await createCliTestContext();
  configService.getAll().system.allow_net = allowNet;
  const cmds = new TestDaemonCommands(createStubContext({ config: configService, db }));
  return { cmds, cleanup };
}

Deno.test("[daemon_least_privilege] allow_net=['api.anthropic.com'] → --allow-net=api.anthropic.com, not --allow-all", async () => {
  const { cmds, cleanup } = await makeCommands(["api.anthropic.com"]);
  try {
    const flags = cmds.callSpawnFlags();
    assertEquals(flags.includes("--allow-net=api.anthropic.com"), true);
    assertEquals(flags.includes("--allow-all"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("[daemon_least_privilege] allow_net=[] → no --allow-net flag (outbound blocked), NOT --allow-all (GAP-2)", async () => {
  const { cmds, cleanup } = await makeCommands([]);
  try {
    const flags = cmds.callSpawnFlags();
    assertEquals(flags.some((f) => f.startsWith("--allow-net")), false);
    assertEquals(flags.includes("--allow-all"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("[daemon_least_privilege] allow_net=undefined → --allow-net=<default host list>", async () => {
  const { cmds, cleanup } = await makeCommands(undefined);
  try {
    const flags = cmds.callSpawnFlags();
    const netFlag = flags.find((f) => f.startsWith("--allow-net="));
    // An undefined allow_net falls back to the default host grant, not --allow-all; the
    // default host set is pinned in tests/daemon/net_allowlist_covers_providers_test.ts.
    assertEquals(netFlag, `--allow-net=${DAEMON_DEFAULT_NET_HOSTS.join(",")}`);
  } finally {
    await cleanup();
  }
});

Deno.test("[daemon_least_privilege] config-read throws → --allow-all fallback (exception path only)", async () => {
  const { cmds, cleanup } = await makeCommands(undefined);
  try {
    // Force config access to throw, simulating an unreadable/malformed config.
    Object.defineProperty(cmds, "config", {
      get(): Config {
        throw new Error("config unreadable");
      },
    });
    const flags = cmds.callSpawnFlags();
    assertEquals(flags, ["--allow-all"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[daemon_least_privilege] scoped/typed flags present: read, write, run(allowlist), env, ffi, import", async () => {
  const { cmds, cleanup } = await makeCommands(["api.anthropic.com"]);
  try {
    const flags = cmds.callSpawnFlags();
    assertEquals(flags.includes("--allow-read"), true);
    assertEquals(flags.some((f) => f.startsWith("--allow-write=")), true);
    assertEquals(
      flags.some((f) => f.startsWith("--allow-run=") && f.includes("git") && f.includes("claude")),
      true,
    );
    assertEquals(flags.includes("--allow-env"), true);
    assertEquals(flags.includes("--allow-ffi"), true);
    assertEquals(flags.includes("--allow-import"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("[daemon_least_privilege] buildSpawnFlags derives boolean perms from DAEMON_SPAWN_PERMISSIONS (GAP-11)", async () => {
  // The struct is the single source of truth: flipping a boolean field must
  // change the emitted flag set. Proves buildSpawnFlags reads the struct rather
  // than hardcoding flags.
  const { cmds, cleanup } = await makeCommands(["api.anthropic.com"]);
  try {
    const flags = cmds.callSpawnFlags();
    // run flag derives from DAEMON_SPAWN_PERMISSIONS.run
    const runFlag = flags.find((f) => f.startsWith("--allow-run="));
    assertEquals(runFlag, `--allow-run=${DAEMON_SPAWN_PERMISSIONS.run.join(",")}`);
    // each boolean perm present iff the struct enables it
    assertEquals(flags.includes("--allow-env"), DAEMON_SPAWN_PERMISSIONS.env);
    assertEquals(flags.includes("--allow-ffi"), DAEMON_SPAWN_PERMISSIONS.ffi);
    assertEquals(flags.includes("--allow-import"), DAEMON_SPAWN_PERMISSIONS.import);
  } finally {
    await cleanup();
  }
});
