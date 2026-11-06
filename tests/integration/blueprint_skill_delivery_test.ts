/**
 * @module BlueprintSkillDeliveryTest
 * @path tests/integration/blueprint_skill_delivery_test.ts
 * @description Exercises actual flow-to-CLI skill delivery, response contracts, and immutable usage provenance without model calls.
 * @architectural-layer Test
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/execution/src/agent_composer.ts]
 */
import {
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertGreater,
  assertNotMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { AgentComposerAdapter } from "@exaix/flow";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { PlanSchema } from "@exaix/schemas/plan_schema.ts";
import { REPO_ROOT } from "@exaix/testing";
import { withEnv } from "@exaix/testing";
import type { ISkillPin } from "@exaix/core/skills";
import { EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR } from "@exaix/execution";
import { copy } from "@std/fs";
import { FlowRunner } from "@exaix/flow";
import { flowSkillDeliveryFixture } from "./helpers/flow_skill_delivery_fixture.ts";

for (
  const sample of [
    { role: "software-architect", skill: "implementation-plan" },
    { role: "default", skill: "blueprint-best-practices" },
    { role: "product-manager", skill: "requirements-analysis" },
  ]
) {
  Deno.test(`flow delivery: ${sample.skill} and its response contract reach the CLI before launch`, async () => {
    const fx = await flowSkillDeliveryFixture();
    try {
      const request = fx.request([sample.skill, sample.skill]);
      if (sample.skill !== "requirements-analysis") {
        const file = sample.skill === "implementation-plan"
          ? "implementation_plan_delivery.md"
          : "blueprint_authoring_delivery.md";
        request.userPrompt = await Deno.readTextFile(
          Deno.args[0] ?? join(REPO_ROOT, "tests/scenario_framework/fixtures/requests/skill_eval", file),
        );
      }
      await fx.execute(sample.role, request);
      assertEquals(fx.launches.length, 1);
      const launch = fx.launches[0];
      assertStringIncludes(launch.objective, request.userPrompt);
      for (const name of [sample.skill, "response-contract"]) {
        const skill = await fx.skills.getSkill(name);
        assertExists(skill);
        assertStringIncludes(launch.objective, skill.instructions);
        const usages = launch.usage.filter((row) => row.skill_name === name);
        assertEquals(usages.length, 1);
        assertEquals(usages[0].revision_id, skill.id);
        assertEquals(usages[0].root_kind, "blueprint");
        assertEquals(usages[0].flow_id, "feature-development");
        assertEquals(usages[0].flow_step_id, "design-architecture");
        assertEquals(usages[0].agent_role, sample.role);
        assertEquals(usages[0].trace_id, request.traceId);
        assertEquals(usages[0].request_id, request.requestId);
        assertEquals(usages[0].match_source, "plan_pinned");
        assertStringIncludes(usages[0].source_path, name);
      }
    } finally {
      await fx.cleanup();
    }
  });
}

Deno.test("flow delivery: missing explicit skills prevent the CLI launch", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    await assertRejects(() => fx.execute("default", fx.request(["missing-skill"])), Error, "missing-skill");
    assertEquals(fx.launches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: revision persistence failures prevent launch", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    fx.skills.ensureRevisions = () => Promise.reject(new Error("revision persistence unavailable"));
    await assertRejects(
      () => fx.execute("default", fx.request(["blueprint-best-practices"])),
      Error,
      "revision persistence unavailable",
    );
    assertEquals(fx.launches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: submission failures prevent launch", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    fx.skills.recordSubmission = () => Promise.reject(new Error("usage unavailable"));
    await assertRejects(
      () => fx.execute("default", fx.request(["blueprint-best-practices"])),
      Error,
      "usage unavailable",
    );
    assertEquals(fx.launches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: the ordinary runner receives explicitly selected skills", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    const requests: object[] = [];
    const adapter = new AgentComposerAdapter({
      run: (_blueprint, request) => {
        requests.push(request);
        return Promise.resolve({ thought: "checked", content: "done", raw: "done" });
      },
    }, join(fx.env.tempDir, "Blueprints", "Agents"));
    await adapter.run("software-architect", fx.request(["implementation-plan"]));
    assertEquals(requests[0], { ...requests[0], skills: ["implementation-plan"] });
  } finally {
    await fx.cleanup();
  }
});

for (
  const sample of [
    { id: "feature-development", step: "design-architecture" },
    { id: "refactoring", step: "identify-improvements" },
  ]
) {
  Deno.test(`flow delivery: shipped ${sample.id} selects the planning skill through FlowRunner`, async () => {
    const fx = await flowSkillDeliveryFixture();
    try {
      const flow = FlowSchema.parse(
        parse(await Deno.readTextFile(join(REPO_ROOT, "Blueprints", "Flows", `${sample.id}.flow.yaml`))),
      );
      const result = await new FlowRunner({
        agentExecutor: {
          run: () => Promise.resolve({ thought: "fixture", content: "{}", raw: "{}" }),
          runWithStrategy: (role, request, strategy) =>
            request.flowStepId === sample.step
              ? fx.adapter.runWithStrategy(role, request, strategy)
              : Promise.resolve({ thought: "fixture", content: "{}", raw: "{}" }),
        },
        eventLogger: { log: () => {} },
      }).execute(flow, {
        userPrompt: await Deno.readTextFile(
          Deno.args[0] ??
            join(REPO_ROOT, "tests/scenario_framework/fixtures/requests/skill_eval/implementation_plan_delivery.md"),
        ),
        portal: "project",
        traceId: crypto.randomUUID(),
        requestId: "request-flow",
      });
      assertEquals(result.success, true, JSON.stringify([...result.stepResults.values()]));
      assertEquals(fx.launches.length, 1);
      const launch = fx.launches[0];
      for (const name of ["implementation-plan", "response-contract"]) {
        const row = launch.usage.find((entry) => entry.skill_name === name);
        assertExists(row);
        assertEquals(row.flow_id, sample.id);
        assertEquals(row.flow_step_id, sample.step);
      }
      const artifact = result.stepResults.get(sample.step)?.result?.content;
      assertEquals(PlanSchema.safeParse(JSON.parse(String(artifact))).success, true);
    } finally {
      await fx.cleanup();
    }
  });
}

Deno.test("flow delivery: an insufficient response-contract budget prevents launch", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    fx.config.skills.context_budget_chars = 2000;
    await assertRejects(
      () => fx.execute("default", fx.request([])),
      Error,
      "response-contract",
    );
    assertEquals(fx.launches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: missing role response contracts prevent launch", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    await Deno.remove(join(fx.env.tempDir, "Blueprints", "Skills", "response-contract"), { recursive: true });
    await assertRejects(
      () => fx.execute("default", fx.request(["blueprint-best-practices"])),
      Error,
      "response-contract",
    );
    assertEquals(fx.launches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: a mismatched composer role root prevents launch", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    const other = join(fx.env.tempDir, "other-blueprints");
    await copy(join(fx.env.tempDir, "Blueprints"), other);
    fx.config.paths.blueprints = other;
    await assertRejects(() => fx.execute("default", fx.request(["blueprint-best-practices"])), Error, "roots disagree");
    assertEquals(fx.launches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: an explicit planning skill cannot be silently dropped by its budget", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    fx.config.skills.context_budget_chars = 8000;
    await assertRejects(
      () => fx.execute("software-architect", fx.request(["implementation-plan"])),
      Error,
      "implementation-plan",
    );
    assertEquals(fx.launches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: optional budget omissions agree with pins, prompt text and submission rows", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    const resolve = fx.skills.resolvePinned.bind(fx.skills);
    let last: readonly ISkillPin[] = [];
    fx.skills.resolvePinned = (pins, operation) => {
      last = pins;
      return resolve(pins, operation);
    };
    fx.config.skills.context_budget_chars = 6000;
    await fx.execute("software-architect", fx.request([]));
    assertArrayIncludes(last.map((pin) => pin.name), [
      "response-contract",
      "architecture-review",
      "collaborative-flow",
    ]);
    const omitted = last.filter((pin) => !pin.content_included);
    assertGreater(omitted.length, 0);
    for (const pin of omitted) {
      const skill = await fx.skills.getSkill(pin.name);
      assertExists(skill);
      assertNotMatch(fx.launches[0].objective, new RegExp(RegExp.escape(skill.instructions)));
      assertEquals(fx.launches[0].usage.filter((row) => row.skill_name === pin.name), []);
    }
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: the existing injection opt-out prevents skill submission", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    fx.config.skills.inject_in_prompt = false;
    await fx.execute("default", fx.request(["blueprint-best-practices"]));
    assertEquals(fx.launches.length, 1);
    assertEquals(fx.launches[0].usage, []);
    const skill = await fx.skills.getSkill("blueprint-best-practices");
    assertExists(skill);
    assertNotMatch(fx.launches[0].objective, new RegExp(RegExp.escape(skill.instructions)));
  } finally {
    await fx.cleanup();
  }
});

Deno.test("flow delivery: evaluation suppression applies to explicit skills and role defaults", async () => {
  const fx = await flowSkillDeliveryFixture();
  try {
    await withEnv({ [EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR]: "blueprint-best-practices,error-handling" }, async () => {
      await fx.execute("default", fx.request(["blueprint-best-practices"]));
    });
    assertEquals(fx.launches.length, 1);
    const names = fx.launches[0].usage.map((row) => row.skill_name);
    assertEquals(names.filter((name) => ["blueprint-best-practices", "error-handling"].includes(name)), []);
    assertArrayIncludes(names, ["response-contract"]);
  } finally {
    await fx.cleanup();
  }
});
