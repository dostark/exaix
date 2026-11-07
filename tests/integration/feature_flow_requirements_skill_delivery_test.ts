/**
 * @module FeatureFlowRequirementsSkillDeliveryTest
 * @path tests/integration/feature_flow_requirements_skill_delivery_test.ts
 * @description Checks shipped requirements-step selection, immutable CLI delivery, durable usage and safe omission without live models.
 * @architectural-layer Test
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/flow/src/flow_skill_pins.ts]
 */
import { assertEquals, assertExists, assertNotMatch, assertRejects, assertStringIncludes } from "@std/assert";
import ts from "typescript";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { REPO_ROOT } from "@exaix/testing";
import { createPinnedSkillPrompt, StrategyRegistry } from "@exaix/execution";
import { createBlueprintLoader } from "@exaix/core/blueprint";
import { ExecutionStrategyName, SKILL_EVENT_RESOLVED, SkillMatchSource } from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";
import { AgentComposerAdapter } from "@exaix/flow";
import { PortalPermissionsService } from "@exaix/portal";
import { AgentRunnerSkills } from "../../packages/execution/src/agent_runner_skills.ts";
import { prepareFlowSkillPins } from "../../packages/flow/src/flow_skill_pins.ts";
import { createSkillOperationContext, type ISkillPin } from "@exaix/core/skills";
import { flowSkillDeliveryFixture } from "./helpers/flow_skill_delivery_fixture.ts";

Deno.test("feature requirements: shipped step submits the exact pinned revision and usage before launch", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    const flow = FlowSchema.parse(
      parse(await Deno.readTextFile(join(REPO_ROOT, "Blueprints/Flows/feature-development.flow.yaml"))),
    );
    const vectors: ISkillPin[][] = [];
    const resolve = fx.skills.resolvePinned.bind(fx.skills);
    fx.skills.resolvePinned = (pins, operation) => {
      vectors.push([...pins]);
      return resolve(pins, operation);
    };
    const traceId = crypto.randomUUID();
    const result = await fx.executeFlowStep(flow, "analyze-requirements", {
      portal: "project",
      traceId,
      requestId: "requirements-flow",
      userPrompt: Deno.args[0]
        ? await Deno.readTextFile(Deno.args[0])
        : "Specify a CLI command that counts pending requests, including counts zero and two.",
    });
    assertEquals(result.success, true, JSON.stringify([...result.stepResults.values()]));
    assertEquals(fx.launches.length, 1);
    const launch = fx.launches[0];
    const requirements = await fx.skills.getSkill("requirements-analysis");
    assertExists(requirements);
    assertStringIncludes(launch.objective, requirements.instructions);
    const names = ["requirements-analysis", "response-contract", "typescript-patterns"];
    assertEquals(launch.usage.map((row) => row.skill_name).sort(), names);
    const pins = vectors.at(-1);
    assertExists(pins);
    const revisions = await fx.env.db.preparedAll<{ revision_id: string }>(
      "SELECT revision_id FROM skill_revisions ORDER BY revision_id",
    );
    assertEquals(revisions.map((row) => row.revision_id), pins.map((pin) => pin.revision_id).sort());
    assertEquals(pins.map((pin) => pin.name).sort(), names);
    for (const pin of pins) {
      const skill = await fx.skills.getSkill(pin.name);
      assertExists(skill);
      assertStringIncludes(launch.objective, skill.instructions);
      assertEquals(pin.content_included, true);
      assertEquals(pin.revision_id, skill.id);
      assertEquals(pin.content_sha256, skill.content_sha256);
      const row = launch.usage.find((item) => item.skill_name === pin.name);
      assertExists(row);
      assertEquals(
        { revision: row.revision_id, hash: row.content_sha256, root: row.root_kind, path: row.source_path },
        { revision: pin.revision_id, hash: pin.content_sha256, root: pin.root_kind, path: pin.source_path },
      );
      assertEquals({
        role: row.agent_role,
        trace: row.trace_id,
        request: row.request_id,
        flow: row.flow_id,
        step: row.flow_step_id,
      }, {
        role: "product-manager",
        trace: traceId,
        request: "requirements-flow",
        flow: flow.id,
        step: "analyze-requirements",
      });
    }
    const events = await fx.resolutions();
    assertEquals(events.length, 1);
    assertEquals(events[0].trace_id, traceId);
    const event = JSON.parse(events[0].payload);
    assertEquals(event.skill_ids, ["typescript-patterns", "response-contract", "requirements-analysis"]);
    assertEquals(event.skill_count, 3);
    assertEquals(event.pinned_skill_ids, ["typescript-patterns"]);
    assertEquals(event.default_skill_ids, ["response-contract", "requirements-analysis"]);
    if (Deno.args[0]) {
      console.log(
        JSON.stringify({ pins, objective: launch.objective, usage_before_launch: launch.usage, resolution: event }),
      );
    }
  } finally {
    await fx.cleanup();
  }
});

for (const failure of ["missing-default", "revision-write", "usage-write"]) {
  Deno.test(`feature requirements: ${failure} prevents CLI launch`, async () => {
    const fx = await flowSkillDeliveryFixture();
    try {
      if (failure === "missing-default") {
        await Deno.remove(join(fx.env.tempDir, "Blueprints/Skills/requirements-analysis"), { recursive: true });
      }
      if (failure === "revision-write") fx.skills.ensureRevisions = () => Promise.reject(new Error(failure));
      if (failure === "usage-write") fx.skills.recordSubmission = () => Promise.reject(new Error(failure));
      const request = { ...fx.request(["typescript-patterns"]), flowStepId: "analyze-requirements" };
      await assertRejects(
        () => fx.execute("product-manager", request),
        Error,
        failure === "missing-default" ? "requirements-analysis" : failure,
      );
      assertEquals(fx.launches, []);
    } finally {
      await fx.cleanup();
    }
  });
}

Deno.test("feature requirements: a budget-omitted default has no prompt body or submitted usage", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    const request = { ...fx.request(["typescript-patterns"]), flowStepId: "analyze-requirements" };
    const operation = createSkillOperationContext({
      portal: "project",
      agentRole: "product-manager",
      traceId: request.traceId,
    });
    const pins: ISkillPin[][] = [];
    const resolve = fx.skills.resolvePinned.bind(fx.skills);
    fx.skills.resolvePinned = (selected, context) => {
      pins.push([...selected]);
      return resolve(selected, context);
    };
    await fx.execute("product-manager", { ...request, traceId: crypto.randomUUID() });
    const baseline = pins.at(-1);
    assertExists(baseline);
    const required = baseline.filter((pin) => pin.name !== "requirements-analysis");
    const prompt = await createPinnedSkillPrompt(fx.skills, required, operation);
    assertExists(prompt);
    fx.config.skills.context_budget_chars = prompt.text.length;
    fx.launches.length = 0;
    const narrowed = { ...request, traceId: crypto.randomUUID() };
    await fx.execute("product-manager", narrowed);
    const final = pins.at(-1);
    assertExists(final);
    const omitted = final.find((pin) => pin.name === "requirements-analysis");
    assertExists(omitted);
    assertEquals(omitted.content_included, false);
    const skill = await fx.skills.getSkill("requirements-analysis");
    assertExists(skill);
    assertNotMatch(fx.launches[0].objective, new RegExp(RegExp.escape(skill.instructions)));
    assertEquals(
      fx.launches[0].usage.filter((row) => row.trace_id === narrowed.traceId).map((row) => row.skill_name).sort(),
      required.map((pin) => pin.name).sort(),
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("feature requirements: skill tool metadata does not widen delegate permissions", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    const request = { ...fx.request(["typescript-patterns"]), flowStepId: "analyze-requirements" };
    fx.config.skills.inject_in_prompt = false;
    await fx.execute("product-manager", request);
    fx.config.skills.inject_in_prompt = true;
    const path = join(fx.env.tempDir, "Blueprints/Skills/requirements-analysis/exaix.yaml");
    await Deno.writeTextFile(path, await Deno.readTextFile(path) + "\ntools: [run_deno_task]\n");
    await fx.execute("product-manager", { ...request, traceId: crypto.randomUUID() });
    assertEquals(fx.launches.length, 2);
    assertEquals(fx.launches[1].args.slice(2), fx.launches[0].args.slice(2));
  } finally {
    await fx.cleanup();
  }
});

Deno.test("feature requirements: daemon adapter receives its unique shared skills service binding", async () => {
  const source = ts.createSourceFile(
    "main.ts",
    await Deno.readTextFile(join(REPO_ROOT, "apps/daemon/main.ts")),
    ts.ScriptTarget.Latest,
    true,
  );
  const bindings: ts.VariableDeclaration[] = [];
  const adapters: ts.NewExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "skillsService") {
      bindings.push(node);
    }
    if (
      ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "AgentComposerAdapter"
    ) adapters.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assertEquals(bindings.length, 1);
  assertEquals(adapters.length, 1);
  const service = bindings[0].initializer;
  if (!service || !ts.isNewExpression(service) || !ts.isIdentifier(service.expression)) {
    throw new Error("Shared service must be constructed locally");
  }
  assertEquals(service.expression.text, "SkillsService");
  const dependencies = adapters[0].arguments?.[2];
  if (!dependencies || !ts.isObjectLiteralExpression(dependencies)) {
    throw new Error("Adapter dependencies are not explicit");
  }
  const supplied = dependencies.properties.find((property) =>
    (ts.isShorthandPropertyAssignment(property) && property.name.text === "skillsService") ||
    (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "skillsService" &&
      ts.isIdentifier(property.initializer) && property.initializer.text === "skillsService")
  );
  assertExists(supplied, "The daemon adapter must receive the unique shared service binding");
});

Deno.test("flow skill pins match runner precedence, confidence, required flags and resolution payload", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    const loader = createBlueprintLoader(join(fx.env.tempDir, "Blueprints"));
    const blueprint = await loader.load("product-manager");
    assertExists(blueprint);
    const traceId = crypto.randomUUID();
    const request = {
      ...fx.request(["typescript-patterns", "requirements-analysis", "typescript-patterns"]),
      traceId,
      flowStepId: "analyze-requirements",
    };
    let matchingCalls = 0;
    fx.skills.matchSkills = () => {
      matchingCalls++;
      return Promise.reject(new Error("Explicit flow skills skip matching"));
    };
    const selected = await prepareFlowSkillPins({
      skills: fx.skills,
      config: fx.config,
      logger: fx.logger,
      blueprint,
      request,
      traceId,
    });
    const runnerEvents: Array<Record<string, JSONValue>> = [];
    const runner = new AgentRunnerSkills({
      skillsService: fx.skills,
      disableSkills: false,
      contextBudgetChars: () => fx.config.skills.context_budget_chars,
      journal: {
        record: (action, _target, payload) => {
          if (action === SKILL_EVENT_RESOLVED) runnerEvents.push(payload);
        },
      },
    });
    const matched = await runner.matchAndApplySkills(
      loader.toLegacyBlueprint(blueprint),
      {
        userPrompt: request.userPrompt,
        context: {},
        skills: request.skills,
        portal: request.portal,
        traceId: request.traceId,
        requestId: request.requestId,
        flowId: request.flowId,
        flowStepId: request.flowStepId,
      },
      "product-manager",
      selected.operation,
    );
    const prompt = await createPinnedSkillPrompt(fx.skills, selected.pins, selected.operation);
    assertExists(prompt);
    const usage = runner.buildSkillUsagePlan(matched.skillsContext, prompt.text, false, selected.operation);
    const expected = await runner.persistSkillPins(matched.skillsContext, usage, false, selected.operation);
    assertEquals(selected.pins, expected);
    assertEquals(
      selected.pins.map((pin) => ({
        name: pin.name,
        confidence: pin.confidence,
        required: pin.required,
        source: pin.match_source,
        tasks: pin.matched_task_types,
      })),
      [
        { name: "requirements-analysis", confidence: 1, required: true, source: SkillMatchSource.PINNED, tasks: [] },
        { name: "typescript-patterns", confidence: 1, required: true, source: SkillMatchSource.PINNED, tasks: [] },
        { name: "response-contract", confidence: 0.5, required: false, source: SkillMatchSource.DEFAULT, tasks: [] },
      ],
    );
    assertEquals(matchingCalls, 0);
    const events = await fx.resolutions();
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(events[0].payload), runnerEvents[0]);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("non-CLI strategy does not select CLI pins when the skills dependency is supplied", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    fx.skills.getSkill = () => Promise.reject(new Error("The CLI pin selector must not run"));
    const registry = new StrategyRegistry();
    let calls = 0;
    registry.register({
      name: ExecutionStrategyName.REACT,
      execute: (_blueprint, _context, options, prompt) => {
        calls++;
        assertEquals(options.resolved_skills, undefined);
        assertEquals(prompt, null);
        return Promise.resolve({
          branch: "fixture",
          commit_sha: "0".repeat(40),
          files_changed: [],
          description: "Checked",
          tool_calls: 0,
          execution_time_ms: 0,
        });
      },
    });
    const adapter = new AgentComposerAdapter(
      { run: () => Promise.reject(new Error("Unexpected fallback")) },
      join(fx.env.tempDir, "Blueprints/Agents"),
      {
        config: fx.config,
        db: fx.env.db,
        logger: fx.logger,
        skillsService: fx.skills,
        strategyRegistry: registry,
        permissions: new PortalPermissionsService(fx.config.portals),
      },
    );
    const result = await adapter.runWithStrategy(
      "product-manager",
      fx.request(["typescript-patterns"]),
      ExecutionStrategyName.REACT,
    );
    assertEquals(result.content, "Checked");
    assertEquals(calls, 1);
    assertEquals(await fx.rows(), []);
  } finally {
    await fx.cleanup();
  }
});
