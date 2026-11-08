/**
 * @module ApprovalListTest
 * @path apps/exactl/tests/approval_list_test.ts
 * @description Verifies `approval list` over the eight pending-decision sources: one row per kind, clarification de-duplication, kind filter, failing sources and valid act commands.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/src/commands/approval_sources.ts, apps/exactl/src/commands/approval_commands.ts, apps/exactl/tests/helpers/test_setup.ts]
 * @related-files [apps/exactl/src/commands/approval_sources.ts, apps/exactl/src/commands/approval_commands.ts]
 */

import { assert, assertArrayIncludes, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { createMinimalProposal, createStubGit, runtimeSkillFixture } from "@exaix/testing";
import type { IPlanMetadata } from "@exaix/core/types";
import { PlanStatus, ReviewStatus } from "@exaix/core/status";
import { SkillStatus } from "@exaix/core";
import type { IWaitState } from "@exaix/flow";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { APPROVAL_SOURCE_TIMEOUT_MS, ApprovalCommands } from "../src/commands/approval_commands.ts";
import { ApprovalKind } from "../src/commands/approval_id.ts";
import {
  createApprovalSources,
  type IApprovalListEntry,
  type IApprovalReaders,
  type IApprovalSource,
} from "../src/commands/approval_sources.ts";
import type { IReviewMetadata } from "../src/commands/review_commands.ts";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { ToolCommands } from "../src/commands/tool_commands.ts";
import { WaitStateCommands } from "../src/commands/wait_state_commands.ts";
import { ExaCtlError, ExaCtlExitCode } from "../src/exactl_errors.ts";
import { createExaCtlCommand } from "../src/exactl.ts";
import { type ICommandTreeNode, walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

const TRACE = "trace-clarify-1";
const OTHER_TRACE = "trace-clarify-2";
const WAIT_TOKEN = "550e8400-e29b-41d4-a716-446655440001";
const CLARIFY_TOKEN = "550e8400-e29b-41d4-a716-446655440011";
const ORPHAN_TOKEN = "550e8400-e29b-41d4-a716-446655440012";
const TOOL_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_STEM = "request-abcd1234";
const PLAN_ID = "plan-1";
const AMENDMENT_PLAN_ID = "plan-2";
const REVIEW_ID = "feat/request-x-trace-1";
const SKILL_NAME = "draft-skill";
const SKILL_REVISION = "550e8400-e29b-41d4-a716-446655440099";
const SHELL_WORD = /'(?:[^']|'\\'')*'|\S+/g;
const SHORT_TIMEOUT_MS = 20;
const SPACED_PLAN_ID = "my plan";
const ALL_KINDS = Object.values(ApprovalKind).sort();
const OLDEST = "2026-01-01T00:00:00.000Z";
const NEWEST = "2026-12-01T00:00:00.000Z";

type CliContext = Awaited<ReturnType<typeof createCliTestContext>>;

const PLAN: IPlanMetadata = { id: PLAN_ID, status: PlanStatus.REVIEW, subject: "Add cache", created_at: OLDEST };
const AMENDMENT: IPlanMetadata = {
  id: AMENDMENT_PLAN_ID,
  status: PlanStatus.AMENDMENT_PENDING,
  request_subject: "Amend scope",
  created_at: OLDEST,
};
const REVIEW: IReviewMetadata = {
  branch: REVIEW_ID,
  trace_id: "trace-review",
  request_id: "request-review",
  files_changed: 2,
  created_at: OLDEST,
  agent_role: "senior-coder",
  request_subject: "Review the cache",
  status: ReviewStatus.PENDING,
};

function makeWaitState(resumeToken: string, overrides: Partial<IWaitState> = {}): IWaitState {
  return {
    waitStateId: crypto.randomUUID(),
    traceId: TRACE,
    kind: "plan_approval",
    status: "pending",
    artifactPath: "Workspace/Active/test-flow",
    resumeToken,
    createdAt: NEWEST,
    updatedAt: NEWEST,
    metadata: {},
    ...overrides,
  };
}

function makeToolRequest(): ToolConfirmationRequest {
  return {
    id: TOOL_ID,
    toolName: "exaix_request_create",
    args: { title: "Create request" },
    stepId: "step-1",
    traceId: "tool-trace-1",
    requestedAt: NEWEST,
    expiresAt: "2099-05-18T10:02:00.000Z",
  };
}

async function seedWaitState(env: CliContext, waitState: IWaitState): Promise<void> {
  const config = env.context.config.getAll();
  const dir = join(env.tempDir, config.paths.workspace!, config.paths.waitStates!, waitState.traceId);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, `${waitState.waitStateId}.json`), JSON.stringify(waitState));
}

async function seedClarificationRequest(env: CliContext, stem: string, traceId: string): Promise<void> {
  const config = env.context.config.getAll();
  const dir = join(env.tempDir, config.paths.workspace!, config.paths.requests!);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `${stem}.md`),
    `---\ntrace_id: ${traceId}\nstatus: needs_clarification\ncreated: ${OLDEST}\ncreated_by: tester\nsource: cli\nsubject: Clarify me\n---\nBody\n`,
  );
}

function makeReaders(env: CliContext, overrides: Partial<IApprovalReaders> = {}): IApprovalReaders {
  env.context.git = createStubGit({ getCurrentBranch: () => Promise.resolve("main") });
  return {
    plans: {
      list: (status) => Promise.resolve(status === PlanStatus.REVIEW ? [PLAN] : []),
      listAmendments: () => Promise.resolve([AMENDMENT]),
    },
    reviews: { list: () => Promise.resolve([REVIEW]) },
    requests: new RequestCommands(env.context),
    memory: {
      listPendingProposals: () => Promise.resolve([createMinimalProposal()]),
      listDraftSkills: () =>
        Promise.resolve([runtimeSkillFixture({
          skill_id: SKILL_NAME,
          name: SKILL_NAME,
          id: SKILL_REVISION,
          status: SkillStatus.DRAFT,
          title: "Draft Skill",
        })]),
    },
    waitStates: new WaitStateCommands(env.context),
    tools: new ToolCommands(env.context),
    ...overrides,
  };
}

function makeCommands(env: CliContext, overrides: Partial<IApprovalReaders> = {}): ApprovalCommands {
  const waitStates = new WaitStateCommands(env.context);
  const tools = new ToolCommands(env.context);
  const readers = makeReaders(env, { waitStates, tools, ...overrides });
  return new ApprovalCommands(
    env.context,
    waitStates,
    tools,
    createApprovalSources(readers),
    APPROVAL_SOURCE_TIMEOUT_MS,
  );
}

async function seedAllSources(env: CliContext): Promise<void> {
  await seedClarificationRequest(env, REQUEST_STEM, TRACE);
  await seedWaitState(env, makeWaitState(WAIT_TOKEN));
  await env.db.insertToolConfirmationRequest(makeToolRequest());
}

/** The words of a command line. A single quoted word keeps its spaces, and `'\\''` is a quote inside it. */
function tokenizeAct(act: string): string[] {
  const words = act.match(SHELL_WORD) ?? [];
  return words.map((word) => word.startsWith("'") ? word.slice(1, -1).replaceAll("'\\''", "'") : word);
}

/** Resolves the words of an act command to a tree node and checks its positionals and options. */
function resolveAct(nodes: readonly ICommandTreeNode[], act: string): string | null {
  const [root, ...words] = tokenizeAct(act);
  if (root !== "exactl") return `not an exactl command: ${act}`;
  let path: string[] = [];
  let node: ICommandTreeNode | undefined;
  const positionals: string[] = [];
  const flags: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word.startsWith("--")) {
      flags.push(word);
      index++;
      continue;
    }
    const next = nodes.find((candidate) =>
      candidate.path.length === path.length + 1 && candidate.path.every((part, i) =>
        i === path.length || part === path[i]
      ) &&
      candidate.path[path.length] === word
    );
    if (next !== undefined && positionals.length === 0) {
      path = next.path;
      node = next;
    } else positionals.push(word);
  }
  if (node === undefined) return `no command path: ${act}`;
  if (positionals.length > 0 && node.args.length === 0) return `${node.path.join(" ")} takes no argument: ${act}`;
  const known = new Set(node.options.flatMap((option) => option.flags));
  const unknown = flags.filter((flag) => !known.has(flag));
  return unknown.length === 0 ? null : `unknown option ${unknown.join(", ")}: ${act}`;
}

Deno.test("a workspace seeded with one item per source lists 8 rows, one per kind", async () => {
  const env = await createCliTestContext();
  try {
    await seedAllSources(env);
    const entries = await makeCommands(env).list({});
    assertEquals(entries.map((entry) => entry.kind).sort(), ALL_KINDS);
    for (const entry of entries) assertStringIncludes(entry.ref, `${entry.kind}:`);
    const byKind = Object.fromEntries(entries.map((entry) => [entry.kind, entry]));
    assertEquals(byKind[ApprovalKind.PLAN].act, `exactl plan approve ${PLAN_ID}`);
    assertEquals(byKind[ApprovalKind.AMENDMENT].act, `exactl plan amendment approve ${AMENDMENT_PLAN_ID}`);
    assertEquals(byKind[ApprovalKind.REVIEW].act, `exactl review approve ${REVIEW_ID}`);
    assertEquals(byKind[ApprovalKind.SKILL].act, `exactl skill approve ${SKILL_NAME} --revision ${SKILL_REVISION}`);
    assertEquals(byKind[ApprovalKind.WAIT].act, `exactl approval approve wait:${WAIT_TOKEN}`);
    assertEquals(byKind[ApprovalKind.TOOL].act, `exactl approval approve tool:${TOOL_ID}`);
    assertStringIncludes(byKind[ApprovalKind.PROPOSAL].act, "exactl memory proposal approve ");
  } finally {
    await env.cleanup();
  }
});

Deno.test("rows sort by created_at ascending and a row without a timestamp lists last", async () => {
  const env = await createCliTestContext();
  try {
    await seedAllSources(env);
    const entries = await makeCommands(env).list({});
    const stamps = entries.map((entry) => entry.created_at);
    const dated = stamps.filter((stamp) => stamp !== "");
    assertEquals(dated, [...dated].sort());
    assertEquals(stamps.indexOf(""), stamps.length - 1);
    assertEquals(entries.at(-1)?.kind, ApprovalKind.SKILL);
  } finally {
    await env.cleanup();
  }
});

Deno.test("a clarification wait state is shown once, as its clarification row", async () => {
  const env = await createCliTestContext();
  try {
    await seedClarificationRequest(env, REQUEST_STEM, TRACE);
    await seedWaitState(env, makeWaitState(CLARIFY_TOKEN, { kind: "clarification", traceId: TRACE }));
    await seedWaitState(env, makeWaitState(ORPHAN_TOKEN, { kind: "clarification", traceId: OTHER_TRACE }));
    const entries = await makeCommands(env).list({ kinds: [ApprovalKind.CLARIFICATION, ApprovalKind.WAIT] });
    const refs = entries.map((entry) => entry.ref);
    assertEquals(refs.sort(), [`clarification:${REQUEST_STEM}`, `wait:${ORPHAN_TOKEN}`]);
  } finally {
    await env.cleanup();
  }
});

Deno.test("--kind plan,tool filters to those kinds", async () => {
  const env = await createCliTestContext();
  try {
    await seedAllSources(env);
    const entries = await makeCommands(env).list({ kinds: ["plan", "tool"] });
    assertEquals(entries.map((entry) => entry.kind).sort(), [ApprovalKind.PLAN, ApprovalKind.TOOL]);
    const bad = await assertRejects(() => makeCommands(env).list({ kinds: ["plan", "nope"] }), ExaCtlError);
    assertEquals(bad.code, ExaCtlExitCode.USAGE);
    assertStringIncludes(bad.message, "nope");
  } finally {
    await env.cleanup();
  }
});

Deno.test("a failing source prints a stderr notice and the other rows still list", async () => {
  const env = await createCliTestContext();
  const notices: string[] = [];
  const consoleError = stub(console, "error", (...parts: string[]) => {
    notices.push(parts.join(" "));
  });
  try {
    await seedAllSources(env);
    const commands = makeCommands(env, {
      reviews: { list: () => Promise.reject(new Error("fatal: not a git repository")) },
    });
    const entries = await commands.list({});
    assertEquals(entries.map((entry) => entry.kind).sort(), ALL_KINDS.filter((kind) => kind !== ApprovalKind.REVIEW));
    assertEquals(notices.length, 1);
    assertStringIncludes(notices[0], ApprovalKind.REVIEW);
    assertStringIncludes(notices[0], "not a git repository");
  } finally {
    consoleError.restore();
    await env.cleanup();
  }
});

Deno.test("each row's act command parses in the live tree", async () => {
  const env = await createCliTestContext();
  try {
    await seedAllSources(env);
    const entries = await makeCommands(env).list({});
    const nodes = walkCommandTree(createExaCtlCommand());
    assertEquals(entries.length, ALL_KINDS.length);
    const problems = entries.map((entry) => resolveAct(nodes, entry.act)).filter((problem) => problem !== null);
    assertEquals(problems, []);
  } finally {
    await env.cleanup();
  }
});

Deno.test("a clarification row's ref is the request filename stem that request clarify accepts", async () => {
  const env = await createCliTestContext();
  try {
    await seedClarificationRequest(env, REQUEST_STEM, TRACE);
    const entries = await makeCommands(env).list({ kinds: [ApprovalKind.CLARIFICATION] });
    assertEquals(entries.length, 1);
    assertEquals(entries[0].ref, `clarification:${REQUEST_STEM}`);
    assertEquals(entries[0].act, `exactl request clarify ${REQUEST_STEM}`);
    assertEquals(entries[0].trace_id, TRACE);
    const config = env.context.config.getAll();
    const requestFile = join(env.tempDir, config.paths.workspace!, config.paths.requests!, `${REQUEST_STEM}.md`);
    assert((await Deno.stat(requestFile)).isFile, "request clarify joins `${requestId}.md` under Requests");
  } finally {
    await env.cleanup();
  }
});

Deno.test("a wait row's resume token is absent from the journal after approval list", async () => {
  const env = await createCliTestContext();
  try {
    await seedAllSources(env);
    const entries = await makeCommands(env).list({});
    assertArrayIncludes(entries.map((entry) => entry.ref), [`wait:${WAIT_TOKEN}`]);
    await env.db.waitForFlush();
    const rows = env.db.instance.prepare("SELECT payload, target, action_type FROM activity").all() as Array<
      { payload: string; target: string; action_type: string }
    >;
    assertEquals(rows.filter((row) => JSON.stringify(row).includes(WAIT_TOKEN)), []);
  } finally {
    await env.cleanup();
  }
});

Deno.test("--status selects wait states of another status and lists no other kind", async () => {
  const env = await createCliTestContext();
  try {
    await seedAllSources(env);
    await seedWaitState(env, makeWaitState(ORPHAN_TOKEN, { status: "fulfilled" }));
    const entries = await makeCommands(env).list({ status: "fulfilled" });
    assertEquals(entries.map((entry) => entry.ref), [`wait:${ORPHAN_TOKEN}`]);
  } finally {
    await env.cleanup();
  }
});

Deno.test("approval list prints a notice for a source that exceeds the timeout and lists the other rows", async () => {
  const env = await createCliTestContext();
  const notices: string[] = [];
  const consoleError = stub(console, "error", (...parts: string[]) => {
    notices.push(parts.join(" "));
  });
  try {
    const entry: IApprovalListEntry = {
      kind: ApprovalKind.PLAN,
      ref: `plan:${PLAN_ID}`,
      summary: "Add cache",
      created_at: OLDEST,
      trace_id: undefined,
      act: `exactl plan approve ${PLAN_ID}`,
    };
    const hanging: IApprovalSource = { kind: ApprovalKind.REVIEW, list: () => new Promise(() => {}) };
    const quick: IApprovalSource = { kind: ApprovalKind.PLAN, list: () => Promise.resolve([entry]) };
    const commands = new ApprovalCommands(
      env.context,
      new WaitStateCommands(env.context),
      new ToolCommands(env.context),
      [hanging, quick],
      SHORT_TIMEOUT_MS,
    );

    const entries = await commands.list({});

    assertEquals(entries.map((row) => row.ref), [entry.ref]);
    assertEquals(notices.length, 1);
    assertStringIncludes(notices[0], ApprovalKind.REVIEW);
    assertStringIncludes(notices[0], "timed out");
  } finally {
    consoleError.restore();
    await env.cleanup();
  }
});

Deno.test("act quotes a plan id that holds a space and parses in the live tree", async () => {
  const env = await createCliTestContext();
  try {
    const commands = makeCommands(env, {
      plans: {
        list: (status) => Promise.resolve(status === PlanStatus.REVIEW ? [{ ...PLAN, id: SPACED_PLAN_ID }] : []),
        listAmendments: () => Promise.resolve([]),
      },
    });
    const [entry] = await commands.list({ kinds: [ApprovalKind.PLAN] });
    assertEquals(entry.act, `exactl plan approve '${SPACED_PLAN_ID}'`);
    assertEquals(resolveAct(walkCommandTree(createExaCtlCommand()), entry.act), null);
  } finally {
    await env.cleanup();
  }
});

Deno.test("approval list help names EXA_PORTAL as the other source of the portal of a draft skill", () => {
  const node = walkCommandTree(createExaCtlCommand()).find((candidate) => candidate.path.join(" ") === "approval list");
  assertStringIncludes(node?.description ?? "", "EXA_PORTAL");
});
