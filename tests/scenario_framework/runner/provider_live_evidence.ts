/**
 * @module ProviderLiveEvidence
 * @path tests/scenario_framework/runner/provider_live_evidence.ts
 * @description Retains allowlisted live run metadata before the scenario sandbox is reclaimed.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts]
 */
import { join } from "@std/path";
import { BindingLockSchema, type IResolvedBinding } from "@exaix/schemas";
import type { IActivityRecord, Opt, Reason } from "@exaix/core/types";
import { type IJudgeSutContext, type IResolvedJudgeBinding, judgeSharesSut } from "./judge_bindings.ts";
import type { IPinKeptRecord } from "./binding_layers.ts";

/** One overlay file the run passed, as the evidence records it. */
export interface IProviderLiveOverlayEvidence {
  role: string;
  path: string;
  sha256: string;
}

/** One step binding the daemon resolved, reduced to the auditable fields. */
export interface IProviderLiveBindingEvidence {
  traceId: string;
  stepId: string;
  agentRole: string;
  /** The lock entry's outcome kind: `bound` or `unbound`. */
  outcome: string;
  /** The resolved service, when the step was bound. */
  service?: string;
  /** The resolved canonical model, when the step was bound. */
  model?: string;
}

/** One judge binding the runner resolved for this run. */
export interface IProviderLiveJudgeEvidence {
  stepId: string;
  service: string;
  model: string;
  /** The layer and selector each resolved field came from. */
  sources: IResolvedBinding["sources"];
  /** True when the judge resolved to the same service and model as the system under test. */
  judgeSharesSut: boolean;
}

export interface IProviderLiveEvidenceInput {
  scenarioId: string;
  outputDir: string;
  configPath: string;
  activities: readonly IActivityRecord[];
  outcome: string;
  suiteScore: number;
  exitCode: number;
  /** Overlay files this run passed, with their digests. Absent when no binding layer existed. */
  overlays?: readonly IProviderLiveOverlayEvidence[];
  /** One row per resolved step binding, read from each run's binding lockfile. */
  bindings?: readonly IProviderLiveBindingEvidence[];
  /** Judge bindings the runner resolved. Absent when no step owns a judge criterion. */
  judges?: readonly IProviderLiveJudgeEvidence[];
  /** One row per pinned field the pin rule removed from an operator entry. */
  pins?: readonly IProviderLivePinEvidence[];
}

/** One pinned field the pin rule kept out of an operator entry. */
export interface IProviderLivePinEvidence {
  /** The pin's own selector. */
  selector: string;
  reason: string;
  note: string;
  field: string;
  /** The value the pin held, from the authoring layers. */
  value: string;
  /** The operator entry the field was stripped from. */
  source: string;
  skippedSelector: string;
  skippedLayer: string;
}

/** Reduce the runner's pin decisions to the auditable evidence rows. */
export function pinEvidenceRows(pins: readonly IPinKeptRecord[]): IProviderLivePinEvidence[] {
  return pins.map((pin) => ({
    selector: pin.selector,
    reason: pin.reason,
    note: pin.note,
    field: pin.field,
    value: pin.value,
    source: pin.source,
    skippedSelector: pin.skipped_selector,
    skippedLayer: pin.skipped_layer,
  }));
}

/** Reduce the runner's resolved judge bindings to the auditable evidence rows.
 *  Each row is flagged against the system under test that `sut` describes. */
export function judgeEvidenceRows(
  bindings: readonly IResolvedJudgeBinding[],
  sut: IJudgeSutContext,
): IProviderLiveJudgeEvidence[] {
  return bindings.map((entry) => ({
    stepId: entry.stepId,
    service: entry.binding.service,
    model: entry.binding.model,
    sources: entry.binding.sources,
    judgeSharesSut: judgeSharesSut(entry.binding, sut),
  }));
}

/** Suffix of a binding lockfile the daemon writes, one per request trace. */
const LOCKFILE_SUFFIX = ".lock.json";

/** Read the lockfile of every request trace a scenario submitted. A bound run's missing lock throws. */
export async function readRequestLockEntries(
  workspaceRoot: string,
  traceIds: readonly string[],
  bound: boolean,
): Promise<IProviderLiveBindingEvidence[]> {
  const rows: IProviderLiveBindingEvidence[] = [];
  for (const traceId of traceIds) {
    const lockPath = join(workspaceRoot, ".exa", "bindings", `${traceId}${LOCKFILE_SUFFIX}`);
    const present = await Deno.stat(lockPath).then(() => true, () => false);
    if (!present) {
      if (bound) throw new Error(`binding evidence: no lockfile for request trace ${traceId} of a bound run`);
      continue;
    }
    rows.push(...await readLockEntryEvidence(lockPath, traceId));
  }
  return rows;
}

/** Read every binding lockfile in a run's sandbox. Each sandbox holds one scenario run, so every lock is this run's. */
export async function readRunLockEntries(workspaceRoot: string): Promise<IProviderLiveBindingEvidence[]> {
  const dir = join(workspaceRoot, ".exa", "bindings");
  const rows: IProviderLiveBindingEvidence[] = [];
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(LOCKFILE_SUFFIX)) names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return rows;
    throw error;
  }
  for (const name of names.sort()) {
    rows.push(...await readLockEntryEvidence(join(dir, name), name.slice(0, -LOCKFILE_SUFFIX.length)));
  }
  return rows;
}

/** Reduce one run's binding lockfile to auditable rows. A malformed or missing file throws. */
export async function readLockEntryEvidence(
  lockfilePath: string,
  traceId: string,
): Promise<IProviderLiveBindingEvidence[]> {
  const lock = BindingLockSchema.parse(JSON.parse(await Deno.readTextFile(lockfilePath)));
  return lock.entries.map((entry) => ({
    traceId,
    stepId: entry.step_id,
    agentRole: entry.agent_role,
    outcome: entry.outcome.kind,
    ...(entry.outcome.kind === "bound"
      ? { service: entry.outcome.binding.service, model: entry.outcome.binding.model }
      : {}),
  }));
}

interface ILlmUsagePayload {
  model?: string;
  provider?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_tokens?: number;
  cost_status?: string;
  cost_usd?: number | null;
}

function safeCount(value: Opt<number, Reason.OptionalInput>): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function completedUsage(activities: readonly IActivityRecord[]): ILlmUsagePayload[] {
  return activities.filter((activity) => activity.action_type === "llm.call.completed").map((activity) => {
    try {
      return JSON.parse(activity.payload) as ILlmUsagePayload;
    } catch {
      return {};
    }
  });
}

/** Writes only named metadata fields. Raw journal payloads and config text never enter the output. */
export async function writeProviderLiveEvidence(input: IProviderLiveEvidenceInput): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(input.scenarioId)) throw new Error("Invalid scenario ID for live evidence");
  const configBytes = await Deno.readFile(input.configPath);
  const hash = await crypto.subtle.digest("SHA-256", configBytes);
  const configRevisionSha256 = Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const calls = completedUsage(input.activities);
  const traceId = input.activities.find((activity) => activity.action_type === "request.created")?.trace_id;
  const failed = input.activities.some((activity) => activity.action_type.endsWith(".failed"));
  const qualified = input.exitCode === 0 && input.outcome === "success" && !failed && !!traceId && calls.length > 0;
  const costStatuses = [
    ...new Set(calls.map((call) => call.cost_status ?? (typeof call.cost_usd === "number" ? "estimated" : "unknown"))),
  ];
  const costStatus = costStatuses.length === 1 ? costStatuses[0] : "mixed";
  const costUsd = calls.every((call) => typeof call.cost_usd === "number" && Number.isFinite(call.cost_usd))
    ? calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0)
    : null;
  const summary = {
    scenarioId: input.scenarioId,
    recordedAt: new Date().toISOString(),
    startedAt: input.activities[0]?.timestamp ?? null,
    traceId: traceId ?? null,
    configRevisionSha256,
    outcome: input.outcome,
    suiteScore: input.suiteScore,
    exitCode: input.exitCode,
    qualified,
    returnedModels: [...new Set(calls.map((call) => call.model).filter((model): model is string => !!model))],
    providers: [...new Set(calls.map((call) => call.provider).filter((provider): provider is string => !!provider))],
    overlays: [...(input.overlays ?? [])],
    bindings: [...(input.bindings ?? [])],
    judges: [...(input.judges ?? [])],
    pins: [...(input.pins ?? [])],
    usage: {
      promptTokens: calls.reduce((sum, call) => sum + safeCount(call.prompt_tokens), 0),
      completionTokens: calls.reduce((sum, call) => sum + safeCount(call.completion_tokens), 0),
      cacheReadTokens: calls.reduce((sum, call) => sum + safeCount(call.cache_read_tokens), 0),
      costStatus,
      costUsd,
    },
  };
  const dir = join(input.outputDir, "provider-live-evidence");
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, `${input.scenarioId}.json`);
  await Deno.writeTextFile(path, `${JSON.stringify(summary, null, 2)}\n`);
  return path;
}
