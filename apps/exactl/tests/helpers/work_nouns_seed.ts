/**
 * @module WorkNounsSeed
 * @path apps/exactl/tests/helpers/work_nouns_seed.ts
 * @description Seeds one plan, one request and one wait state into a temporary exactl workspace.
 * @architectural-layer Test
 * @dependencies [@std/path, @exaix/shared]
 * @related-files [apps/exactl/tests/output_contract_work_nouns_test.ts]
 */

import { join } from "@std/path";

export const SEEDED_PLAN_ID = "plan-sweep";
export const SEEDED_REQUEST_TRACE = "7b1d4e60-1c2a-4e3b-9f10-2a6c8d9e0f11";
export const SEEDED_WAIT_TOKEN = "550e8400-e29b-41d4-a716-446655440001";
const SEEDED_WAIT_ID = "550e8400-e29b-41d4-a716-446655440000";

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
}

/** Writes a plan in review, a pending request and a pending wait state under `root`. */
export async function seedWorkNouns(root: string): Promise<void> {
  await writeFile(
    join(root, "Workspace", "Plans", `${SEEDED_PLAN_ID}.md`),
    `---\ntrace_id: "trace-plan"\nstatus: review\nagent_role: senior-coder\ncreated_at: "2026-01-01T00:00:00Z"\nsubject: Plan of the sweep\n---\n\n# Plan\n`,
  );
  await writeFile(
    join(root, "Workspace", "Requests", "request-sweep.md"),
    `---\ntrace_id: ${SEEDED_REQUEST_TRACE}\nstatus: pending\ncreated: 2026-01-03T00:00:00Z\ncreated_by: tester\nsource: cli\nsubject: Request of the sweep\n---\nBody of the request\n`,
  );
  await writeFile(
    join(root, "Workspace", "WaitStates", "trace-wait", `${SEEDED_WAIT_ID}.json`),
    JSON.stringify({
      waitStateId: SEEDED_WAIT_ID,
      traceId: "trace-wait",
      kind: "plan_approval",
      status: "pending",
      artifactPath: "Workspace/Active/test-flow",
      resumeToken: SEEDED_WAIT_TOKEN,
      createdAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
      metadata: {},
    }),
  );
}
