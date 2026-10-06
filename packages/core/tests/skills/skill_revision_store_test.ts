/**
 * @module SkillRevisionStoreTest
 * @path packages/core/tests/skills/skill_revision_store_test.ts
 * @description Phase 206 Step 1 — content-addressed revision identity. Proves that
 *   canonical normalization replays identical digests across CRLF/LF, that an absent
 *   sidecar is framed distinctly from an empty one, that reference edits change the
 *   revision, that equal content in two roots shares one revision id while provenance
 *   stays per-resolution, and that the pure parser defaults status/triggers_source
 *   from the root kind.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/core]
 * @related-files [packages/core/src/skills/skill_snapshot.ts]
 */

import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import {
  canonicalizeSkillText,
  computeRevisionId,
  computeSkillContentSha256,
  type ISkillRevisionSnapshot,
  type ISkillRootContext,
  parseSkillSnapshot,
} from "@exaix/core/skills";
import { MemoryBankSource, MemoryScope, SkillRootKind, SkillStatus } from "@exaix/core";

const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function skillMd(body = "# Code Review\n\nReview systematically."): string {
  return [
    "---",
    "name: code-review",
    "description: Comprehensive checklist for thorough code reviews",
    "---",
    body,
    "",
  ].join("\n");
}

function snapshot(overrides: Partial<ISkillRevisionSnapshot> = {}): ISkillRevisionSnapshot {
  return {
    skill_md: skillMd(),
    exaix_yaml: null,
    references: [],
    ...overrides,
  };
}

function blueprintContext(overrides: Partial<ISkillRootContext> = {}): ISkillRootContext {
  return {
    rootKind: SkillRootKind.BLUEPRINT,
    name: "code-review",
    path: "Blueprints/Skills/code-review",
    project: null,
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    ...overrides,
  };
}

Deno.test("canonicalizeSkillText normalizes CRLF and removes exactly one terminal LF", () => {
  assertEquals(canonicalizeSkillText("a\r\nb\r\n"), "a\nb");
  assertEquals(canonicalizeSkillText("a\n\n"), "a\n");
  assertEquals(canonicalizeSkillText("a"), "a");
});

Deno.test("canonicalizeSkillText rejects NUL and lone CR", () => {
  assertThrows(() => canonicalizeSkillText("a\0b"));
  assertThrows(() => canonicalizeSkillText("a\rb"));
});

Deno.test("CRLF and LF snapshots replay one digest and revision id", async () => {
  const lf = snapshot();
  const crlf = snapshot({ skill_md: skillMd().replace(/\n/g, "\r\n") });
  assertEquals(await computeSkillContentSha256(lf), await computeSkillContentSha256(crlf));
  assertEquals(
    await computeRevisionId(await computeSkillContentSha256(lf)),
    await computeRevisionId(
      await computeSkillContentSha256(crlf),
    ),
  );
});

Deno.test("absent sidecar is framed distinctly from an empty sidecar", async () => {
  const absent = await computeSkillContentSha256(snapshot({ exaix_yaml: null }));
  const empty = await computeSkillContentSha256(snapshot({ exaix_yaml: "" }));
  assertNotEquals(absent, empty);
});

Deno.test("a reference edit changes the revision id", async () => {
  const base = snapshot({ references: [{ path: "references/extra.md", content: "one" }] });
  const edited = snapshot({ references: [{ path: "references/extra.md", content: "two" }] });
  assertNotEquals(await computeSkillContentSha256(base), await computeSkillContentSha256(edited));
});

Deno.test("equal content in two roots shares one revision but keeps per-root provenance", async () => {
  const first = await parseSkillSnapshot(snapshot(), blueprintContext());
  const second = await parseSkillSnapshot(
    snapshot(),
    blueprintContext({
      path: "Memory/Skills/project/Exaix/code-review",
      rootKind: SkillRootKind.PROJECT,
      project: "Exaix",
      scope: MemoryScope.PROJECT,
    }),
  );
  assertEquals(first.id, second.id);
  assertEquals(first.content_sha256, second.content_sha256);
  assertNotEquals(first.path, second.path);
  assertEquals(second.scope, MemoryScope.PROJECT);
  assertEquals(second.project, "Exaix");
});

Deno.test("parser defaults status active for blueprint and draft for learned", async () => {
  const active = await parseSkillSnapshot(snapshot(), blueprintContext());
  assertEquals(active.status, SkillStatus.ACTIVE);
  const draft = await parseSkillSnapshot(
    snapshot(),
    blueprintContext({
      rootKind: SkillRootKind.LEARNED,
      path: "Memory/Skills/learned/code-review",
      source: MemoryBankSource.LEARNED,
    }),
  );
  assertEquals(draft.status, SkillStatus.DRAFT);
  assertEquals(draft.source, MemoryBankSource.LEARNED);
});

Deno.test("parser title falls back to slug and triggers_source to description", async () => {
  const parsed = await parseSkillSnapshot(snapshot(), blueprintContext());
  assertEquals(parsed.title, "code-review");
  assertEquals(parsed.triggers_source, "description");
  assertEquals(parsed.id, await computeRevisionId(parsed.content_sha256));
  assertEquals(UUID_V5_PATTERN.test(parsed.id), true);
});

Deno.test("sidecar title, status and triggers are projected and marked authored", async () => {
  const parsed = await parseSkillSnapshot(
    snapshot({
      exaix_yaml: [
        "title: Code Review Checklist",
        "status: active",
        "triggers:",
        "  keywords: [review]",
      ].join("\n"),
    }),
    blueprintContext(),
  );
  assertEquals(parsed.title, "Code Review Checklist");
  assertEquals(parsed.triggers_source, "authored");
  assertEquals(parsed.triggers.keywords, ["review"]);
});

Deno.test("parser rejects a folder-name mismatch", async () => {
  await assertRejects(() => parseSkillSnapshot(snapshot(), blueprintContext({ name: "other" })));
});
