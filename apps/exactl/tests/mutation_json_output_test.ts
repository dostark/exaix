/**
 * @module MutationJsonOutputTest
 * @path apps/exactl/tests/mutation_json_output_test.ts
 * @description Runs every MUTATION leaf of request, plan, review, approval, flow, blueprint, portal and skill with --json against stubbed command classes and checks the JSON on stdout.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/test_utils.ts, apps/exactl/src/command_docs/mod.ts]
 * @related-files [apps/exactl/src/output/exactl_output.ts, apps/exactl/src/command_docs/mod.ts]
 */

import "./helpers/set_test_mode.ts";
import { assertEquals } from "@std/assert";
import { ExaCtlOutputKind } from "@exaix/cli";
import { PlanStatus, RequestStatus, ReviewStatus } from "@exaix/core/status";
import { RequestPriority, RequestSource } from "@exaix/core";
import type { ExaCtlTestContext } from "../src/exactl.ts";
import { EXACTL_COMMAND_DOCS } from "../src/command_docs/mod.ts";
import { withCapturedSink } from "./helpers/captured_output.ts";
import { withTestMod } from "./helpers/test_utils.ts";

const MUTATION_NOUNS = ["request", "plan", "review", "approval", "flow", "blueprint", "portal", "skill"];
const WAIT_REF = "wait:tok-1";
const WAIT_STATUS = "fulfilled";

interface IMutationCase {
  readonly args: readonly string[];
  readonly stub: (ctx: ExaCtlTestContext) => void;
  readonly expected: { readonly [key: string]: string };
}

type WaitDecision = Awaited<ReturnType<ExaCtlTestContext["waitStateCommands"]["approve"]>>;

function waitDecision(): Promise<WaitDecision> {
  return Promise.resolve({ waitStateId: "ws-1", status: WAIT_STATUS } as WaitDecision);
}

function cancelled(): ReturnType<ExaCtlTestContext["requestCommands"]["cancel"]> {
  return Promise.resolve({
    trace_id: "req-1",
    filename: "request-1.md",
    previous_status: RequestStatus.PENDING,
    status: "cancelled",
  });
}

function resolved(): Promise<void> {
  return Promise.resolve();
}

type SkillResult = Awaited<ReturnType<ExaCtlTestContext["memoryCommands"]["skillCreate"]>>;

function createdSkill(): ReturnType<ExaCtlTestContext["memoryCommands"]["skillCreate"]> {
  return Promise.resolve(
    { skill_id: "s-1", root_kind: "learned", path: "s-1", id: "rev-1", title: "S" } as SkillResult,
  );
}

function blueprintCreated(): ReturnType<ExaCtlTestContext["blueprintCommands"]["create"]> {
  return Promise.resolve({
    agent_role: "a-1",
    name: "A",
    model: "mock:test",
    path: "/tmp/a-1.md",
    capabilities: [],
    created: "now",
    created_by: "tester",
    version: "1.0.0",
  });
}

const CASES: ReadonlyMap<string, IMutationCase> = new Map<string, IMutationCase>([
  ["blueprint create", {
    args: ["blueprint", "create", "a-1", "--name", "A", "--model", "mock:test"],
    stub: (ctx) => void (ctx.blueprintCommands.create = blueprintCreated),
    expected: { id: "a-1", action: "create", status: "created", path: "/tmp/a-1.md" },
  }],
  ["blueprint edit", {
    args: ["blueprint", "edit", "a-1"],
    stub: (ctx) => void (ctx.blueprintCommands.edit = resolved),
    expected: { id: "a-1", action: "edit", status: "edited" },
  }],
  ["blueprint remove", {
    args: ["blueprint", "remove", "a-1", "--force"],
    stub: (ctx) => void (ctx.blueprintCommands.remove = resolved),
    expected: { id: "a-1", action: "remove", status: "removed" },
  }],
  ["blueprint deprecate", {
    args: ["blueprint", "deprecate", "a-1"],
    stub: (ctx) => void (ctx.blueprintCommands.deprecate = resolved),
    expected: { id: "a-1", action: "deprecate", status: "deprecated" },
  }],
  ["portal add", {
    args: ["portal", "add", "/tmp/target", "p-1"],
    stub: (ctx) => void (ctx.portalCommands.add = resolved),
    expected: { id: "p-1", action: "add", status: "added", target: "/tmp/target" },
  }],
  ["portal remove", {
    args: ["portal", "remove", "p-1"],
    stub: (ctx) => void (ctx.portalCommands.remove = resolved),
    expected: { id: "p-1", action: "remove", status: "removed" },
  }],
  ["portal refresh", {
    args: ["portal", "refresh", "p-1"],
    stub: (ctx) => void (ctx.portalCommands.refresh = resolved),
    expected: { id: "p-1", action: "refresh", status: "refreshed" },
  }],
  ["portal knowledge analyze", {
    args: ["portal", "knowledge", "analyze", "p-1"],
    stub: (ctx) => void (ctx.portalCommands.analyze = () => Promise.resolve("Analysis complete")),
    expected: { id: "p-1", action: "analyze", status: "analyzed", summary: "Analysis complete" },
  }],
  ["skill create", {
    args: ["skill", "create", "S"],
    stub: (ctx) => void (ctx.memoryCommands.skillCreate = createdSkill),
    expected: { id: "s-1", action: "create", status: "created", revision: "rev-1", path: "learned/s-1" },
  }],
  ["skill derive", {
    args: ["skill", "derive", "--learning-ids", "l-1", "--name", "S"],
    stub: (ctx) => void (ctx.memoryCommands.skillDerive = createdSkill),
    expected: { id: "s-1", action: "derive", status: "derived", revision: "rev-1", path: "learned/s-1" },
  }],
  ["skill approve", {
    args: ["skill", "approve", "s-1", "--revision", "rev-1"],
    stub: (ctx) =>
      void (ctx.memoryCommands.skillApprove = () =>
        Promise.resolve({ name: "s-1", reviewedRevisionId: "rev-1", activeRevisionId: "rev-2", status: "active" })),
    expected: {
      id: "s-1",
      action: "approve",
      status: "active",
      reviewedRevisionId: "rev-1",
      activeRevisionId: "rev-2",
    },
  }],
  ["skill deprecate", {
    args: ["skill", "deprecate", "s-1"],
    stub: (ctx) =>
      void (ctx.memoryCommands.skillDeprecate = () =>
        Promise.resolve({ name: "s-1", revisionId: "rev-2", status: "deprecated" })),
    expected: { id: "s-1", action: "deprecate", status: "deprecated", revisionId: "rev-2" },
  }],
  ["request cancel", {
    args: ["request", "cancel", "req-1"],
    stub: (ctx) => void (ctx.requestCommands.cancel = cancelled),
    expected: { id: "req-1", action: "cancel", status: "cancelled", previous_status: RequestStatus.PENDING },
  }],
  ["plan approve", {
    args: ["plan", "approve", "p-1"],
    stub: (ctx) => void (ctx.planCommands.approve = resolved),
    expected: { id: "p-1", action: "approve", status: PlanStatus.APPROVED },
  }],
  ["plan reject", {
    args: ["plan", "reject", "p-1", "--reason", "No"],
    stub: (ctx) => void (ctx.planCommands.reject = resolved),
    expected: { id: "p-1", action: "reject", status: PlanStatus.REJECTED },
  }],
  ["plan revise", {
    args: ["plan", "revise", "p-1", "--comment", "Add a step"],
    stub: (ctx) => void (ctx.planCommands.revise = resolved),
    expected: { id: "p-1", action: "revise", status: PlanStatus.NEEDS_REVISION },
  }],
  ["plan amendment approve", {
    args: ["plan", "amendment", "approve", "p-1"],
    stub: (ctx) => void (ctx.planCommands.approveAmendment = resolved),
    expected: { id: "p-1", action: "approve", status: PlanStatus.APPROVED },
  }],
  ["plan amendment reject", {
    args: ["plan", "amendment", "reject", "p-1", "--reason", "No"],
    stub: (ctx) => void (ctx.planCommands.rejectAmendment = resolved),
    expected: { id: "p-1", action: "reject", status: PlanStatus.REJECTED },
  }],
  ["review approve", {
    args: ["review", "approve", "r-1"],
    stub: (ctx) => void (ctx.reviewCommands.approve = resolved),
    expected: { id: "r-1", action: "approve", status: ReviewStatus.APPROVED },
  }],
  ["review reject", {
    args: ["review", "reject", "r-1", "--reason", "No"],
    stub: (ctx) => void (ctx.reviewCommands.reject = resolved),
    expected: { id: "r-1", action: "reject", status: ReviewStatus.REJECTED },
  }],
  ["approval approve", {
    args: ["approval", "approve", WAIT_REF],
    stub: (ctx) => void (ctx.waitStateCommands.approve = waitDecision),
    expected: { id: WAIT_REF, action: "approve", status: WAIT_STATUS },
  }],
  ["approval reject", {
    args: ["approval", "reject", WAIT_REF],
    stub: (ctx) => void (ctx.waitStateCommands.reject = waitDecision),
    expected: { id: WAIT_REF, action: "reject", status: WAIT_STATUS },
  }],
  ["approval amend", {
    args: ["approval", "amend", WAIT_REF],
    stub: (ctx) => void (ctx.waitStateCommands.amend = waitDecision),
    expected: { id: WAIT_REF, action: "amend", status: WAIT_STATUS },
  }],
  ["approval expire", {
    args: ["approval", "expire", WAIT_REF],
    stub: (ctx) => void (ctx.waitStateCommands.expire = waitDecision),
    expected: { id: WAIT_REF, action: "expire", status: WAIT_STATUS },
  }],
  ["approval cancel", {
    args: ["approval", "cancel", WAIT_REF],
    stub: (ctx) => void (ctx.waitStateCommands.cancel = waitDecision),
    expected: { id: WAIT_REF, action: "cancel", status: WAIT_STATUS },
  }],
]);

/** Leaves that print the created or answered entity instead of a mutation result, with the test that holds each. */
const ENTITY_LEAVES: ReadonlyMap<string, string> = new Map([
  ["request create", "request_actions_test.ts and exactl_all_test.ts (create prints the created request with --json)"],
  ["request clarify", "request_actions_test.ts (clarify prints the clarification result with --json)"],
  ["flow run", "mutation_json_output_test.ts (flow run prints the created request with --json)"],
]);

const mutationLeaves = EXACTL_COMMAND_DOCS
  .filter((doc) => MUTATION_NOUNS.includes(doc.path[0]) && doc.output === ExaCtlOutputKind.MUTATION)
  .map((doc) => doc.path.join(" "));

Deno.test("every MUTATION leaf of the work and definition nouns has a case or a named entity test", () => {
  const known = new Set([...CASES.keys(), ...ENTITY_LEAVES.keys()]);
  assertEquals(mutationLeaves.filter((leaf) => !known.has(leaf)), []);
  assertEquals([...known].filter((leaf) => !mutationLeaves.includes(leaf)), []);
});

for (const [leaf, mutation] of CASES) {
  Deno.test(`${leaf} prints the id, the action and the status it set with --json`, async () => {
    await withTestMod(async (mod, ctx) => {
      mutation.stub(ctx);
      const { out } = await withCapturedSink(ctx.outputSink, async () => {
        await mod.__test_command.parse([...mutation.args, "--json"]);
      });
      assertEquals(JSON.parse(out), mutation.expected);
    });
  });
}

Deno.test("a bulk plan approve prints one result per id as a JSON array", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.approve = resolved;
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["plan", "approve", "p-1", "p-2", "--json"]);
    });
    assertEquals(JSON.parse(out), [
      { id: "p-1", action: "approve", status: PlanStatus.APPROVED },
      { id: "p-2", action: "approve", status: PlanStatus.APPROVED },
    ]);
  });
});

Deno.test("flow run prints the created request as JSON with --json", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.create = () =>
      Promise.resolve({
        filename: "/tmp/r.md",
        trace_id: "t-flow",
        priority: RequestPriority.NORMAL,
        agent_role: "a",
        path: "/tmp",
        source: RequestSource.CLI as const,
        created_by: "tester",
        created: "now",
        status: RequestStatus.PENDING,
      });
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["flow", "run", "my-flow", "Do the thing", "--json"]);
    });
    assertEquals(JSON.parse(out).trace_id, "t-flow");
  });
});
