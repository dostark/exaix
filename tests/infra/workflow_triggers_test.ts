/**
 * @module WorkflowTriggersTest
 * @path tests/infra/workflow_triggers_test.ts
 * @description Verifies that CI triggers on the go-port integration branch exactly as on main.
 */

import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";

const WORKFLOWS_DIR = ".github/workflows";
const MAIN_BRANCH = "main";
const PORT_BRANCH = "go-port";
const BRANCH_EVENTS = ["push", "pull_request"] as const;
const TEAM_TEST_COMMAND = "deno task test:team";
const MAIN_TRIGGERED_WORKFLOWS = ["code-quality.yml", "pr-validation.yml", "merge-validation.yml"];

interface IBranchTrigger {
  branches?: string[];
}

interface IWorkflowStep {
  run?: string;
}

interface IWorkflowJob {
  steps?: IWorkflowStep[];
}

interface IWorkflow {
  on?: Record<string, IBranchTrigger | null>;
  jobs?: Record<string, IWorkflowJob>;
}

interface IBranchListing {
  workflow: string;
  event: string;
  branches: string[];
}

async function readWorkflows(): Promise<Map<string, IWorkflow>> {
  const workflows = new Map<string, IWorkflow>();
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".yml")) continue;
    const text = await Deno.readTextFile(join(WORKFLOWS_DIR, entry.name));
    workflows.set(entry.name, parse(text) as IWorkflow);
  }
  return workflows;
}

function listBranchTriggers(workflows: Map<string, IWorkflow>): IBranchListing[] {
  const listings: IBranchListing[] = [];
  for (const [workflow, definition] of workflows) {
    for (const event of BRANCH_EVENTS) {
      const branches = definition.on?.[event]?.branches;
      if (branches !== undefined) listings.push({ workflow, event, branches });
    }
  }
  return listings;
}

Deno.test("workflow triggers: every main push/pull_request trigger also lists go-port", async () => {
  const listings = listBranchTriggers(await readWorkflows());
  const mainTriggers = listings.filter((listing) => listing.branches.includes(MAIN_BRANCH));

  const triggered = new Set(mainTriggers.map((listing) => listing.workflow));
  for (const workflow of MAIN_TRIGGERED_WORKFLOWS) {
    assert(triggered.has(workflow), `${workflow} has no ${MAIN_BRANCH} push/pull_request trigger`);
  }
  for (const listing of mainTriggers) {
    assertArrayIncludes(
      listing.branches,
      [PORT_BRANCH],
      `${listing.workflow} ${listing.event} lists ${MAIN_BRANCH} but not ${PORT_BRANCH}`,
    );
  }
});

Deno.test("workflow triggers: no branch other than main and go-port is added", async () => {
  const listings = listBranchTriggers(await readWorkflows());
  for (const listing of listings.filter((candidate) => candidate.branches.includes(MAIN_BRANCH))) {
    assertEquals(
      [...listing.branches].sort(),
      [MAIN_BRANCH, PORT_BRANCH].sort(),
      `${listing.workflow} ${listing.event} lists an unexpected branch set`,
    );
  }
});

Deno.test("workflow triggers: the Team test step remains in code-quality", async () => {
  const workflow = (await readWorkflows()).get("code-quality.yml");
  assert(workflow !== undefined, "code-quality.yml is missing");
  const runs = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.run ?? "");
  assert(
    runs.some((run) => run.includes(TEAM_TEST_COMMAND)),
    `code-quality.yml has no step running "${TEAM_TEST_COMMAND}"`,
  );
});
