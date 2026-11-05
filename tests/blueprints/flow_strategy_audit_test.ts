/**
 * @module FlowStrategyAuditTest
 * @path tests/blueprints/flow_strategy_audit_test.ts
 * @description Cross-checks Phase 159 Step 7's flow catalog strategy audit table (recorded in
 *   exaix-dev-docs/planning/phase-159-flow-step-execution-strategy.md) against a live
 *   enumeration of Blueprints/Flows/*.flow.yaml, so no step in the shipped catalog silently
 *   lacks an explicit strategy decision and no flow's strategy assignment regresses unnoticed.
 */
import { DEFAULT_BLUEPRINTS_PATH, DEFAULT_FLOWS_DIR } from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { FlowLoader } from "@exaix/flow";
import { FlowValidatorImpl } from "@exaix/flow";
import { FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IFlowStep } from "@exaix/schemas/flow.ts";

const FLOWS_DIR = `./${DEFAULT_FLOWS_DIR}`;
const BLUEPRINTS_DIR = `./${DEFAULT_BLUEPRINTS_PATH}`;

type Decision = "react" | "cli_delegate" | "no-strategy" | "n/a-dynamic" | "session_delegate_cycle";

/** The frozen flow strategy audit table, kept as test data. */
const AUDIT_TABLE: Record<string, Record<string, Decision>> = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/flow_strategy_audit.json", import.meta.url)),
);

async function listCatalogFlowIds(): Promise<string[]> {
  const ids: string[] = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;
    ids.push(entry.name.replace(".flow.yaml", ""));
  }
  return ids;
}

function actualDecision(step: IFlowStep): Decision {
  if (step.type === FlowStepType.SESSION_DELEGATE_CYCLE) return "session_delegate_cycle";
  if (step.execution_mode === FlowStepExecutionMode.DYNAMIC) return "n/a-dynamic";
  if (step.strategy === "react") return "react";
  if (step.strategy === "cli_delegate") return "cli_delegate";
  return "no-strategy";
}

Deno.test("Flow strategy audit: catalog enumeration matches the audit table's flows", async () => {
  const liveIds = (await listCatalogFlowIds()).sort();
  const tableIds = Object.keys(AUDIT_TABLE).sort();
  assertEquals(liveIds, tableIds);
});

Deno.test("Flow strategy audit: every catalog step has an explicit, recorded decision matching reality", async () => {
  const loader = new FlowLoader(FLOWS_DIR);
  const missing: string[] = [];
  const mismatches: string[] = [];
  let totalSteps = 0;

  for (const flowId of await listCatalogFlowIds()) {
    const flow = await loader.loadFlow(flowId);
    const flowTable = AUDIT_TABLE[flowId] ?? {};
    for (const step of flow.steps) {
      totalSteps++;
      const expected = flowTable[step.id];
      if (expected === undefined) {
        missing.push(`${flowId}.${step.id}`);
        continue;
      }
      const actual = actualDecision(step);
      if (actual !== expected) {
        mismatches.push(`${flowId}.${step.id}: expected ${expected}, found ${actual}`);
      }
    }
  }

  // Catches the opposite drift from `missing`: a stale AUDIT_TABLE entry for a step that no
  // longer exists — more entries than live steps means one is phantom. No hardcoded total:
  // this stays self-consistent against the live catalog.
  const flatAuditEntries = Object.values(AUDIT_TABLE).reduce((sum, table) => sum + Object.keys(table).length, 0);

  assertEquals(missing, [], `steps with no recorded audit decision: ${missing.join(", ")}`);
  assertEquals(mismatches, [], `steps whose actual strategy diverges from the audit table: ${mismatches.join(", ")}`);
  assertEquals(
    flatAuditEntries,
    totalSteps,
    `AUDIT_TABLE has ${flatAuditEntries} entries but the live catalog has ${totalSteps} steps — ` +
      "a table entry likely refers to a renamed/removed step",
  );
});

Deno.test("Flow strategy audit: every catalog flow still validates after the strategy rollout", async () => {
  const loader = new FlowLoader(FLOWS_DIR);
  const validator = new FlowValidatorImpl(loader, BLUEPRINTS_DIR);
  const invalid: string[] = [];

  for (const flowId of await listCatalogFlowIds()) {
    const result = await validator.validateFlow(flowId);
    if (!result.valid) {
      invalid.push(`${flowId}: ${result.error}`);
    }
  }

  assertEquals(invalid, [], `flows that no longer validate after the strategy rollout: ${invalid.join(", ")}`);
});
