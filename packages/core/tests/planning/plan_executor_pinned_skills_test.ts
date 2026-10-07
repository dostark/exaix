/**
 * @module PlanExecutorPinnedSkillsTest
 * @path packages/core/tests/planning/plan_executor_pinned_skills_test.ts
 * @description Verifies that PlanExecutor replays the plan's pinned skills. Metadata comes from
 *   one resolved snapshot, so floors, tools and task types ignore live edits. An absent vector
 *   keeps dynamic matching, an empty vector disables it and freezes nothing, and an excluded pin
 *   keeps its metadata without a body. Drift is reported once per pin. A malformed vector or an
 *   unresolvable pin fails the execution before any provider call.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/skill_pin_transport.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  createMockConfig,
  createStubConfig,
  createStubDisplay,
  createStubGit,
  runtimeSkillFixture,
  StubSkillsService,
} from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
import {
  McpToolName,
  PricingTier,
  ProviderCostTier,
  SkillMatchSource,
  SkillRenderOutcome,
  SkillRootKind,
} from "@exaix/core";
import type { IApplicationContext, JSONObject, JSONValue } from "@exaix/core/types";
import {
  buildSkillPin,
  type IPinnedSkill,
  type ISkillPin,
  type ISkillSubmission,
  SkillUnavailableError,
} from "@exaix/core/skills";
import type { ISkill } from "@exaix/schemas";
import { PlanExecutor } from "../../src/planning/mod.ts";

const stubDb = { prepare: () => {}, exec: () => {}, all: () => [], close: () => Promise.resolve() };

function skillFor(name: string, body: string, extra: Partial<ISkill> = {}): ISkill {
  return runtimeSkillFixture({
    skill_id: name,
    id: crypto.randomUUID(),
    title: name,
    description: `${name} description`,
    instructions: body,
    triggers: {},
    ...extra,
  });
}

function pinFor(skill: ISkill, overrides: Partial<ISkillPin> = {}): ISkillPin {
  return {
    ...buildSkillPin(
      {
        skillId: skill.skill_id,
        revisionId: skill.id,
        contentSha256: "a".repeat(64),
        rootKind: SkillRootKind.BLUEPRINT,
        sourcePath: skill.skill_id,
        source: SkillMatchSource.MATCHED,
        confidence: 0.8,
        matchedTriggers: { task_types: ["bugfix"] },
        critical: false,
      },
      { portal: null, renderMode: SkillRenderOutcome.FULL, contentIncluded: true },
    ),
    ...overrides,
  };
}

interface IStubCalls {
  matchCalls: number;
  resolved: ISkillPin[][];
  submissions: ISkillSubmission[];
}

/** Resolves pins from `pinned` and reports a different live revision for drift. */
class PinSkillsService extends StubSkillsService {
  readonly calls: IStubCalls = { matchCalls: 0, resolved: [], submissions: [] };
  constructor(
    readonly pinned: Map<string, ISkill>,
    private readonly live: Map<string, ISkill | null>,
    private readonly failWith: Error | null = null,
  ) {
    super();
  }
  override matchSkills() {
    this.calls.matchCalls += 1;
    return Promise.resolve({ matches: [], totalAvailable: 0 });
  }
  override resolvePinned(pins: readonly ISkillPin[]): Promise<IPinnedSkill[]> {
    this.calls.resolved.push([...pins]);
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(pins.map((pin) => {
      const skill = this.pinned.get(pin.name)!;
      return {
        pin,
        loaded: {
          skill,
          revisionId: pin.revision_id,
          contentSha256: pin.content_sha256,
          rootKind: pin.root_kind,
          sourcePath: pin.source_path,
          snapshot: { skill_md: "", exaix_yaml: null, references: [] },
        },
      };
    }));
  }
  override getSkill(name: string): Promise<ISkill | null> {
    return Promise.resolve(this.live.get(name) ?? null);
  }
  override recordSubmission(submission: ISkillSubmission): Promise<void> {
    this.calls.submissions.push(submission);
    return Promise.resolve();
  }
}

async function run(skills: PinSkillsService | null, frontmatter: JSONObject) {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("ollama", new MockProviderFactory(), {
    name: "ollama",
    description: "ollama",
    capabilities: ["chat"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: 128_000,
  });
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/Blueprints/Agents`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/Blueprints/Agents/senior-coder.md`,
    '---\nagent_role: senior-coder\nmodel: ""\npermitted_tools: ["read_file", "write_file", "list_directory"]\n---\n\nStub role.\n',
  );
  const config = createMockConfig(root, {});
  const logger = createMockEventLogger();
  const resolver = new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    config,
    createStubHealthChecker(),
    logger,
  );
  const prompts: string[] = [];
  const provider = {
    id: "stub",
    generate: (prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve({
        content: "STATUS: COMPLETE\nSUMMARY: done",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "stub",
        provider: "stub",
      });
    },
  };
  const context: IApplicationContext = {
    config: createStubConfig(config),
    db: stubDb as never,
    provider: undefined as never,
    git: createStubGit(),
    display: createStubDisplay(stubDb as never),
    ...(skills ? { skills } : {}),
  };
  const executor = new PlanExecutor(config, provider as never, stubDb as never, root, logger, {
    modelResolver: resolver,
    enableGit: false,
    generateReport: false,
    context,
  });
  const execute = () =>
    executor.execute(`${root}/plan.md`, {
      trace_id: crypto.randomUUID(),
      request_id: "pin-req",
      agent_role: "senior-coder",
      frontmatter: { subject: "Fix the null-safety bug", ...frontmatter } as never,
      steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
    });
  return { execute, prompts, logger, cleanup: () => ProviderRegistry.clear() };
}

const NOT_ALLOWED = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
  name: "[selection] pinned metadata, not live edits, drives tools, floors and the rendered body",
  ...NOT_ALLOWED,
  async fn() {
    const approved = skillFor("fix-bug", "Approved body A.", {
      tools: [McpToolName.READ_FILE],
      effort: "high",
    });
    const live = skillFor("fix-bug", "Live body B.", { tools: [McpToolName.LIST_DIRECTORY] });
    const skills = new PinSkillsService(new Map([["fix-bug", approved]]), new Map([["fix-bug", live]]));
    const env = await run(skills, { resolved_skills: [pinFor(approved)] });
    try {
      await env.execute();
      assertEquals(env.prompts.length, 1);
      assertStringIncludes(env.prompts[0], "Approved body A.");
      assertEquals(env.prompts[0].includes("Live body B."), false);
      const tools = env.prompts[0].match(/AVAILABLE TOOLS:\n([^\n]*)/)?.[1] ?? "";
      assertStringIncludes(tools, "read_file");
      assertEquals(tools.includes("list_directory"), false, "live tools never widen a pinned set");
      assertEquals(tools.includes("write_file"), false, "the pin's tools bound the role's tools");
      const payload = env.logger.events.find((e) => e.action === "agent.effort_resolved")?.payload as Record<
        string,
        JSONValue
      >;
      assertEquals(payload.effort, "high");
      assertEquals(skills.calls.matchCalls, 0, "a present vector never re-matches");
      assertEquals(skills.calls.submissions.map((s) => s.items.map((i) => i.matchSource)), [["plan_pinned"]]);
    } finally {
      env.cleanup();
    }
  },
});

Deno.test({
  name: "[selection] a pinned skill that declares no tools does not clear the agent role's permitted_tools",
  ...NOT_ALLOWED,
  async fn() {
    const noTools = skillFor("no-tools", "No tools declared.");
    const skills = new PinSkillsService(new Map([["no-tools", noTools]]), new Map());
    const env = await run(skills, { resolved_skills: [pinFor(noTools)] });
    try {
      await env.execute();
      const tools = env.prompts[0].match(/AVAILABLE TOOLS:\n([^\n]*)/)?.[1] ?? "";
      assertStringIncludes(tools, "read_file");
      assertStringIncludes(tools, "write_file");
      assertStringIncludes(tools, "list_directory");
    } finally {
      env.cleanup();
    }
  },
});

Deno.test({
  name: "[selection] an absent vector keeps dynamic matching and injects nothing",
  ...NOT_ALLOWED,
  async fn() {
    const skills = new PinSkillsService(new Map(), new Map());
    const env = await run(skills, {});
    try {
      await env.execute();
      assert(skills.calls.matchCalls > 0, "absent pins keep the dynamic path");
      assertEquals(skills.calls.resolved.length, 0);
      assertEquals(skills.calls.submissions.length, 0);
      assertEquals(env.prompts[0].includes("SKILLS"), false);
    } finally {
      env.cleanup();
    }
  },
});

Deno.test({
  name: "[selection] an empty vector disables matching, defaults and floors",
  ...NOT_ALLOWED,
  async fn() {
    const skills = new PinSkillsService(new Map(), new Map([["fix-bug", skillFor("fix-bug", "Live.")]]));
    const env = await run(skills, { resolved_skills: [] });
    try {
      await env.execute();
      assertEquals(skills.calls.matchCalls, 0);
      assertEquals(skills.calls.submissions.length, 0);
      const payload = env.logger.events.find((e) => e.action === "agent.effort_resolved")?.payload as Record<
        string,
        JSONValue
      >;
      assertEquals(payload.effort_basis, "unset");
    } finally {
      env.cleanup();
    }
  },
});

Deno.test({
  name: "[selection] an excluded pin keeps its metadata but renders no body and records no use",
  ...NOT_ALLOWED,
  async fn() {
    const skill = skillFor("fix-bug", "Excluded body.", { effort: "high" });
    const skills = new PinSkillsService(new Map([["fix-bug", skill]]), new Map());
    const env = await run(skills, { resolved_skills: [pinFor(skill, { content_included: false })] });
    try {
      await env.execute();
      assertEquals(env.prompts[0].includes("Excluded body."), false);
      assertEquals(skills.calls.submissions.length, 0);
      const payload = env.logger.events.find((e) => e.action === "agent.effort_resolved")?.payload as Record<
        string,
        JSONValue
      >;
      assertEquals(payload.effort, "high", "an excluded pin still raises the floor");
    } finally {
      env.cleanup();
    }
  },
});

Deno.test({
  name: "[selection] drift is reported once per pin and never changes the replay",
  ...NOT_ALLOWED,
  async fn() {
    const approved = skillFor("fix-bug", "Approved.");
    const edited = skillFor("fix-bug", "Edited.");
    const same = skillFor("other-skill", "Same.");
    const skills = new PinSkillsService(
      new Map([["fix-bug", approved], ["other-skill", same]]),
      new Map<string, ISkill | null>([["fix-bug", edited], ["other-skill", same], ["gone-skill", null]]),
    );
    const gone = skillFor("gone-skill", "Gone.");
    skills.pinned.set("gone-skill", gone);
    const env = await run(skills, { resolved_skills: [pinFor(approved), pinFor(same), pinFor(gone)] });
    try {
      await env.execute();
      const drift = env.logger.events.filter((e) => e.action === "skills.pin_drifted");
      assertEquals(drift.map((e) => (e.payload as Record<string, JSONValue>).name).sort(), ["fix-bug", "gone-skill"]);
      const gonePayload = drift.find((e) => (e.payload as Record<string, JSONValue>).name === "gone-skill")!
        .payload as Record<string, JSONValue>;
      assertEquals(gonePayload.current_revision_id, null);
      assertStringIncludes(env.prompts[0], "Approved.");
    } finally {
      env.cleanup();
    }
  },
});

Deno.test({
  name: "[security] a malformed vector or an unresolvable pin fails before any provider call",
  ...NOT_ALLOWED,
  async fn() {
    const skill = skillFor("fix-bug", "Body.");
    const malformed = await run(new PinSkillsService(new Map(), new Map()), { resolved_skills: [{ name: "x" }] });
    try {
      await assertRejects(() => malformed.execute());
      assertEquals(malformed.prompts.length, 0);
    } finally {
      malformed.cleanup();
    }

    const failing = new PinSkillsService(
      new Map([["fix-bug", skill]]),
      new Map(),
      new SkillUnavailableError("fix-bug"),
    );
    const env = await run(failing, { resolved_skills: [pinFor(skill)] });
    try {
      const error = await assertRejects(() => env.execute(), SkillUnavailableError);
      assertEquals(error.code, "skill_unavailable");
      assertEquals(env.prompts.length, 0);
      assertEquals(
        env.logger.events.some((e) => e.action === "plan.execution_failed"),
        true,
        "the failure is journaled as an execution failure",
      );
    } finally {
      env.cleanup();
    }
  },
});

Deno.test({
  name: "[security] pins with no skills service available fail closed",
  ...NOT_ALLOWED,
  async fn() {
    const skill = skillFor("fix-bug", "Body.");
    const env = await run(null, { resolved_skills: [pinFor(skill)] });
    try {
      const error = await assertRejects(() => env.execute(), SkillUnavailableError);
      assertEquals(error.code, "skill_unavailable");
      assertEquals(env.prompts.length, 0);
    } finally {
      env.cleanup();
    }
  },
});
