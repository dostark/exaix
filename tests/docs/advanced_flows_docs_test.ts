/**
 * @module AdvancedFlowsDocsTest
 * @path tests/docs/advanced_flows_docs_test.ts
 * @description Keeps the flow authoring guide, architecture and flow package reference aligned with the shipped gate, loop, branch and capability behavior.
 * @architectural-layer Tests
 * @dependencies [@exaix/schemas, @exaix/core, @exaix/flow, @std/toml, @std/yaml]
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import {
  DEFAULT_FLOW_GATE_MAX_EVALUATIONS,
  DEFAULT_FLOW_NAMESPACE_PROMPT_MAX_BYTES,
  FlowGateOnFail,
  FlowStepSkipCode,
  FlowStepType,
} from "@exaix/core";
import { CRITERIA } from "@exaix/core/evaluation";
import { CAP_VOTING } from "@exaix/core/composer";
import { BindingOverlaySchema, ConfigSchema, FlowSchema } from "@exaix/schemas";
import * as flowControlErrors from "../../packages/flow/src/errors/flow_control_errors.ts";
import { readUserGuide } from "./helpers.ts";

const BLUEPRINT_IDS = [
  "self-correcting-implementation",
  "triage-router",
  "parallel-research",
  "guarded-change",
  "architecture-decision",
];

function sectionOf(markdown: string, heading: string, level: number): string {
  const start = markdown.indexOf(`\n${heading}\n`);
  assert(start >= 0, `Missing section ${heading}`);
  const body = start + heading.length + 2;
  const next = markdown.slice(body).search(new RegExp(`\\n#{2,${level}} `));
  return markdown.slice(start, next < 0 ? undefined : body + next);
}

async function authoringGuide(): Promise<string> {
  const guide = await readUserGuide();
  return sectionOf(guide, "##### Flow Step Types", 5) +
    sectionOf(guide, "##### Advanced Flow Controls", 5);
}

function blocks(markdown: string, info: string): string[] {
  const pattern = new RegExp("```" + info + "\\n([\\s\\S]*?)```", "g");
  return [...markdown.matchAll(pattern)].map((match) => match[1]);
}

function flat(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

Deno.test("[docs] the guide documents every onFail value and skipCode, and its examples parse", async () => {
  const guide = await authoringGuide();
  for (const value of Object.values(FlowGateOnFail)) assertStringIncludes(guide, `\`${value}\``);
  for (const value of Object.values(FlowStepSkipCode)) assertStringIncludes(guide, `\`${value}\``);
  const examples = blocks(guide, "yaml flow");
  assert(examples.length >= 3, "Expected gate, loop and branch flow examples");
  for (const example of examples) {
    const flow = FlowSchema.parse(parseYaml(example));
    assert(flow.steps.length > 0);
  }
  const text = flat(guide).toLowerCase();
  for (
    const phrase of [
      "`gate_halted`",
      "`onError` is rejected on a gate; use `evaluate.onFail`",
      "halted gate fails the run whatever `failFast` or `continue_on_error` say",
      "`evaluate.maxRetries` caps the total gate evaluations",
      "`input.source: feedback` is removed",
      "steps that consume loop output must depend on the gate",
    ]
  ) assertStringIncludes(text, phrase.toLowerCase());
});

Deno.test("[docs] gate, loop, branch and capability examples carry the documented fields", async () => {
  const flows = blocks(await authoringGuide(), "yaml flow").map((block) => FlowSchema.parse(parseYaml(block)));
  const gate = flows.flatMap((flow) => flow.steps).find((step) => step.evaluate?.onFail === FlowGateOnFail.RETRY);
  assert(gate, "Missing a retrying gate example");
  assertEquals(gate.loop?.backTo !== undefined, true);
  assert(gate.evaluate!.maxRetries >= 2);
  const branch = flows.flatMap((flow) => flow.steps).find((step) => step.type === "branch");
  assert(branch, "Missing a branch example");
  assert((branch.branches ?? []).length > 0);
  assert(branch.default !== undefined);
  assert(flows.some((flow) => flow.requires_capabilities?.includes(CAP_VOTING)));
});

Deno.test("[docs] User Guide updated for every changed interface/schema/config/CLI field; examples parse", async () => {
  const guide = await authoringGuide();
  const text = flat(guide);
  for (const code of Object.entries(flowControlErrors).filter(([name]) => name.endsWith("_CODE")).map(([, v]) => v)) {
    assertStringIncludes(guide, `\`${code}\``);
  }
  for (
    const phrase of [
      "flow.max_gate_evaluations",
      `default ${DEFAULT_FLOW_GATE_MAX_EVALUATIONS}`,
      "max_flow_retry_cost_usd",
      "flow.namespace_prompt_max_bytes",
      String(DEFAULT_FLOW_NAMESPACE_PROMPT_MAX_BYTES),
      "requires_capabilities",
      "`[voting]`",
      "capability_unavailable",
      "`results.<step-id>.data`",
      "append writes are not allowed in a loop body",
      "`flow_control_resume_unsupported`",
      "untrusted",
      "`effort`",
      "`thinking`",
    ]
  ) assertStringIncludes(text, phrase);
  for (const id of BLUEPRINT_IDS) {
    assertStringIncludes(guide, `\`${id}\``);
    assertStringIncludes(guide, `configs/bindings/flows/${id}.example.toml`);
  }
  assertFalse(guide.includes("action: feedback"), "stale gate onFail action syntax");
  assertFalse(guide.includes("onMaxIterations"), "stale loop syntax");
});

Deno.test("[docs] config and overlay examples parse through their owning schemas", async () => {
  const guide = await authoringGuide();
  const configs = blocks(guide, "toml config");
  assert(configs.length > 0, "Missing a flow config example");
  const config = ConfigSchema.parse(parseToml(configs[0]));
  assertEquals(config.flow?.max_gate_evaluations, 5);
  assertEquals(config.flow?.namespace_prompt_max_bytes, 8192);
  assert((config.max_flow_retry_cost_usd ?? 0) > 0);
  const overlays = blocks(guide, "toml overlay");
  assertEquals(overlays.length, BLUEPRINT_IDS.length);
  for (const overlay of overlays) {
    const parsed = BindingOverlaySchema.parse(parseToml(overlay));
    assert(Object.keys(parsed.bindings ?? {}).every((selector) => /^(flow|role):/.test(selector)));
  }
});

Deno.test("[docs] overlay examples match the shipped companion overlay files", async () => {
  const guide = await authoringGuide();
  const shown = blocks(guide, "toml overlay").map((block) => JSON.stringify(parseToml(block)));
  for (const id of BLUEPRINT_IDS) {
    const shipped = JSON.stringify(parseToml(await Deno.readTextFile(`configs/bindings/flows/${id}.example.toml`)));
    assert(shown.includes(shipped), `Guide overlay for ${id} drifted from the shipped file`);
  }
});

Deno.test("[docs] the guide says --overlay reads TOML directly", async () => {
  const text = flat(await readUserGuide());
  assertStringIncludes(text, "`--overlay` reads them directly");
  assertStringIncludes(text, "parses a file as TOML when its name ends in `.toml`");
  assertFalse(text.includes("even if a filename ends in `.toml`"));
});

Deno.test("[docs] Flow Commands documents availability in exactl flow list", async () => {
  const guide = await readUserGuide();
  const commands = flat(sectionOf(guide, "#### **Flow Commands** - Manage multi-agent workflows", 4));
  assertStringIncludes(commands, "exactl flow list");
  assertStringIncludes(commands, "unavailable (needs voting)");
  assertStringIncludes(commands, "tierEligible");
});

Deno.test("[docs] Flows README lists the advanced blueprints and the self-correcting template", async () => {
  const readme = await Deno.readTextFile("Blueprints/Flows/README.md");
  for (const id of BLUEPRINT_IDS) assertStringIncludes(readme, `${id}.flow.yaml`);
  assertStringIncludes(readme, "self-correcting.flow.template.yaml");
  assertStringIncludes(readme, "requires_capabilities");
});

Deno.test("[docs] architecture invariant and flow package reject flow-gate approval claims", async () => {
  const architecture = await Deno.readTextFile("ARCHITECTURE.md");
  const invariant = architecture.slice(
    architecture.indexOf("## Request Processing Flow"),
    architecture.indexOf("## Request Quality Gate"),
  );
  const qualityGate = sectionOf(architecture, "## Request Quality Gate", 2);
  const axes = sectionOf(architecture, "### Flow Step Execution Axes {#flow-step-execution-axes}", 3);
  const readme = await Deno.readTextFile("packages/flow/README.md");
  const gateSections = [invariant, qualityGate, axes, readme.slice(0, readme.indexOf("## Step Durability"))];
  const stale = [
    /FlowRunner pauses on failing quality gates/i,
    /Operator approves, rejects, or amends wait states/i,
    /gate step\s+score falls below threshold and `waitStateService` is configured/i,
    /When a quality gate step fails during flow execution and a `waitStateService`/i,
    /flow\.wait\.created/,
    /action: feedback/,
  ];
  for (const section of gateSections) for (const pattern of stale) assertFalse(pattern.test(section), `${pattern}`);
  assertStringIncludes(flat(invariant), "halt");
  assertStringIncludes(flat(axes), "branch_not_taken");
  assertStringIncludes(flat(axes), "capability_unavailable");
  assertStringIncludes(flat(axes), "loop re-execution");
  assertStringIncludes(flat(readme), "`gate_halted`");
  assertStringIncludes(flat(readme), "`isCapabilityAvailable`");
});

Deno.test("[docs] session-delegation wait-state documentation is retained", async () => {
  const architecture = await Deno.readTextFile("ARCHITECTURE.md");
  assertStringIncludes(architecture, "resumes the gate's durable wait state (`@exaix/session`)");
  const readme = await Deno.readTextFile("packages/flow/README.md");
  assertStringIncludes(readme, "resumes a durable wait state");
  assertStringIncludes(readme, "## Session Delegate Cycle");
  assertStringIncludes(flat(readme), "session delegation");
});

Deno.test("[docs] changelog records the added blueprints, branch routing, loops and the gate change", async () => {
  const changelog = await Deno.readTextFile("docs/CHANGELOG.md");
  const start = changelog.indexOf("## Unreleased — Phase 205");
  assert(start >= 0, "Missing Phase 205 changelog section");
  const next = changelog.indexOf("\n## ", start + 5);
  const section = changelog.slice(start, next < 0 ? undefined : next);
  assertStringIncludes(section, "### Added");
  assertStringIncludes(section, "### Changed");
  assertStringIncludes(section, "gates now halt");
});

function firstColumn(table: string): string[] {
  return table.split("\n").filter((line) => line.startsWith("| `")).map((line) =>
    line.split("|")[1].trim().replaceAll("`", "")
  );
}

const GATE_WAIT_CLAIM =
  /(gate[^.\n]{0,80}\b(?<!not )creates?\b[^.\n]{0,40}wait state)|(wait state[^.\n]{0,80}(failing|fails|failed)[^.\n]{0,40}gate)/i;

Deno.test("[docs] every step type in the guide table is a FlowStepType member", async () => {
  const guide = await readUserGuide();
  const table = sectionOf(guide, "##### Flow Step Types", 5);
  const types = firstColumn(table);
  assert(types.length >= 4);
  const valid = new Set<string>(Object.values(FlowStepType));
  for (const type of types) assert(valid.has(type), `The guide lists '${type}', which is not a FlowStepType`);
  for (const type of ["agent", "gate", "branch", "voting_group"]) assert(types.includes(type));
});

Deno.test("[docs] built-in evaluation criteria in the guide are library criteria", async () => {
  const guide = await readUserGuide();
  const start = guide.indexOf("**Built-in Evaluation Criteria:**");
  assert(start >= 0);
  const names = firstColumn(guide.slice(start, start + 800));
  const library = new Set<string>(Object.values(CRITERIA).map((criterion) => criterion.name));
  assert(names.length >= 4);
  for (const name of names) assert(library.has(name), `The guide lists '${name}', which is not a library criterion`);
});

Deno.test("[docs] the guide shows the exact None label for flows without capabilities", async () => {
  const commands = flat(sectionOf(await readUserGuide(), "#### **Flow Commands** - Manage multi-agent workflows", 4));
  assertStringIncludes(commands, "shows `None`");
});

Deno.test("[docs] no flow-gate wait-state claim remains in the guide or architecture", async () => {
  const guide = flat(await readUserGuide());
  const architecture = flat(await Deno.readTextFile("ARCHITECTURE.md"));
  assertFalse(GATE_WAIT_CLAIM.test(guide), `guide: ${guide.match(GATE_WAIT_CLAIM)?.[0]}`);
  assertFalse(GATE_WAIT_CLAIM.test(architecture), `architecture: ${architecture.match(GATE_WAIT_CLAIM)?.[0]}`);
  assertStringIncludes(guide, "session delegation");
  assertStringIncludes(architecture, "wait states for session delegation");
});

Deno.test("[docs] the stale-claim detector flags a reintroduced gate wait-state sentence", () => {
  const stale =
    "When a flow reaches a quality gate that fails below the threshold, the FlowRunner creates a durable wait state.";
  assert(GATE_WAIT_CLAIM.test(stale));
  assertFalse(GATE_WAIT_CLAIM.test("A flow gate that fails below its threshold halts the run with gate_halted."));
  assertFalse(GATE_WAIT_CLAIM.test("A flow gate step does not create a wait state."));
});
