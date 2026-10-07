/**
 * @module SkillsServiceRootsTest
 * @path packages/core/tests/skills/skills_service_roots_test.ts
 * @description Verifies that `SkillsService` selects its roots from the current validated config at
 *   each operation. Defaults follow the configured paths, explicit roots set the precedence, an empty
 *   list disables the catalog and a reload applies to the next operation while an operation that
 *   started earlier keeps its own generation. Project roots need a configured portal, relative roots
 *   cannot leave the system root, absolute operator roots are admitted, and resource caps come from config.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/schemas, @exaix/testing]
 * @related-files [packages/core/src/skills/skills.ts, packages/schemas/src/config.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { type Config, ConfigSchema } from "@exaix/schemas";
import {
  ExaPathDefaults,
  SkillDiagnosticReason,
  SkillMutationErrorCode,
  SkillRootKind,
  SkillStatus,
} from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { createSkillOperationContext, SkillMutationError, SkillsService } from "@exaix/core/skills";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";

const ACTIVE = { status: SkillStatus.ACTIVE };

interface ISkillsConfigInput {
  roots?: Array<{ kind: SkillRootKind; path: string }>;
  main_max_bytes?: number;
  match_threshold?: number;
  keyword_match_saturation?: number;
  fallback_min_word_chars?: number;
  fallback_max_keywords?: number;
}

/** A config provider whose generation moves only when `set` installs a new valid config. */
class FakeConfig {
  private config: Config;
  private generation = 1;
  constructor(private readonly root: string, private readonly portals: string[], skills: ISkillsConfigInput = {}) {
    this.config = this.build(skills);
  }
  private build(skills: ISkillsConfigInput): Config {
    return ConfigSchema.parse({
      system: { root: this.root },
      paths: { ...ExaPathDefaults },
      portals: this.portals.map((alias) => ({ alias, target_path: this.root })),
      skills,
    });
  }
  get(): Config {
    return this.config;
  }
  getChecksum(): string {
    return `generation-${this.generation}`;
  }
  set(skills: ISkillsConfigInput): void {
    this.config = this.build(skills);
    this.generation += 1;
  }
}

async function fixture(skills: ISkillsConfigInput = {}, portals: string[] = ["Alpha", "Beta"]) {
  const env = await initTestDbService();
  const root = await Deno.makeTempDir({ prefix: "exa-skills-roots-" });
  const provider = new FakeConfig(root, portals, skills);
  const service = new SkillsService({ configProvider: provider }, env.db, undefined, new EventLogger({ db: env.db }));
  const ctx = (portal: string | null = null) =>
    createSkillOperationContext({
      agentRole: "test",
      portal,
      traceId: crypto.randomUUID(),
      configGeneration: service.currentConfigGeneration(),
    });
  return {
    root,
    provider,
    service,
    ctx,
    dir: (...parts: string[]) => join(root, ...parts),
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(root, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("[roots] defaults follow the configured paths and a project root needs a configured portal", async () => {
  const fx = await fixture();
  try {
    await writeSkillFolder(fx.dir(ExaPathDefaults.blueprints, "Skills"), { name: "shared", instructions: "Shared." });
    await writeSkillFolder(fx.dir(ExaPathDefaults.memorySkills, "learned"), {
      name: "learned-one",
      instructions: "Learned.",
      sidecar: ACTIVE,
    });
    await writeSkillFolder(fx.dir(ExaPathDefaults.memorySkills, "project", "Alpha"), {
      name: "alpha-only",
      instructions: "Alpha.",
      sidecar: ACTIVE,
    });
    assertEquals((await fx.service.getSkill("shared", fx.ctx()))?.root_kind, SkillRootKind.BLUEPRINT);
    assertEquals((await fx.service.getSkill("learned-one", fx.ctx()))?.root_kind, SkillRootKind.LEARNED);
    assertEquals((await fx.service.getSkill("alpha-only", fx.ctx("Alpha")))?.project, "Alpha");
    assertEquals(await fx.service.getSkill("alpha-only", fx.ctx("Beta")), null, "no cross-portal leakage");
    assertEquals(await fx.service.getSkill("alpha-only", fx.ctx()), null, "global-only reads see no project root");
    assertEquals(
      await fx.service.getSkill("alpha-only", fx.ctx("Stranger")),
      null,
      "an unconfigured portal is global-only",
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[roots] explicit roots set the precedence and a reload applies to the next operation only", async () => {
  const first = "first-root";
  const second = "second-root";
  const fx = await fixture({
    roots: [{ kind: SkillRootKind.DOGFOOD, path: first }, { kind: SkillRootKind.BLUEPRINT, path: second }],
  });
  try {
    await writeSkillFolder(fx.dir(first), { name: "dup", instructions: "From first." });
    await writeSkillFolder(fx.dir(second), { name: "dup", instructions: "From second." });
    const before = fx.ctx();
    assertEquals((await fx.service.getSkill("dup", before))?.instructions, "From first.");

    fx.provider.set({
      roots: [{ kind: SkillRootKind.BLUEPRINT, path: second }, { kind: SkillRootKind.DOGFOOD, path: first }],
    });
    assertEquals((await fx.service.getSkill("dup", fx.ctx()))?.instructions, "From second.");
    assertEquals(
      (await fx.service.getSkill("dup", before))?.instructions,
      "From first.",
      "an operation that started earlier keeps its own generation",
    );
    assert(fx.service.currentConfigGeneration() !== before.configGeneration);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[roots] an empty roots list disables the catalog and removal and reappearance apply next operation", async () => {
  const fx = await fixture({ roots: [{ kind: SkillRootKind.BLUEPRINT, path: "catalog" }] });
  try {
    await writeSkillFolder(fx.dir("catalog"), { name: "present", instructions: "Here." });
    assertEquals((await fx.service.getSkill("present", fx.ctx()))?.name, "present");
    fx.provider.set({ roots: [] });
    assertEquals(await fx.service.getSkill("present", fx.ctx()), null);
    assertEquals((await fx.service.listSkills(undefined, fx.ctx())).length, 0);
    fx.provider.set({ roots: [{ kind: SkillRootKind.BLUEPRINT, path: "catalog" }] });
    assertEquals((await fx.service.getSkill("present", fx.ctx()))?.name, "present");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[roots] a missing root is diagnosed and found again once it exists", async () => {
  const fx = await fixture({ roots: [{ kind: SkillRootKind.BLUEPRINT, path: "late-root" }] });
  try {
    const missing = await fx.service.listDiagnostics(fx.ctx());
    assert(missing.some((d) => d.reason === SkillDiagnosticReason.ROOT_MISSING));
    await writeSkillFolder(fx.dir("late-root"), { name: "arrives", instructions: "Late." });
    assertEquals((await fx.service.getSkill("arrives", fx.ctx()))?.name, "arrives");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[roots][security] a relative root cannot leave the system root and an absolute operator root is admitted", async () => {
  const external = await Deno.makeTempDir({ prefix: "exa-external-skills-" });
  const fx = await fixture({
    roots: [
      { kind: SkillRootKind.DOGFOOD, path: "../escape" },
      { kind: SkillRootKind.DOGFOOD, path: external },
      { kind: SkillRootKind.BLUEPRINT, path: "catalog" },
    ],
  });
  try {
    await writeSkillFolder(external, { name: "from-worktree", instructions: "External." });
    await writeSkillFolder(fx.dir("..", "escape"), { name: "escaped", instructions: "Escaped." }).catch(() => {});
    assertEquals((await fx.service.getSkill("from-worktree", fx.ctx()))?.root_kind, SkillRootKind.DOGFOOD);
    assertEquals(await fx.service.getSkill("escaped", fx.ctx()), null);
    const diagnostics = await fx.service.listDiagnostics(fx.ctx());
    assert(diagnostics.some((d) => d.reason === SkillDiagnosticReason.PATH_ESCAPE));
    assertEquals(JSON.stringify(diagnostics).includes(fx.root), false, "diagnostics carry no host paths");
  } finally {
    await Deno.remove(external, { recursive: true }).catch(() => {});
    await Deno.remove(fx.dir("..", "escape"), { recursive: true }).catch(() => {});
    await fx.cleanup();
  }
});

Deno.test("[roots] resource caps come from the current config", async () => {
  const fx = await fixture({ roots: [{ kind: SkillRootKind.BLUEPRINT, path: "catalog" }] });
  try {
    await writeSkillFolder(fx.dir("catalog"), { name: "big-one", instructions: "x".repeat(3000) });
    assertEquals((await fx.service.getSkill("big-one", fx.ctx()))?.name, "big-one");
    fx.provider.set({ roots: [{ kind: SkillRootKind.BLUEPRINT, path: "catalog" }], main_max_bytes: 1024 });
    assertEquals(await fx.service.getSkill("big-one", fx.ctx()), null);
    const diagnostics = await fx.service.listDiagnostics(fx.ctx());
    assert(diagnostics.some((d) => d.reason === SkillDiagnosticReason.SIZE_LIMIT));
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[roots] concurrent portals read and create their own project skills without leaking", async () => {
  const fx = await fixture();
  try {
    const projectBase = fx.dir(ExaPathDefaults.memorySkills, "project");
    await writeSkillFolder(join(projectBase, "Alpha"), { name: "twin", instructions: "Alpha twin.", sidecar: ACTIVE });
    await writeSkillFolder(join(projectBase, "Beta"), { name: "twin", instructions: "Beta twin.", sidecar: ACTIVE });
    const reads = await Promise.all(
      Array.from({ length: 8 }, (_, index) => fx.service.getSkill("twin", fx.ctx(index % 2 === 0 ? "Alpha" : "Beta"))),
    );
    assertEquals(
      reads.map((skill) => skill?.instructions),
      Array.from({ length: 8 }, (_, i) => i % 2 === 0 ? "Alpha twin." : "Beta twin."),
    );

    const [a, b] = await Promise.all([
      fx.service.createSkill(
        { name: "made-alpha", description: "d", instructions: "Alpha made." },
        fx.ctx("Alpha"),
      ),
      fx.service.createSkill(
        { name: "made-beta", description: "d", instructions: "Beta made." },
        fx.ctx("Beta"),
      ),
    ]);
    assertEquals([a.project, b.project], ["Alpha", "Beta"]);
    assertEquals(await fx.service.getSkill("made-alpha", fx.ctx("Beta")), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[roots] with the catalog disabled a create has no writable root and fails closed", async () => {
  const fx = await fixture({ roots: [{ kind: SkillRootKind.BLUEPRINT, path: "catalog" }] });
  try {
    const error = await assertRejects(
      () => fx.service.createSkill({ name: "nowhere", description: "d", instructions: "No root." }, fx.ctx()),
      SkillMutationError,
    );
    assertEquals(error.code, SkillMutationErrorCode.ROOT_UNAVAILABLE);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[roots] a service without a config provider reports the static generation", async () => {
  const env = await initTestDbService();
  try {
    const service = new SkillsService({ memoryDir: await Deno.makeTempDir() }, env.db);
    assertEquals(service.currentConfigGeneration(), "static");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[roots] matching and fallback settings come from the current config and apply to the next operation", async () => {
  const fx = await fixture({ roots: [{ kind: SkillRootKind.BLUEPRINT, path: "shared" }] });
  try {
    await writeSkillFolder(fx.dir("shared"), {
      name: "changelog-writer",
      description: "Compose changelog entries from merged commits",
      instructions: "Write entries.",
    });
    const request = { requestText: "changelog" };
    const names = async () => (await fx.service.matchSkills(request, fx.ctx())).matches.map((m) => m.skillId);
    assertEquals(await names(), [], "the default threshold refuses a weak text-only match");

    fx.provider.set({
      roots: [{ kind: SkillRootKind.BLUEPRINT, path: "shared" }],
      match_threshold: 0.1,
    });
    assertEquals(await names(), ["changelog-writer"], "the operator threshold applies at the next operation");

    fx.provider.set({
      roots: [{ kind: SkillRootKind.BLUEPRINT, path: "shared" }],
      match_threshold: 0.1,
      fallback_max_keywords: 1,
    });
    const capped = await fx.service.matchSkills({ requestText: "commits" }, fx.ctx());
    assertEquals(
      capped.matches.length,
      0,
      "a one-keyword cap keeps only the first name word, so a description word no longer matches",
    );
  } finally {
    await fx.cleanup();
  }
});
