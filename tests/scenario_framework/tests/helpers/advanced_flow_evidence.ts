/**
 * @module AdvancedFlowEvidence
 * @path tests/scenario_framework/tests/helpers/advanced_flow_evidence.ts
 * @description Retains request-scoped journal rows, provider prompts and binding snapshots before scenario cleanup.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/portal, @exaix/schemas]
 * @related-files [tests/scenario_framework/tests/helpers/advanced_flow_case.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { join, relative } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import type { IActivityRecord } from "@exaix/core/types";
import { PathResolver } from "@exaix/portal";
import { BindingLockSchema, RunBindingsFileSchema } from "@exaix/schemas";
import type { IAdvancedFlowCase } from "./advanced_flow_case.ts";
import type { IExpectedCallManifest } from "./expected_call_manifest.ts";

export interface IAdvancedFlowCaseEvidence {
  scenarioId: string;
  edition: string;
  requestTrace: string;
  flowRunId: string;
  activities: IActivityRecord[];
  binaries: Array<{ path: string; sha256: string }>;
  configSha256: string;
  locks: Array<ReturnType<typeof BindingLockSchema.parse>>;
  runBindings: Array<ReturnType<typeof RunBindingsFileSchema.parse>>;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
}

const binaryDigests = new Map<string, string>();

export async function retainAdvancedFlowEvidence(input: {
  spec: Pick<IAdvancedFlowCase, "scenarioId" | "edition">;
  expected: IExpectedCallManifest;
  workspaceRoot: string;
  outputDir: string;
  journal: { activities: IActivityRecord[] };
  traceId: string;
  compiledCli: string;
  compiledDaemon: string;
}): Promise<IAdvancedFlowCaseEvidence> {
  const { spec, workspaceRoot, outputDir, traceId } = input;
  const activities = input.journal.activities.filter((row) => row.trace_id === traceId);
  assert(activities.length > 0);
  const starts = activities.filter((row) => row.action_type === "flow.started");
  const refused = input.expected.expectedFailure === "capability_unavailable";
  assertEquals(starts.length, input.expected.flow && !refused ? 1 : 0);
  const failed = activities.find((row) => row.action_type === "flow.failed");
  const identity = starts[0] ?? failed;
  const { flowRunId, traceId: payloadTrace } = identity ? JSON.parse(identity.payload) : { flowRunId: "", traceId };
  assertEquals(payloadTrace, traceId);
  assertEquals(typeof flowRunId, "string");
  const configPath = join(workspaceRoot, "exa.config.toml");
  const config = new ConfigService(configPath).getAll();
  const resolver = new PathResolver(config);
  const runtimeRoot = await resolver.resolve("@Runtime");
  const locks: IAdvancedFlowCaseEvidence["locks"] = [];
  for (const row of activities.filter((row) => row.action_type === "binding.snapshot.created")) {
    const payload = JSON.parse(row.payload);
    const path = await resolver.resolve(`@Runtime/${relative(runtimeRoot, payload.lock_path)}`);
    const bytes = await Deno.readFile(path);
    assertEquals(await sha256(bytes), payload.lock_sha256);
    const lock = BindingLockSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    assertEquals(lock.trace_id, traceId);
    locks.push(lock);
    await Deno.writeFile(join(outputDir, "binding.lock.json"), bytes);
  }
  const runBindings: IAdvancedFlowCaseEvidence["runBindings"] = [];
  const runPath = await resolver.resolve(`@Runtime/run-bindings/${traceId}.json`);
  try {
    const bytes = await Deno.readFile(runPath);
    const run = RunBindingsFileSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    assertEquals(run.trace_id, traceId);
    runBindings.push(run);
    await Deno.writeFile(join(outputDir, "run-bindings.json"), bytes);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const binaries: IAdvancedFlowCaseEvidence["binaries"] = [];
  for (const path of [input.compiledCli, input.compiledDaemon]) {
    let digest = binaryDigests.get(path);
    if (!digest) {
      digest = await sha256(await Deno.readFile(path));
      binaryDigests.set(path, digest);
    }
    binaries.push({ path, sha256: digest });
  }
  const evidence = {
    scenarioId: spec.scenarioId,
    edition: spec.edition,
    requestTrace: traceId,
    flowRunId,
    activities,
    binaries,
    configSha256: await sha256(await Deno.readFile(configPath)),
    locks,
    runBindings,
  };
  await Deno.copyFile(configPath, join(outputDir, "exa.config.toml"));
  await Deno.writeTextFile(join(outputDir, "expected-calls.json"), JSON.stringify(input.expected, null, 2));
  await Deno.writeTextFile(join(outputDir, "cutover-evidence.json"), JSON.stringify(evidence, null, 2));
  return evidence;
}
