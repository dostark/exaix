/**
 * @module ExpectedCallManifest
 * @path tests/scenario_framework/tests/helpers/expected_call_manifest.ts
 * @description Loads independent Phase 205 expected-call manifests and reconciles them with flows and keyed recordings.
 * @architectural-layer Test
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [tests/scenario_framework/tests/unit/flows_fixture_coverage_test.ts, tests/scenario_framework/tests/integration/advanced_flow_controls_test.ts]
 */
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ExecutionStrategyName, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import { getCriteriaByNames } from "@exaix/core/evaluation";
import { FlowSchema, type IFlow, type IFlowStep } from "@exaix/schemas/flow.ts";

export enum ExpectedCallDialect {
  AGENT = "agent",
  REACT = "react",
  DYNAMIC = "dynamic",
  JUDGE = "judge",
}

export enum JudgeVerdict {
  BELOW = "below",
  ABOVE = "above",
}

export interface IExpectedCall {
  lane: string;
  callIndex: number;
  dialect: ExpectedCallDialect;
  /** A React turn that requests a tool rather than completing. */
  toolTurn?: boolean;
  /** Required on judge calls: the verdict relative to the gate threshold. */
  verdict?: JudgeVerdict;
  /** A recorded provider failure. The call journals a failure instead of a completion. */
  failure?: boolean;
}

export interface IExpectedCallManifest {
  scenarioId: string;
  edition: string;
  flow: string;
  /** Directory of keyed recordings, relative to the framework home. */
  fixtureDir: string;
  requestStepId: string;
  /** Flow steps the run reaches, in order. Omitted steps must make no provider call. */
  selectedPath: string[];
  expectedFailure: string | null;
  gateEvaluations: Record<string, number>;
  calls: IExpectedCall[];
}

export interface IKeyedRecording {
  file: string;
  response: string;
  error?: string;
  callSite?: { scenarioId: string; stepId: string; flowStepId?: string; callIndex: number };
}

export const MANIFEST_DIR_SEGMENTS = ["fixtures", "phase205", "expected_calls"] as const;
export const RECORDING_LANES_ENV = "EXA_RECORDING_LANES";
const LANE_SUFFIX = /^(?<step>.+?)--(?<kind>judge|react|mcp|dynamic|delegate-review|voter-\d+)$/;
const JUDGE_RESPONSE_KEYS = ["criteriaScores", "feedback", "suggestions"] as const;
const REACT_COMPLETE = "STATUS: COMPLETE";
const REACT_ACTION = "```toml";
const AGENT_CONTENT = "<content>";
const DYNAMIC_TOOL_CALL = "tool_call";
const DYNAMIC_COMPLETE = "complete";

export async function loadManifests(frameworkHome: string): Promise<IExpectedCallManifest[]> {
  const dir = join(frameworkHome, ...MANIFEST_DIR_SEGMENTS);
  const manifests: IExpectedCallManifest[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const manifest = JSON.parse(await Deno.readTextFile(join(dir, entry.name))) as IExpectedCallManifest;
    if (`${manifest.scenarioId}.json` !== entry.name) {
      throw new Error(`${entry.name} must be named after its scenarioId ${manifest.scenarioId}`);
    }
    manifests.push(manifest);
  }
  return manifests.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

export async function loadManifest(frameworkHome: string, scenarioId: string): Promise<IExpectedCallManifest> {
  const path = join(frameworkHome, ...MANIFEST_DIR_SEGMENTS, `${scenarioId}.json`);
  return JSON.parse(await Deno.readTextFile(path)) as IExpectedCallManifest;
}

export async function loadFlowFile(path: string): Promise<IFlow> {
  return FlowSchema.parse(parseYaml(await Deno.readTextFile(path)));
}

export async function loadKeyedRecordings(dir: string): Promise<IKeyedRecording[]> {
  const recordings: IKeyedRecording[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const parsed = JSON.parse(await Deno.readTextFile(join(dir, entry.name))) as Omit<IKeyedRecording, "file">;
    recordings.push({ file: entry.name, response: parsed.response, error: parsed.error, callSite: parsed.callSite });
  }
  return recordings;
}

/** Provider lanes a step consumes. A CLI delegate is protocol-fixtured and has none. */
export function providerLanes(step: IFlowStep): string[] {
  const type = step.type ?? FlowStepType.AGENT;
  if (type === FlowStepType.GATE) return [`${step.id}--judge`];
  if (type === FlowStepType.VOTING_GROUP) {
    return (step.voting?.runners ?? []).map((_runner, index) => `${step.id}--voter-${index}`);
  }
  if (type === FlowStepType.SESSION_DELEGATE_CYCLE) return [`${step.id}--delegate-review`];
  if (step.execution_mode === FlowStepExecutionMode.DYNAMIC) return [`${step.id}--dynamic`];
  if (step.strategy === ExecutionStrategyName.CLI_DELEGATE) return [];
  if (step.strategy === ExecutionStrategyName.REACT) return [`${step.id}--react`];
  if (step.strategy === ExecutionStrategyName.MCP) return [`${step.id}--mcp`];
  return [step.id];
}

function laneStep(lane: string): string {
  return lane.match(LANE_SUFFIX)?.groups?.step ?? lane;
}

function key(lane: string, callIndex: number): string {
  return `${lane}#${callIndex}`;
}

function judgeError(call: IExpectedCall, response: string, gate: IFlowStep): string | null {
  let parsed: { criteriaScores?: Record<string, { score?: number }>; feedback?: unknown; suggestions?: unknown };
  try {
    parsed = JSON.parse(response);
  } catch {
    return "judge recording is not raw JSON";
  }
  if (JUDGE_RESPONSE_KEYS.some((name) => !(name in parsed))) return "judge recording lacks a required field";
  const criteria = getCriteriaByNames(gate.evaluate?.criteria ?? []).map((criterion) => criterion.name);
  const scores = criteria.map((name) => parsed.criteriaScores?.[name]?.score);
  if (scores.some((score) => typeof score !== "number" || score < 0 || score > 1)) {
    return "judge recording lacks a bounded score for every gate criterion";
  }
  const mean = (scores as number[]).reduce((sum, score) => sum + score, 0) / scores.length;
  const above = mean >= (gate.evaluate?.threshold ?? 1);
  if ((call.verdict === JudgeVerdict.ABOVE) !== above) return `judge verdict is not ${call.verdict} the threshold`;
  return null;
}

/** A DYNAMIC turn is one JSON decision that either calls a tool or completes. */
function dynamicError(call: IExpectedCall, response: string): string | null {
  let decision: { action?: { type?: string } };
  try {
    decision = JSON.parse(response);
  } catch {
    return "DYNAMIC turn is not a JSON decision";
  }
  const toolTurn = decision.action?.type === DYNAMIC_TOOL_CALL;
  if (!toolTurn && decision.action?.type !== DYNAMIC_COMPLETE) return "DYNAMIC turn must call a tool or complete";
  return toolTurn === (call.toolTurn ?? false) ? null : "DYNAMIC tool-turn flag does not match the recording";
}

function recordingError(call: IExpectedCall, recording: IKeyedRecording, flow: IFlow): string | null {
  if (call.failure) return recording.error ? null : "expected a recorded provider failure";
  if (recording.error) return "an unexpected recorded provider failure";
  return dialectError(call, recording.response, flow);
}

function dialectError(call: IExpectedCall, response: string, flow: IFlow): string | null {
  if (call.dialect === ExpectedCallDialect.DYNAMIC) return dynamicError(call, response);
  if (call.dialect === ExpectedCallDialect.JUDGE) {
    const gate = flow.steps.find((step) => step.id === laneStep(call.lane));
    return gate ? judgeError(call, response, gate) : "judge lane has no gate step";
  }
  if (call.dialect === ExpectedCallDialect.REACT) {
    const toolTurn = response.includes(REACT_ACTION);
    if (toolTurn === response.includes(REACT_COMPLETE)) return "React turn must either act or complete";
    return toolTurn === (call.toolTurn ?? false) ? null : "React tool-turn flag does not match the recording";
  }
  return response.includes(AGENT_CONTENT) ? null : "agent recording lacks a content block";
}

/** Returns every discrepancy between a manifest, its schema-valid flow and its keyed recordings. */
export function reconcileManifest(
  manifest: IExpectedCallManifest,
  flow: IFlow,
  recordings: IKeyedRecording[],
): string[] {
  const errors: string[] = [];
  if (flow.id !== manifest.flow) errors.push(`flow id ${flow.id} is not ${manifest.flow}`);
  const known = new Map(flow.steps.flatMap((step) => providerLanes(step).map((lane) => [lane, step] as const)));
  const byLane = new Map<string, number[]>();
  for (const call of manifest.calls) {
    if (!known.has(call.lane)) errors.push(`lane ${call.lane} belongs to no provider-calling flow step`);
    byLane.set(call.lane, [...(byLane.get(call.lane) ?? []), call.callIndex]);
  }
  for (const [lane, indexes] of byLane) {
    if (indexes.some((index, position) => index !== position)) errors.push(`lane ${lane} indexes are not 0..n-1`);
  }
  for (const step of flow.steps) {
    const selected = manifest.selectedPath.includes(step.id);
    for (const lane of providerLanes(step)) {
      const count = byLane.get(lane)?.length ?? 0;
      if (selected && count === 0) errors.push(`selected step ${step.id} has no call on lane ${lane}`);
      if (!selected && count > 0) errors.push(`unselected step ${step.id} has calls on lane ${lane}`);
      if (step.type === FlowStepType.VOTING_GROUP && selected && count !== 1) {
        errors.push(`voter lane ${lane} must make exactly one call`);
      }
    }
    if (step.type === FlowStepType.GATE && selected) {
      const evaluations = byLane.get(`${step.id}--judge`)?.length ?? 0;
      if (evaluations !== manifest.gateEvaluations[step.id]) {
        errors.push(`gate ${step.id} has ${evaluations} judge calls, expected ${manifest.gateEvaluations[step.id]}`);
      }
    }
  }
  const scoped = recordings.filter((recording) =>
    recording.callSite?.scenarioId === manifest.scenarioId && recording.callSite.stepId === manifest.requestStepId
  );
  const recorded = new Map<string, IKeyedRecording>();
  for (const recording of scoped) {
    const site = recording.callSite!;
    const recordedKey = key(site.flowStepId ?? "", site.callIndex);
    if (recorded.has(recordedKey)) errors.push(`duplicate keyed recording ${recordedKey}`);
    recorded.set(recordedKey, recording);
  }
  const expected = new Set(manifest.calls.map((call) => key(call.lane, call.callIndex)));
  for (const call of manifest.calls) {
    const recording = recorded.get(key(call.lane, call.callIndex));
    if (!recording) {
      errors.push(`missing recording ${key(call.lane, call.callIndex)}`);
      continue;
    }
    const dialect = recordingError(call, recording, flow);
    if (dialect) errors.push(`${recording.file}: ${dialect}`);
  }
  for (const recordedKey of recorded.keys()) {
    if (!expected.has(recordedKey)) errors.push(`unexpected recording ${recordedKey}`);
  }
  return errors;
}
