/**
 * @module SessionReturnWatchHelpers
 * @path tests/integration/helpers/session_return_watch_helpers.ts
 * @description Shared session-return rig, fixed clock, and brief/return builders for the
 *   SessionReturnProcessor integration and security tests.
 * @architectural-layer Test
 * @related-files [tests/integration/session_return_watch_test.ts, tests/integration/session_return_watch_security_test.ts]
 */

import { join } from "@std/path";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";

export interface ITestRig {
  sessionDir: string;
  waitDir: string;
  store: SessionWaitStore;
  processor: SessionReturnProcessor;
  service: SessionDelegateService;
  cleanup: () => Promise<void>;
}

const FIXED_NOW = new Date("2026-06-11T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

export async function makeRig(): Promise<ITestRig> {
  const sessionDir = await Deno.makeTempDir();
  const waitDir = await Deno.makeTempDir();
  const store = new SessionWaitStore(waitDir, fixedClock);
  const resultStore = new SessionDelegationResultStore(waitDir, fixedClock.now);
  const service = new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
  });
  const processor = new SessionReturnProcessor({
    sessionDir,
    workspaceRoot: sessionDir,
    waitStore: store,
    resultStore,
  });
  return {
    sessionDir,
    waitDir,
    store,
    processor,
    service,
    cleanup: async () => {
      await Deno.remove(sessionDir, { recursive: true });
      await Deno.remove(waitDir, { recursive: true });
    },
  };
}

export async function park(rig: ITestRig, brief: SessionBrief): Promise<void> {
  await rig.store.park(brief.trace_id, brief.gate, brief.resume_token, brief.deadline);
}

export async function dropReturn(rig: ITestRig, traceId: string, body: string | object): Promise<void> {
  const dir = join(rig.sessionDir, traceId);
  await Deno.mkdir(dir, { recursive: true });
  const target = join(dir, "return.json");
  const tmp = `${target}.tmp`;
  await Deno.writeTextFile(tmp, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  await Deno.rename(tmp, target);
}

export async function briefFor(
  rig: ITestRig,
  gate: SessionBrief["gate"],
  permitted: string[],
): Promise<SessionBrief> {
  return await rig.service.prepareBrief({
    traceId: crypto.randomUUID(),
    agentRole: "test-role",
    gate,
    tool: "claude-code",
    objective: "Do the work.",
    artifactRef: "Workspace/Plans/req_plan.md",
    permittedPaths: permitted,
    tokenBudget: { max_input_tokens: 50_000, max_output_tokens: 50_000, max_total_tokens: 100_000 },
  });
}
