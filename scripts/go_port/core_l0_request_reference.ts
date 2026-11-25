#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0RequestReference
 * @path scripts/go_port/core_l0_request_reference.ts
 * @description Builds differential request, retry policy and milestone projection cases from the real core code for the Go reference fixtures.
 * Usage: imported by scripts/go_port/core_l0_reference.ts.
 */
import {
  createAPIRetryPolicy,
  createLLMRetryPolicy,
  createRetryPolicy,
  type IParsedRequestFile,
  type IRequestCancelResult,
  type IRequestFrontmatter,
  type IRetryContext,
  type IRetryPolicyConfig,
  type IRetryResult,
  MIN_REQUEST_ID_PREFIX_CHARS,
} from "@exaix/core/request";
import { MilestoneEventBusEmitter } from "@exaix/core/observability";
import type { IEventBusService } from "@exaix/core/observability";
import { RequestStatus } from "@exaix/core/status";
import type { IExecutionMilestone, IStreamingEvent } from "@exaix/schemas";

type PartialRetryConfig = Partial<IRetryPolicyConfig>;

const RETRY_CONFIG_CASES: PartialRetryConfig[] = [
  {},
  { maxRetries: 0 },
  { maxRetries: 10, initialDelayMs: 60000, maxDelayMs: 300000, backoffMultiplier: 5, jitterFactor: 1 },
  { maxRetries: 2.5, backoffMultiplier: 1.5, jitterFactor: 0.3 },
  { temperatureIncrement: 0.5, maxTemperature: 2 },
  { retryableErrors: ["CustomError"] },
  { retryableErrors: [] },
  { maxRetries: 11 },
  { maxRetries: -1 },
  { initialDelayMs: 0 },
  { initialDelayMs: 60001 },
  { maxDelayMs: 300001 },
  { maxDelayMs: 0 },
  { backoffMultiplier: 0.9 },
  { backoffMultiplier: 5.1 },
  { jitterFactor: 1.1 },
  { jitterFactor: -0.1 },
  { temperatureIncrement: 0.6 },
  { maxTemperature: 2.1 },
  { maxTemperature: -1 },
];

const DELAY_ATTEMPTS = [0, 1, 2, 3, 5, 8, 12];
const JITTER_SAMPLES = [0, 0.25, 0.5, 0.999];

function configOutcome(partial: PartialRetryConfig): object {
  try {
    return { input: partial, valid: true, config: createRetryPolicy(partial).getConfig() };
  } catch {
    return { input: partial, valid: false };
  }
}

function delayCases(): object[] {
  const configs: PartialRetryConfig[] = [
    {},
    { initialDelayMs: 500, maxDelayMs: 60000, backoffMultiplier: 2, jitterFactor: 0.1 },
    { initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 1.5, jitterFactor: 0.3 },
    { initialDelayMs: 7, maxDelayMs: 100, backoffMultiplier: 3, jitterFactor: 1 },
  ];
  const realRandom = Math.random;
  try {
    return configs.flatMap((config) => {
      const policy = createRetryPolicy(config);
      return DELAY_ATTEMPTS.flatMap((attempt) =>
        JITTER_SAMPLES.map((sample) => {
          Math.random = () => sample;
          return {
            config: policy.getConfig(),
            attempt,
            jitter_sample: sample,
            delay_ms: policy.calculateDelay(attempt),
          };
        })
      );
    });
  } finally {
    Math.random = realRandom;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INJECTED_EVENT_ID = "99999999-8888-4777-8666-555555555555";
const INJECTED_TIMESTAMP = "2026-06-01T00:00:00.000Z";
const SAMPLE_UUID = "11111111-2222-4333-8444-555555555555";

const FRONTMATTER_SAMPLES: IRequestFrontmatter[] = [
  {
    trace_id: SAMPLE_UUID,
    created: "2026-01-02T03:04:05.000Z",
    status: RequestStatus.PENDING,
    priority: "normal",
    source: "cli",
    created_by: "user",
  },
  {
    trace_id: SAMPLE_UUID,
    created: "2026-01-02T03:04:05.000Z",
    status: RequestStatus.IN_PROGRESS,
    priority: "high",
    agent_role: "coder",
    flow: "build",
    source: "cli",
    created_by: "user",
    portal: "main",
    allow_dynamic_routing: true,
    target_branch: "feat/x",
    model: "m",
    model_size: "L",
    preferred_provider: "anthropic",
    thinking: "auto",
    effort: "high",
    characteristics: ["cheapest"],
    skills: ["a", "b"],
    tags: "single",
    subject: "Subject",
    assessed_at: "2026-01-02T03:04:06.000Z",
    clarification_session_path: "r_clarification.json",
    acceptance_criteria: ["done"],
    expected_outcomes: ["out"],
    scope: { include: ["src"], exclude: ["dist"] },
    scenario_id: "s1",
    step_id: "st1",
    recording_lanes: false,
    plan_context_ref: ".exa/PlanContext/p.md",
  },
  {
    trace_id: SAMPLE_UUID,
    created: "2026-01-02T03:04:05.000Z",
    status: RequestStatus.COMPLETED,
    priority: "low",
    source: "api",
    created_by: "bot",
    thinking: true,
    skills: "a,b",
  },
];

const CANCEL_SAMPLES: IRequestCancelResult[] = [
  { trace_id: SAMPLE_UUID, filename: "request-1.md", previous_status: RequestStatus.PENDING, status: "cancelled" },
];

function parsedFileSamples(): IParsedRequestFile[] {
  return FRONTMATTER_SAMPLES.map((frontmatter, index) => ({
    frontmatter,
    body: index === 0 ? "" : "# Body\nText\n",
    rawContent: `---\ntrace_id: ${frontmatter.trace_id}\n---\n`,
  }));
}

function retrySamples(): { context: object[]; result: object[] } {
  const contexts: IRetryContext[] = [
    { attempt: 1, elapsedMs: 1200, error: new Error("rate limit"), delayMs: 1000, temperature: 0.7 },
  ];
  const results: IRetryResult<string>[] = [
    { success: true, value: "ok", totalAttempts: 1, totalTimeMs: 5, retryHistory: [] },
    {
      success: false,
      error: new Error("timeout"),
      totalAttempts: 2,
      totalTimeMs: 1500,
      retryHistory: [{
        attempt: 0,
        error: "timeout",
        errorType: "TimeoutError",
        delayMs: 0,
        temperature: 0.7,
        timestamp: "2026-01-02T03:04:05.000Z",
      }],
    },
  ];
  return {
    context: contexts.map((c) => ({ ...c, error: c.error.message })),
    result: results.map((r) => ({ ...r, error: r.error?.message })),
  };
}

const MILESTONES: IExecutionMilestone[] = [
  {
    milestoneId: SAMPLE_UUID,
    traceId: "trace-1",
    milestoneType: "flow.started",
    requiresAttention: false,
    occurredAt: "2026-01-02T03:04:05.000Z",
    summary: "Flow started",
  },
  {
    milestoneId: SAMPLE_UUID,
    traceId: "trace-2",
    milestoneType: "approval.gate.entered",
    requiresAttention: true,
    attentionReason: "Needs approval",
    progressHint: { stepsCompleted: 2, stepsTotal: 5, currentStepLabel: "review" },
    occurredAt: "2026-01-02T03:04:06.000Z",
    summary: "Waiting for approval",
  },
  {
    milestoneId: SAMPLE_UUID,
    traceId: "trace-3",
    milestoneType: "flow.step.completed",
    requiresAttention: false,
    progressHint: { stepsTotal: 3 },
    occurredAt: "2026-01-02T03:04:07.000Z",
    summary: "Step done",
  },
];

async function milestoneCases(): Promise<object[]> {
  const published: IStreamingEvent[] = [];
  const bus: IEventBusService = {
    publish: (event) => void published.push(event),
    subscribe: () => () => {},
    close: () => {},
  };
  const emitter = new MilestoneEventBusEmitter(bus);
  const cases: object[] = [];
  for (const milestone of MILESTONES) {
    await emitter.emit(milestone);
    const event = published[published.length - 1];
    if (!UUID_PATTERN.test(event.eventId) || Number.isNaN(Date.parse(event.timestamp))) {
      throw new Error("The reference emitter produced an event without a valid id or timestamp");
    }
    cases.push({ milestone, event: { ...event, eventId: INJECTED_EVENT_ID, timestamp: INJECTED_TIMESTAMP } });
  }
  return cases;
}

/** Builds the fixture of request data samples, retry policy cases and milestone projections. */
export async function buildRequestFixture(): Promise<object> {
  return {
    min_request_id_prefix_chars: MIN_REQUEST_ID_PREFIX_CHARS,
    frontmatter_samples: FRONTMATTER_SAMPLES,
    parsed_file_samples: parsedFileSamples(),
    cancel_result_samples: CANCEL_SAMPLES,
    retry_samples: retrySamples(),
    retry_configs: RETRY_CONFIG_CASES.map(configOutcome),
    retry_presets: {
      default: createRetryPolicy().getConfig(),
      llm: createLLMRetryPolicy().getConfig(),
      api: createAPIRetryPolicy().getConfig(),
    },
    retry_delays: delayCases(),
    milestone_projections: await milestoneCases(),
  };
}
