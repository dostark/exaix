/**
 * @module WatchCommandMilestoneTest
 * @path apps/exactl/tests/commands/watch_milestone_test.ts
 * @description Tests milestone rendering in the CLI watch command's printSseEvent
 * @architectural-layer Testing
 * @ungrounded
 */

import { assertStringIncludes } from "@std/assert";
import { WatchCommand } from "../../src/commands/watch.ts";
import {
  MILESTONE_APPROVAL_GATE_ENTERED,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_STARTED,
  MILESTONE_FLOW_STEP_STARTED,
  STREAMING_EVENT_MILESTONE,
} from "@exaix/core";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";

function makeMilestoneEvent(overrides: Partial<IStreamingEvent> = {}): IStreamingEvent {
  return {
    eventId: crypto.randomUUID(),
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: new Date().toISOString(),
    type: STREAMING_EVENT_MILESTONE,
    payload: {
      milestoneType: MILESTONE_FLOW_STARTED,
      summary: "Flow started",
    },
    ...overrides,
  };
}

function captureConsole(fn: () => void): string {
  const chunks: string[] = [];
  const originalLog = console.log;
  console.log = (...args: string[]) => {
    chunks.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return chunks.join("\n");
}

Deno.test("WatchCommand: renders milestone type in output", () => {
  const event = makeMilestoneEvent({
    payload: { milestoneType: MILESTONE_FLOW_STARTED, summary: "Flow started" },
  });

  const output = captureConsole(() => WatchCommand.printSseEvent(event));
  assertStringIncludes(output, MILESTONE_FLOW_STARTED);
  assertStringIncludes(output, "Flow started");
});

Deno.test("WatchCommand: renders progressHint steps in milestone output", () => {
  const event = makeMilestoneEvent({
    payload: {
      milestoneType: MILESTONE_FLOW_STEP_STARTED,
      summary: "Step 2 of 5 started",
      progressHint: { stepsCompleted: 2, stepsTotal: 5, currentStepLabel: "Build feature" },
    },
  });

  const output = captureConsole(() => WatchCommand.printSseEvent(event));
  assertStringIncludes(output, "2");
  assertStringIncludes(output, "5");
  assertStringIncludes(output, "Build feature");
});

Deno.test("WatchCommand: renders attention indicator when requiresAttention is true", () => {
  const event = makeMilestoneEvent({
    payload: {
      milestoneType: MILESTONE_APPROVAL_GATE_ENTERED,
      summary: "Approval gate entered",
      requiresAttention: true,
      attentionReason: "Operator approval needed to continue",
    },
  });

  const output = captureConsole(() => WatchCommand.printSseEvent(event));
  assertStringIncludes(output, "ATTENTION");
  assertStringIncludes(output, "Operator approval needed");
});

Deno.test("WatchCommand: renders flow.completed milestone", () => {
  const event = makeMilestoneEvent({
    payload: {
      milestoneType: MILESTONE_FLOW_COMPLETED,
      summary: "Flow completed successfully",
      progressHint: { stepsCompleted: 3, stepsTotal: 3 },
    },
  });

  const output = captureConsole(() => WatchCommand.printSseEvent(event));
  assertStringIncludes(output, MILESTONE_FLOW_COMPLETED);
  assertStringIncludes(output, "[3/3]");
});

Deno.test("WatchCommand: existing non-milestone events still render correctly", () => {
  const event: IStreamingEvent = {
    eventId: crypto.randomUUID(),
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: new Date().toISOString(),
    type: "flow.status" as const,
    payload: { status: "running" },
  };

  const output = captureConsole(() => WatchCommand.printSseEvent(event));
  assertStringIncludes(output, "flow.status");
  assertStringIncludes(output, "running");
});
