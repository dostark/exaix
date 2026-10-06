/**
 * @module SkillFolderLoaderTest
 * @path packages/core/tests/skills/skill_folder_loader_test.ts
 * @description Phase 206 Step 2 — the visible SkillFolderLoader over configured roots.
 *   Proves discovery of valid folders, safe diagnostics for invalid, legacy and masked
 *   entries, first-root masking (even by an inactive entry), reference and sidecar
 *   handling, resource caps, edit visibility on the next call, and real event emission.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/core/events, @exaix/core/logger, @exaix/testing]
 * @related-files [packages/core/src/skills/skill_folder_loader.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createPathSecurity } from "@exaix/tool-runtime";
import { initTestDbService } from "@exaix/testing";
import { DomainEventType, EventRegistry } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { IActivityRecord } from "@exaix/core/types";
import { SkillDiagnosticReason, SkillRootKind, SkillStatus } from "@exaix/core";
import {
  type IResolvedSkillRoot,
  type ISkillFolderLimits,
  type ISkillOperationContext,
  SkillFolderLoader,
} from "@exaix/core/skills";

const CTX: ISkillOperationContext = {
  portal: null,
  traceId: "22222222-2222-4222-8222-222222222222",
  requestId: null,
  flowId: null,
  flowStepId: null,
  agentRole: "senior-coder",
  configGeneration: "gen-1",
};

const CORPUS_SIZE = 27;

function skillMd(name: string, body = "Body text."): string {
  return `---\nname: ${name}\ndescription: Description of ${name}\n---\n# ${name}\n\n${body}\n`;
}

async function writeSkill(
  root: string,
  name: string,
  files: { md?: string; sidecar?: string; references?: Record<string, string> } = {},
): Promise<void> {
  const dir = join(root, name);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "SKILL.md"), files.md ?? skillMd(name));
  if (files.sidecar !== undefined) await Deno.writeTextFile(join(dir, "exaix.yaml"), files.sidecar);
  if (files.references) {
    await Deno.mkdir(join(dir, "references"), { recursive: true });
    for (const [file, content] of Object.entries(files.references)) {
      await Deno.writeTextFile(join(dir, "references", file), content);
    }
  }
}

interface IFixture {
  base: string;
  loader: (roots: IResolvedSkillRoot[], limits?: Partial<ISkillFolderLimits>) => SkillFolderLoader;
  events: (type: string) => Promise<IActivityRecord[]>;
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<IFixture> {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-skill-loader-" });
  const logger = new EventLogger({ db: env.db });
  const registry = new EventRegistry(logger);
  return {
    base,
    loader: (roots, limits) =>
      new SkillFolderLoader({
        roots,
        pathSecurity: createPathSecurity(),
        logger,
        eventRegistry: registry,
      }, limits),
    events: async (type) => {
      await env.db.waitForFlush();
      return await env.db.getActivitiesByActionTypeSafe(type);
    },
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

function root(path: string, kind = SkillRootKind.BLUEPRINT, writable = false): IResolvedSkillRoot {
  return { path, kind, writable, project: null };
}

Deno.test("[loader] discovers exactly the valid folders in a 27-skill corpus and diagnoses the rest", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    for (let i = 0; i < CORPUS_SIZE; i++) await writeSkill(dir, `skill-${String(i).padStart(2, "0")}`);
    await Deno.writeTextFile(join(dir, "README.md"), "# readme");
    await Deno.mkdir(join(dir, ".exa-skill-state"), { recursive: true });
    await writeSkill(dir, "Bad_Name");
    await writeSkill(dir, "bad-yaml", { md: "---\nname: [unterminated\n---\nbody\n" });
    await writeSkill(dir, "name-mismatch", { md: skillMd("other-name") });
    await Deno.writeTextFile(join(dir, "legacy.skill.md"), "flat");
    await Deno.writeTextFile(join(dir, "legacy.json"), "{}");
    await writeSkill(dir, "bad-sidecar", { sidecar: "unknown_key: 1\n" });

    const loader = fx.loader([root(dir)]);
    const listed = await loader.list(CTX);
    assertEquals(listed.length, CORPUS_SIZE);
    const diagnostics = await loader.diagnostics(CTX);
    const reasons = new Map(diagnostics.map((d) => [d.safe_path, d.reason]));
    assertEquals(reasons.get("Bad_Name"), SkillDiagnosticReason.INVALID_NAME);
    assertEquals(reasons.get("bad-yaml"), SkillDiagnosticReason.INVALID_FRONTMATTER);
    assertEquals(reasons.get("name-mismatch"), SkillDiagnosticReason.INVALID_FRONTMATTER);
    assertEquals(reasons.get("bad-sidecar"), SkillDiagnosticReason.INVALID_SIDECAR);
    assertEquals(reasons.get("legacy.skill.md"), SkillDiagnosticReason.LEGACY_LAYOUT);
    assertEquals(reasons.get("legacy.json"), SkillDiagnosticReason.LEGACY_LAYOUT);
    assertEquals(reasons.has("README.md"), false);
    assertEquals(reasons.has(".exa-skill-state"), false);
    for (const d of diagnostics) {
      assertEquals(d.safe_path.startsWith("/"), false, "diagnostics expose no host path");
      assertEquals(d.safe_path.includes(fx.base), false);
    }
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] get returns the loaded skill with revision, hash, root kind and relative path", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    await writeSkill(dir, "code-review", { sidecar: "title: Code Review\ncritical: true\n" });
    const loader = fx.loader([root(dir)]);
    const loaded = await loader.get("code-review", CTX);
    assertEquals(loaded?.skill.title, "Code Review");
    assertEquals(loaded?.rootKind, SkillRootKind.BLUEPRINT);
    assertEquals(loaded?.revisionId, loaded?.skill.id);
    assertEquals(loaded?.sourcePath, "code-review");
    assertEquals(await loader.get("missing-skill", CTX), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] the first root wins even when its entry is invalid or draft, with no fall-through", async () => {
  const fx = await fixture();
  try {
    const high = join(fx.base, "high");
    const low = join(fx.base, "low");
    await writeSkill(low, "shared-skill");
    await writeSkill(low, "other-skill");
    await writeSkill(high, "shared-skill", { sidecar: "status: draft\n" });
    await writeSkill(high, "other-skill", { md: "---\nname: [broken\n---\nx\n" });
    const loader = fx.loader([root(high), root(low, SkillRootKind.PROJECT)]);
    assertEquals(await loader.list(CTX), []);
    assertEquals(await loader.get("shared-skill", CTX), null);
    const reasons = (await loader.diagnostics(CTX)).map((d) => `${d.safe_path}:${d.reason}`);
    assertEquals(reasons.includes(`shared-skill:${SkillDiagnosticReason.INACTIVE}`), true);
    assertEquals(reasons.includes(`other-skill:${SkillDiagnosticReason.INVALID_FRONTMATTER}`), true);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] a draft learned skill defaults inactive while an explicit active sidecar is returned", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "learned");
    await writeSkill(dir, "draft-skill");
    await writeSkill(dir, "active-skill", { sidecar: "status: active\n" });
    const loader = fx.loader([root(dir, SkillRootKind.LEARNED)]);
    assertEquals((await loader.list(CTX)).map((s) => s.skill.name), ["active-skill"]);
    assertEquals((await loader.get("active-skill", CTX))?.skill.status, SkillStatus.ACTIVE);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] a missing root is a root_missing diagnostic, not a failure", async () => {
  const fx = await fixture();
  try {
    const loader = fx.loader([root(join(fx.base, "absent"))]);
    assertEquals(await loader.list(CTX), []);
    const [diagnostic] = await loader.diagnostics(CTX);
    assertEquals(diagnostic.reason, SkillDiagnosticReason.ROOT_MISSING);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] references are snapshotted and a linked missing reference invalidates the skill", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    await writeSkill(dir, "with-ref", {
      md: skillMd("with-ref", "See [guide](references/guide.md)."),
      references: { "guide.md": "Guide body\r\n", "extra.md": "unlinked" },
    });
    await writeSkill(dir, "missing-ref", { md: skillMd("missing-ref", "See [x](references/nope.md).") });
    const loader = fx.loader([root(dir)]);
    const loaded = await loader.get("with-ref", CTX);
    assertEquals(loaded?.snapshot.references.map((r) => r.path), ["references/extra.md", "references/guide.md"]);
    assertEquals(loaded?.skill.references?.find((r) => r.path === "references/guide.md")?.linked, true);
    assertEquals(loaded?.skill.references?.find((r) => r.path === "references/extra.md")?.linked, false);
    assertEquals(await loader.get("missing-ref", CTX), null);
    const diagnostic = (await loader.diagnostics(CTX)).find((d) => d.safe_path === "missing-ref");
    assertEquals(diagnostic?.reason, SkillDiagnosticReason.REFERENCE_MISSING);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] scripts, assets and non-markdown references make a skill invalid", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    await writeSkill(dir, "has-scripts");
    await Deno.mkdir(join(dir, "has-scripts", "scripts"));
    await writeSkill(dir, "has-assets");
    await Deno.mkdir(join(dir, "has-assets", "assets"));
    await writeSkill(dir, "bad-ref", { references: { "tool.sh": "echo" } });
    await writeSkill(dir, "nested-ref");
    await Deno.mkdir(join(dir, "nested-ref", "references", "deep"), { recursive: true });
    const loader = fx.loader([root(dir)]);
    assertEquals(await loader.list(CTX), []);
    const reasons = new Map((await loader.diagnostics(CTX)).map((d) => [d.safe_path, d.reason]));
    assertEquals(reasons.get("has-scripts"), SkillDiagnosticReason.EXECUTABLE_CONTENT);
    assertEquals(reasons.get("has-assets"), SkillDiagnosticReason.EXECUTABLE_CONTENT);
    assertEquals(reasons.get("bad-ref"), SkillDiagnosticReason.REFERENCE_INVALID);
    assertEquals(reasons.get("nested-ref"), SkillDiagnosticReason.REFERENCE_INVALID);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] resource caps invalidate an oversized skill with size_limit", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    await writeSkill(dir, "big-main", { md: skillMd("big-main", "x".repeat(2_000)) });
    await writeSkill(dir, "big-sidecar", { sidecar: `title: ${"y".repeat(500)}\n` });
    await writeSkill(dir, "big-reference", { references: { "a.md": "z".repeat(600) } });
    await writeSkill(dir, "many-references", { references: { "a.md": "1", "b.md": "2", "c.md": "3" } });
    await writeSkill(dir, "small-skill");
    const loader = fx.loader([root(dir)], {
      mainMaxBytes: 1_000,
      sidecarMaxBytes: 100,
      referenceMaxBytes: 500,
      referenceMaxCount: 2,
      referenceTotalMaxBytes: 1_000,
      snapshotMaxBytes: 5_000,
    });
    assertEquals((await loader.list(CTX)).map((s) => s.skill.name), ["small-skill"]);
    const reasons = new Map((await loader.diagnostics(CTX)).map((d) => [d.safe_path, d.reason]));
    for (const name of ["big-main", "big-sidecar", "big-reference", "many-references"]) {
      assertEquals(reasons.get(name), SkillDiagnosticReason.SIZE_LIMIT, name);
    }
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] NUL and invalid UTF-8 content invalidates the skill without reaching the parser", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    await writeSkill(dir, "nul-skill");
    await Deno.writeFile(join(dir, "nul-skill", "SKILL.md"), new Uint8Array([45, 45, 45, 10, 0, 10]));
    await writeSkill(dir, "utf8-skill");
    await Deno.writeFile(join(dir, "utf8-skill", "SKILL.md"), new Uint8Array([0xff, 0xfe, 0xfd]));
    const loader = fx.loader([root(dir)]);
    assertEquals(await loader.list(CTX), []);
    assertEquals((await loader.diagnostics(CTX)).length, 2);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] edits, including same-size preserved-mtime edits, are visible on the next call", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    await writeSkill(dir, "edit-me", { md: skillMd("edit-me", "AAAA") });
    const loader = fx.loader([root(dir)]);
    const before = await loader.get("edit-me", CTX);
    const path = join(dir, "edit-me", "SKILL.md");
    const stat = await Deno.stat(path);
    await Deno.writeTextFile(path, skillMd("edit-me", "BBBB"));
    await Deno.utime(path, stat.atime ?? new Date(), stat.mtime ?? new Date());
    const after = await loader.get("edit-me", CTX);
    assertEquals(before?.revisionId === after?.revisionId, false);
    assertStringIncludes(after?.skill.instructions ?? "", "BBBB");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader] a skill that becomes invalid disappears on the next call (no negative or stale cache)", async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.base, "blueprints");
    await writeSkill(dir, "flaky");
    const loader = fx.loader([root(dir)]);
    assertEquals((await loader.get("flaky", CTX))?.skill.name, "flaky");
    await Deno.writeTextFile(join(dir, "flaky", "SKILL.md"), "no frontmatter");
    assertEquals(await loader.get("flaky", CTX), null);
    await Deno.writeTextFile(join(dir, "flaky", "SKILL.md"), skillMd("flaky"));
    assertEquals((await loader.get("flaky", CTX))?.skill.name, "flaky");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[loader/events] load_failed and shadowed events carry safe identity and the operation trace", async () => {
  const fx = await fixture();
  try {
    const high = join(fx.base, "high");
    const low = join(fx.base, "low");
    await writeSkill(high, "shared-skill");
    await writeSkill(low, "shared-skill");
    await writeSkill(high, "broken", { md: "no frontmatter" });
    const loader = fx.loader([root(high), root(low, SkillRootKind.PROJECT)]);
    await loader.list(CTX);
    await loader.list(CTX);
    const failed = await fx.events(DomainEventType.SkillsLoadFailed);
    const shadowed = await fx.events(DomainEventType.SkillsShadowed);
    assertEquals(failed.length, 1, "emitted once per config generation");
    assertEquals(shadowed.length, 1, "emitted once per changed shadow set");
    assertEquals(failed[0].trace_id, CTX.traceId);
    const failedPayload = JSON.parse(failed[0].payload);
    assertEquals(failedPayload.reason, SkillDiagnosticReason.INVALID_FRONTMATTER);
    assertEquals(JSON.stringify(failedPayload).includes(fx.base), false);
    const shadowedPayload = JSON.parse(shadowed[0].payload);
    assertEquals(shadowedPayload.name, "shared-skill");
    assertEquals(shadowedPayload.winner_path, "shared-skill");
  } finally {
    await fx.cleanup();
  }
});
