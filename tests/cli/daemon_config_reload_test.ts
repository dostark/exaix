/**
 * @module DaemonConfigReloadTest
 * @path tests/cli/daemon_config_reload_test.ts
 * @description Verifies that the background daemon correctly handles configuration
 * changes without requiring a full service restart.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "../../src/config/service.ts";
import { FileWatcher } from "../../src/services/utils/watcher.ts";
import { ExaPathDefaults } from "../../src/shared/constants.ts";
import type { ConfigReloadLogger } from "../../src/config/config_reload_handler.ts";
import { createConfigReloadHandler } from "../../src/config/config_reload_handler.ts";
import { LogLevel } from "../../src/shared/enums.ts";

/**
 * Test for "Investigate why exactl portal add not showing in daemon logs"
 * Verifies that modifying exa.config.toml triggers a config reload and log event.
 */
Deno.test("Daemon: Config Reloading on File Change", async () => {
  // 1. Setup Temp Environment
  const tempDir = await Deno.makeTempDir({ prefix: "daemon-config-reload-" });
  const configPath = join(tempDir, "exa.config.toml");

  // Write initial config
  const initialConfig = `
[system]
version = "1.0.0"
log_level = "info"

[paths]
workspace = "${ExaPathDefaults.workspace}"
portals = "${ExaPathDefaults.portals}"
# ... minimal required paths
runtime = "${ExaPathDefaults.runtime}"
memory = "${ExaPathDefaults.memory}"
blueprints = "${ExaPathDefaults.blueprints}"
active = "${ExaPathDefaults.active}"
requests = "${ExaPathDefaults.requests}"
archive = "${ExaPathDefaults.archive}"
plans = "${ExaPathDefaults.plans}"
rejected = "${ExaPathDefaults.rejected}"
agents = "${ExaPathDefaults.identities}"
flows = "${ExaPathDefaults.flows}"
memoryProjects = "${ExaPathDefaults.memoryProjects}"
memoryExecution = "${ExaPathDefaults.memoryExecution}"
memoryIndex = "${ExaPathDefaults.memoryIndex}"
memorySkills = "${ExaPathDefaults.memorySkills}"
memoryPending = "${ExaPathDefaults.memoryPending}"
memoryTasks = "${ExaPathDefaults.memoryTasks}"
memoryGlobal = "${ExaPathDefaults.memoryGlobal}"

[watcher]
debounce_ms = 50
stability_check = false
`;
  await Deno.writeTextFile(configPath, initialConfig.trim());

  // 2. Initialize Services
  const configService = new ConfigService(configPath);
  const config = configService.get();

  // Mock Logger to capture events
  interface IStructuredLogEntry {
    level: LogLevel;
    action: string;
    target: string;
    payload: any;
  }
  const logs: IStructuredLogEntry[] = [];
  const logger: ConfigReloadLogger = {
    info: (action: string, target: string, payload: any) => {
      logs.push({ level: LogLevel.INFO, action, target, payload });
      return Promise.resolve();
    },
  };

  // 3. Setup Config Watcher (shared handler used by main.ts)
  const configWatcher = new FileWatcher(
    config,
    createConfigReloadHandler(configService, logger),
    {
      customWatchPath: tempDir, // Watch the temp root
      extensions: [".toml"],
    },
  );

  const watcherPromise = configWatcher.start();

  try {
    // Wait for watcher initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. Simulate exactl portal add (Modify config file)
    const updatedConfig = initialConfig +
      `\n[[portals]]\nalias = "test-portal"\ntarget_path = "/tmp/test"\ncreated = "2024-01-01"\n`;
    await Deno.writeTextFile(configPath, updatedConfig);

    // 5. Wait for watcher to process
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 6. Assertions

    // Assert configService has new state
    const currentConfig = configService.get();
    assertEquals(currentConfig.portals?.length, 1, "ConfigService should have reloaded portals");
    assertEquals(currentConfig.portals?.[0].alias, "test-portal");

    // Assert Log Event captured
    const updateLog = logs.find((l) => l.action === "config.updated");
    assert(updateLog, "Should have logged config.updated event");
    assertEquals(updateLog.target, "exa.config.toml");
    // Type-safe access for portals_count
    if (typeof updateLog.payload === "object" && updateLog.payload !== null && "portals_count" in updateLog.payload) {
      assertEquals((updateLog.payload as { portals_count: number }).portals_count, 1);
    } else {
      throw new Error("updateLog.payload missing portals_count");
    }

    console.log("Config reload verification passed!");
  } finally {
    await configWatcher.stop();
    await watcherPromise;
    await Deno.remove(tempDir, { recursive: true });
  }
});
