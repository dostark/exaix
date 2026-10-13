/**
 * @module CompiledFlowFixtureTest
 * @path tests/scenario_framework/tests/unit/compiled_flow_fixture_test.ts
 * @description Verifies the daemon readiness baseline across launch and journal-wait startup.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/helpers/compiled_flow_fixture.ts, apps/exactl/src/commands/journal_commands.ts]
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { initTestDbService } from "@exaix/testing";
import type { Opt, Reason } from "@exaix/core/types";
import { startCompiledFlowDaemon } from "../helpers/compiled_flow_fixture.ts";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;

for (const emitsReady of [true, false]) {
  Deno.test(`fix(compiled-flow): ${emitsReady ? "readiness emitted before journal wait is accepted" : "an old readiness event cannot satisfy a new boot"}`, async () => {
    const { db, tempDir, cleanup } = await initTestDbService();
    const OriginalCommand = Deno.Command;
    const configPath = join(tempDir, "exa.config.toml");
    db.logActivity("system", "daemon.ready", "previous-boot", {}, "previous-boot");
    await db.waitForFlush();
    class ReadinessCommand extends OriginalCommand {
      private readonly launchesDaemon: boolean;

      constructor(command: string | URL, options: Opt<Deno.CommandOptions, Reason.TestStub> = {}) {
        const journalCli = command === "fixture-cli";
        super(
          journalCli ? Deno.execPath() : command,
          journalCli
            ? {
              ...options,
              args: [
                "run",
                "-A",
                "--config",
                join(REPO_ROOT, "deno.json"),
                join(REPO_ROOT, "apps", "exactl", "main.ts"),
                ...(options.args ?? []).map((arg: string, index: number, args: string[]): string =>
                  index > 0 && args[index - 1] === "--timeout" ? "1" : arg
                ),
              ],
              env: { ...options.env, EXA_CONFIG_PATH: configPath, EXAIX_EDITION: "solo" },
            }
            : options,
        );
        this.launchesDaemon = command === "bash";
      }

      override async output(): Promise<Deno.CommandOutput> {
        if (!this.launchesDaemon) return await super.output();
        if (emitsReady) {
          db.logActivity("system", "daemon.ready", "current-boot", {}, "current-boot");
          await db.waitForFlush();
        }
        return {
          code: 0,
          success: true,
          signal: null,
          stdout: new TextEncoder().encode("1234"),
          stderr: new Uint8Array(),
        };
      }
    }
    Deno.Command = ReadinessCommand;
    try {
      const code = await startCompiledFlowDaemon(tempDir, { cli: "fixture-cli", daemon: "fixture-daemon" });
      assertEquals(code, emitsReady ? 0 : 1);
    } finally {
      Deno.Command = OriginalCommand;
      await cleanup();
    }
  });
}
