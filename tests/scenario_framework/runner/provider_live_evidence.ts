/**
 * @module ProviderLiveEvidence
 * @path tests/scenario_framework/runner/provider_live_evidence.ts
 * @description Retains allowlisted live run metadata before the scenario sandbox is reclaimed.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts]
 */
import { join } from "@std/path";
import type { IActivityRecord, Opt, Reason } from "@exaix/core/types";

export interface IProviderLiveEvidenceInput {
  scenarioId: string;
  outputDir: string;
  configPath: string;
  activities: readonly IActivityRecord[];
  outcome: string;
  suiteScore: number;
  exitCode: number;
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
