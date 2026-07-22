/**
 * @module CliDelegateModelProviderJsonSchemaTest
 * @path packages/ai-clidelegate/tests/cli_delegate_model_provider_json_schema_test.ts
 * @description Phase 151 Step 4 — verifies CliDelegateModelProvider passes
 * --json-schema only when options.jsonSchema is set AND the probed version
 * meets the minimum, falling back silently otherwise.
 */
import { assertEquals } from "@std/assert";
import { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import type { IRunCliDelegateProcess } from "../src/cli_delegate_model_provider.ts";
import type { IDelegateVersionResult } from "@exaix/session/delegate_version_probe.ts";

function supportedProbe(): (bin: string, minVersion: string) => Promise<IDelegateVersionResult> {
  return () => Promise.resolve({ version: "2.1.217", supported: true });
}

function unsupportedProbe(): (bin: string, minVersion: string) => Promise<IDelegateVersionResult> {
  return () => Promise.resolve({ version: "2.1.200", supported: false, warning: "below minimum" });
}

Deno.test("CliDelegateModelProvider: claude includes --json-schema when option set and version meets minimum", async () => {
  let seenArgs: string[] = [];
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgs = args;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        result: "ok",
        structured_output: { title: "t", description: "d", steps: [] },
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
    probeVersion: supportedProbe(),
  });

  await provider.generate("test", { jsonSchema: { type: "object", properties: {} } });

  const jsonSchemaIdx = seenArgs.indexOf("--json-schema");
  assertEquals(jsonSchemaIdx !== -1, true);
  assertEquals(jsonSchemaIdx < seenArgs.length - 1, true);
  const schemaArg = seenArgs[jsonSchemaIdx + 1];
  assertEquals(typeof schemaArg, "string");
  const parsed = JSON.parse(schemaArg);
  assertEquals(parsed.type, "object");
});

Deno.test("CliDelegateModelProvider: claude omits --json-schema when option not set", async () => {
  let seenArgs: string[] = [];
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgs = args;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "ok", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
    probeVersion: supportedProbe(),
  });

  await provider.generate("test");

  assertEquals(seenArgs.includes("--json-schema"), false);
});

Deno.test("CliDelegateModelProvider: claude omits --json-schema when version below minimum", async () => {
  let seenArgs: string[] = [];
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgs = args;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "ok", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
    probeVersion: unsupportedProbe(),
  });

  await provider.generate("test", { jsonSchema: { type: "object", properties: {} } });

  assertEquals(seenArgs.includes("--json-schema"), false);
});
