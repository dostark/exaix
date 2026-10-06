/**
 * @module SkillFolderSecurityTest
 * @path packages/core/tests/skills/skill_folder_security_test.ts
 * @description Phase 206 Step 1 — rejection-by-validation tests for the pure parser.
 *   Rejects NUL and lone CR bytes, normalizes CRLF to LF, and preserves multibyte
 *   content so a digest never depends on host line endings.
 * @architectural-layer Security
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/tool-runtime, @exaix/testing]
 * @related-files [packages/core/src/skills/skill_snapshot.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalizeSkillText,
  computeSkillContentSha256,
  type ISkillOperationContext,
  type ISkillRevisionSnapshot,
  SkillFolderLoader,
} from "@exaix/core/skills";
import { join } from "@std/path";
import { createPathSecurity } from "@exaix/tool-runtime";
import { initTestDbService } from "@exaix/testing";
import { EventRegistry } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { SkillDiagnosticReason, SkillRootKind } from "@exaix/core";

function snapshot(skillMd: string): ISkillRevisionSnapshot {
  return { skill_md: skillMd, exaix_yaml: null, references: [] };
}

Deno.test("[security] parser rejects a NUL byte", () => {
  assertThrows(() => canonicalizeSkillText("a\0b"));
});

Deno.test("[security] parser rejects a lone CR byte", () => {
  assertThrows(() => canonicalizeSkillText("a\rb"));
});

Deno.test("[security] parser normalizes CRLF to LF", () => {
  assertEquals(canonicalizeSkillText("a\r\nb\r\n"), "a\nb");
});

Deno.test("[security] multibyte content survives canonicalization and hashes stably", async () => {
  const text = "---\nname: code-review\ndescription: コードレビュー ✓\n---\n本文 🔒\n";
  assertEquals(canonicalizeSkillText(text).includes("🔒"), true);
  assertEquals(canonicalizeSkillText(text).includes("コードレビュー"), true);
  const lf = await computeSkillContentSha256(snapshot(text));
  const crlf = await computeSkillContentSha256(snapshot(text.replace(/\n/g, "\r\n")));
  assertEquals(lf, crlf);
});

// ---------------------------------------------------------------------------
// Phase 206 Step 2 — physical confinement in the loader.
// ---------------------------------------------------------------------------

const SEC_CTX: ISkillOperationContext = {
  portal: null,
  traceId: "33333333-3333-4333-8333-333333333333",
  requestId: null,
  flowId: null,
  flowStepId: null,
  agentRole: "senior-coder",
  configGeneration: "gen-1",
};

const VALID_MD = "---\nname: target-skill\ndescription: A target skill\n---\nBody.\n";

async function secLoader(roots: string[]) {
  const env = await initTestDbService();
  const logger = new EventLogger({ db: env.db });
  const loader = new SkillFolderLoader({
    roots: roots.map((path) => ({ path, kind: SkillRootKind.BLUEPRINT, writable: false, project: null })),
    pathSecurity: createPathSecurity(),
    logger,
    eventRegistry: new EventRegistry(logger),
  });
  return { loader, cleanup: env.cleanup };
}

async function reasonFor(loader: SkillFolderLoader, safePath: string): Promise<SkillDiagnosticReason | undefined> {
  return (await loader.diagnostics(SEC_CTX)).find((d) => d.safe_path === safePath)?.reason;
}

Deno.test("[security] a symlinked skill folder is rejected and never read", async () => {
  const base = await Deno.makeTempDir({ prefix: "exa-skill-sec-" });
  const sec = await secLoader([join(base, "root")]);
  try {
    await Deno.mkdir(join(base, "outside", "target-skill"), { recursive: true });
    await Deno.writeTextFile(join(base, "outside", "target-skill", "SKILL.md"), VALID_MD);
    await Deno.mkdir(join(base, "root"));
    await Deno.symlink(join(base, "outside", "target-skill"), join(base, "root", "target-skill"));
    assertEquals(await sec.loader.list(SEC_CTX), []);
    assertEquals(await reasonFor(sec.loader, "target-skill"), SkillDiagnosticReason.SYMLINK);
  } finally {
    await sec.cleanup();
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("[security] a symlinked SKILL.md, sidecar, references directory or reference is rejected", async () => {
  const base = await Deno.makeTempDir({ prefix: "exa-skill-sec-" });
  const sec = await secLoader([join(base, "root")]);
  try {
    await Deno.writeTextFile(join(base, "secret.txt"), "---\nname: x\ndescription: y\n---\nsecret");
    await Deno.mkdir(join(base, "refs-outside"));
    await Deno.writeTextFile(join(base, "refs-outside", "a.md"), "outside");
    const cases: Record<string, (dir: string) => Promise<void>> = {
      "link-md": async (dir) => {
        await Deno.symlink(join(base, "secret.txt"), join(dir, "SKILL.md"));
      },
      "link-sidecar": async (dir) => {
        await Deno.writeTextFile(join(dir, "SKILL.md"), VALID_MD.replace("target-skill", "link-sidecar"));
        await Deno.symlink(join(base, "secret.txt"), join(dir, "exaix.yaml"));
      },
      "link-refs-dir": async (dir) => {
        await Deno.writeTextFile(join(dir, "SKILL.md"), VALID_MD.replace("target-skill", "link-refs-dir"));
        await Deno.symlink(join(base, "refs-outside"), join(dir, "references"));
      },
      "link-ref-file": async (dir) => {
        await Deno.writeTextFile(join(dir, "SKILL.md"), VALID_MD.replace("target-skill", "link-ref-file"));
        await Deno.mkdir(join(dir, "references"));
        await Deno.symlink(join(base, "secret.txt"), join(dir, "references", "a.md"));
      },
    };
    for (const [name, build] of Object.entries(cases)) {
      const dir = join(base, "root", name);
      await Deno.mkdir(dir, { recursive: true });
      await build(dir);
    }
    assertEquals(await sec.loader.list(SEC_CTX), []);
    for (const name of Object.keys(cases)) {
      assertEquals(await reasonFor(sec.loader, name), SkillDiagnosticReason.SYMLINK, name);
    }
  } finally {
    await sec.cleanup();
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("[security] a sibling-prefix directory is not part of the admitted root", async () => {
  const base = await Deno.makeTempDir({ prefix: "exa-skill-sec-" });
  const sec = await secLoader([join(base, "root")]);
  try {
    await Deno.mkdir(join(base, "root", "safe-skill"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "root", "safe-skill", "SKILL.md"),
      VALID_MD.replace("target-skill", "safe-skill"),
    );
    await Deno.mkdir(join(base, "root-evil", "target-skill"), { recursive: true });
    await Deno.writeTextFile(join(base, "root-evil", "target-skill", "SKILL.md"), VALID_MD);
    assertEquals((await sec.loader.list(SEC_CTX)).map((s) => s.skill.name), ["safe-skill"]);
    assertEquals(await sec.loader.get("target-skill", SEC_CTX), null);
  } finally {
    await sec.cleanup();
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("[security] a root that is itself a symlink resolving outside is admitted only by its real path", async () => {
  const base = await Deno.makeTempDir({ prefix: "exa-skill-sec-" });
  const sec = await secLoader([join(base, "linked-root")]);
  try {
    await Deno.mkdir(join(base, "real-root", "target-skill"), { recursive: true });
    await Deno.writeTextFile(join(base, "real-root", "target-skill", "SKILL.md"), VALID_MD);
    await Deno.symlink(join(base, "real-root"), join(base, "linked-root"));
    assertEquals((await sec.loader.list(SEC_CTX)).map((s) => s.skill.name), ["target-skill"]);
  } finally {
    await sec.cleanup();
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("[security] a skill folder swapped for a symlink between calls is rejected on the next read", async () => {
  const base = await Deno.makeTempDir({ prefix: "exa-skill-sec-" });
  const sec = await secLoader([join(base, "root")]);
  try {
    await Deno.mkdir(join(base, "root", "target-skill"), { recursive: true });
    await Deno.writeTextFile(join(base, "root", "target-skill", "SKILL.md"), VALID_MD);
    assertEquals((await sec.loader.get("target-skill", SEC_CTX))?.skill.name, "target-skill");
    await Deno.mkdir(join(base, "outside", "target-skill"), { recursive: true });
    await Deno.writeTextFile(join(base, "outside", "target-skill", "SKILL.md"), VALID_MD);
    await Deno.remove(join(base, "root", "target-skill"), { recursive: true });
    await Deno.symlink(join(base, "outside", "target-skill"), join(base, "root", "target-skill"));
    assertEquals(await sec.loader.get("target-skill", SEC_CTX), null);
    assertEquals(await reasonFor(sec.loader, "target-skill"), SkillDiagnosticReason.SYMLINK);
  } finally {
    await sec.cleanup();
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("[security] an oversized file is rejected by the pre-read size check before its bytes are decoded", async () => {
  const base = await Deno.makeTempDir({ prefix: "exa-skill-sec-" });
  const sec = await secLoader([join(base, "root")]);
  try {
    await Deno.mkdir(join(base, "root", "target-skill"), { recursive: true });
    await Deno.writeTextFile(join(base, "root", "target-skill", "SKILL.md"), VALID_MD + "é".repeat(400_000));
    assertEquals(await sec.loader.list(SEC_CTX), []);
    assertEquals(await reasonFor(sec.loader, "target-skill"), SkillDiagnosticReason.SIZE_LIMIT);
  } finally {
    await sec.cleanup();
    await Deno.remove(base, { recursive: true });
  }
});
