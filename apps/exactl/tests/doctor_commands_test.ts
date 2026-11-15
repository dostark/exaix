/**
 * @module DoctorCommandsTest
 * @path apps/exactl/tests/doctor_commands_test.ts
 * @description Verifies the doctor checks, their statuses and exit codes with injected sources, and runs the real binary for the PID file, credential and JSON cases.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/commands/doctor_commands.ts, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/commands/doctor_commands.ts, apps/exactl/src/command_builders/doctor_command.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runtimePath } from "@exaix/shared";
import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { DaemonPidState, type IDaemonPidInspection, type IMigrationCheck } from "../src/commands/daemon_commands.ts";
import type { IModelListRow } from "../src/commands/model_commands.ts";
import {
  DoctorCheckName,
  DoctorCommands,
  doctorExitCode,
  DoctorStatus,
  type IDoctorSources,
} from "../src/commands/doctor_commands.ts";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";

const MISSING_KEY_MESSAGE = "Authentication failed: ANTHROPIC_API_KEY not found in environment or credential store";
const PROVIDER_KEY_VARIABLES: readonly string[] = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"];
const DEAD_PID = "99999";
const THRESHOLD_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function priced(model: string, overrides: Partial<IModelListRow> = {}): IModelListRow {
  return {
    model,
    author: "openai",
    service: "openai",
    route: "native",
    price_source: "static",
    source_url: null,
    verified_at: "2026-11-13",
    stale: false,
    input_per_mtok: 0.25,
    output_per_mtok: 2,
    ...overrides,
  };
}

interface ISourceCalls {
  migration: number;
  validation: number;
  pid: number;
  probe: number;
  models: number;
}

function sources(overrides: Partial<IDoctorSources> = {}): { sources: IDoctorSources; calls: ISourceCalls } {
  const calls: ISourceCalls = { migration: 0, validation: 0, pid: 0, probe: 0, models: 0 };
  const migration: IMigrationCheck = { exitCode: 0, status: "ok", message: "Workspace is up to date" };
  const alive: IDaemonPidInspection = { state: DaemonPidState.ALIVE, pid: 1234 };
  return {
    calls,
    sources: {
      checkMigration: () => {
        calls.migration += 1;
        return migration;
      },
      validateConfig: () => {
        calls.validation += 1;
        return Promise.resolve({ valid: true, issues: [] });
      },
      inspectPid: () => {
        calls.pid += 1;
        return Promise.resolve(alive);
      },
      probeProvider: () => {
        calls.probe += 1;
        return Promise.resolve();
      },
      listModels: () => {
        calls.models += 1;
        return Promise.resolve([priced("openai:gpt-5-mini")]);
      },
      ...overrides,
    },
  };
}

function statusesOf(checks: readonly { name: DoctorCheckName; status: DoctorStatus }[]): Record<string, string> {
  return Object.fromEntries(checks.map((check) => [check.name, check.status]));
}

Deno.test("all checks pass → exit 0", async () => {
  const checks = await new DoctorCommands(sources().sources).run({ schema: false });
  assertEquals(checks.map((check) => check.name), Object.values(DoctorCheckName));
  assertEquals(new Set(checks.map((check) => check.status)), new Set([DoctorStatus.PASS]));
  assertEquals(doctorExitCode(checks), ExaCtlExitCode.OK);
});

Deno.test("a stopped daemon without a PID file → daemon warn, exit 0", async () => {
  const { sources: input } = sources({ inspectPid: () => Promise.resolve({ state: DaemonPidState.ABSENT }) });
  const checks = await new DoctorCommands(input).run({ schema: false });
  assertEquals(statusesOf(checks)[DoctorCheckName.DAEMON], DoctorStatus.WARN);
  assertEquals(doctorExitCode(checks), ExaCtlExitCode.OK);
});

Deno.test("a PID file with a dead process → daemon fail, DAEMON_UNAVAILABLE", async () => {
  const { sources: input } = sources({
    inspectPid: () => Promise.resolve({ state: DaemonPidState.STALE, pid: Number(DEAD_PID) }),
  });
  const checks = await new DoctorCommands(input).run({ schema: false });
  assertEquals(statusesOf(checks)[DoctorCheckName.DAEMON], DoctorStatus.FAIL);
  assertEquals(doctorExitCode(checks), ExaCtlExitCode.DAEMON_UNAVAILABLE);
});

Deno.test("a missing provider key is a CREDENTIALS fail and any other provider error is INVALID", async () => {
  const missing = sources({ probeProvider: () => Promise.reject(new Error(MISSING_KEY_MESSAGE)) });
  const checks = await new DoctorCommands(missing.sources).run({ schema: false });
  assertEquals(statusesOf(checks)[DoctorCheckName.PROVIDER], DoctorStatus.FAIL);
  assertEquals(doctorExitCode(checks), ExaCtlExitCode.CREDENTIALS);

  const broken = sources({ probeProvider: () => Promise.reject(new Error("Unknown provider: nope")) });
  assertEquals(
    doctorExitCode(await new DoctorCommands(broken.sources).run({ schema: false })),
    ExaCtlExitCode.INVALID,
  );
});

Deno.test("the exit code is the class of the first failing check, and a warning never fails", async () => {
  const input = sources({
    checkMigration: () => ({ exitCode: 1, status: "mismatch", message: "Workspace migration required" }),
    probeProvider: () => Promise.reject(new Error(MISSING_KEY_MESSAGE)),
    inspectPid: () => Promise.resolve({ state: DaemonPidState.ABSENT }),
  });
  const checks = await new DoctorCommands(input.sources).run({ schema: false });
  assertEquals(doctorExitCode(checks), ExaCtlExitCode.INVALID);
  const invalidConfig = sources({
    validateConfig: () => Promise.resolve({ valid: false, issues: [{ path: "a", message: "m", code: "c" }] }),
  });
  assertEquals(
    doctorExitCode(await new DoctorCommands(invalidConfig.sources).run({ schema: false })),
    ExaCtlExitCode.INVALID,
  );
});

Deno.test("--schema runs only the schema check", async () => {
  const { sources: input, calls } = sources();
  const checks = await new DoctorCommands(input).run({ schema: true });
  assertEquals(checks.map((check) => check.name), [DoctorCheckName.SCHEMA]);
  assertEquals(calls, { migration: 1, validation: 0, pid: 0, probe: 0, models: 0 });
});

Deno.test("a default model without a price gives a pricing warning and exit 0", async () => {
  const { sources: input } = sources({
    listModels: () =>
      Promise.resolve([priced("openai-chat:gpt-6-luna", { input_per_mtok: null, output_per_mtok: null })]),
  });
  const checks = await new DoctorCommands(input).run({ schema: false });
  const pricing = checks.find((check) => check.name === DoctorCheckName.PRICING);
  assertEquals(pricing?.status, DoctorStatus.WARN);
  assertStringIncludes(pricing?.message ?? "", "openai-chat:gpt-6-luna");
  assertEquals(doctorExitCode(checks), ExaCtlExitCode.OK);
});

Deno.test("a price older than the threshold gives a pricing warning naming the model", async () => {
  const old = new Date(Date.now() - (THRESHOLD_DAYS + 1) * MS_PER_DAY).toISOString().slice(0, 10);
  const { sources: input } = sources({
    listModels: () => Promise.resolve([priced("anthropic:claude-haiku-5-5", { verified_at: old, stale: true })]),
  });
  const pricing = (await new DoctorCommands(input).run({ schema: false })).find((check) =>
    check.name === DoctorCheckName.PRICING
  );
  assertEquals(pricing?.status, DoctorStatus.WARN);
  assertStringIncludes(pricing?.message ?? "", "anthropic:claude-haiku-5-5");
});

Deno.test("mock, local and subscription models need no price", async () => {
  const free = [
    priced("mock:mock-model", { service: "mock", input_per_mtok: null, output_per_mtok: null }),
    priced("ollama:llama3.2", { route: "local", input_per_mtok: null, output_per_mtok: null }),
    priced("claude-cli:claude-sonnet-5", { route: "subscription", input_per_mtok: null, output_per_mtok: null }),
  ];
  const { sources: input } = sources({ listModels: () => Promise.resolve(free) });
  const pricing = (await new DoctorCommands(input).run({ schema: false })).find((check) =>
    check.name === DoctorCheckName.PRICING
  );
  assertEquals(pricing?.status, DoctorStatus.PASS);
});

Deno.test("doctor -o json reports one object per check", async () => {
  const [run] = await runExactlSeededWorkspace(() => {}, [["doctor", "-o", "json"]]);
  assertEquals(run.code, ExaCtlExitCode.OK, run.stderr);
  const rows = JSON.parse(run.stdout) as Array<{ name: string; status: string }>;
  assertEquals(rows.map((row) => row.name), Object.values(DoctorCheckName));
  assertEquals(rows.map((row) => row.status).filter((status) => !(status in DoctorStatus)), []);
});

Deno.test("doctor warns about the default model that has no price and still exits 0", async () => {
  const [run] = await runExactlSeededWorkspace(() => {}, [["doctor", "-o", "json"]]);
  assertEquals(run.code, ExaCtlExitCode.OK, run.stderr);
  const pricing = (JSON.parse(run.stdout) as Array<{ name: string; status: string; message: string }>).find((row) =>
    row.name === DoctorCheckName.PRICING
  );
  assertEquals(pricing?.status, DoctorStatus.WARN);
  assertStringIncludes(pricing?.message ?? "", "openai-chat:gpt-6-luna");
});

Deno.test("doctor --schema prints one check", async () => {
  const [run] = await runExactlSeededWorkspace(() => {}, [["doctor", "--schema", "-o", "json"]]);
  assertEquals(run.code, ExaCtlExitCode.OK, run.stderr);
  assertEquals((JSON.parse(run.stdout) as Array<{ name: string }>).map((row) => row.name), [DoctorCheckName.SCHEMA]);
});

Deno.test("missing credentials → provider fail, exit 7", async () => {
  const [run] = await runExactlSeededWorkspace(
    (root) => {
      const path = join(root, "exa.config.toml");
      Deno.writeTextFileSync(
        path,
        Deno.readTextFileSync(path).replace(
          '[models.mock]\nprovider = "mock"\nmodel = "test"',
          '[models.mock]\nprovider = "anthropic"\nmodel = "claude-haiku-5-5"',
        ),
      );
    },
    [["doctor", "-o", "json"]],
    undefined,
    PROVIDER_KEY_VARIABLES,
  );
  assertEquals(run.code, ExaCtlExitCode.CREDENTIALS, run.stderr);
  const rows = JSON.parse(run.stdout) as Array<{ name: string; status: string }>;
  assertEquals(rows.find((row) => row.name === DoctorCheckName.PROVIDER)?.status, DoctorStatus.FAIL);
});

Deno.test("a PID file with a dead process → daemon fail, exit 5, and doctor leaves the file in place", async () => {
  const [first, second] = await runExactlSeededWorkspace(
    (root) => Deno.writeTextFileSync(runtimePath(root, "daemon.pid"), DEAD_PID),
    [["doctor", "-o", "json"], ["doctor", "-o", "json"]],
  );
  assertEquals(first.code, ExaCtlExitCode.DAEMON_UNAVAILABLE, first.stderr);
  assertEquals(second.code, ExaCtlExitCode.DAEMON_UNAVAILABLE, second.stderr);
});
