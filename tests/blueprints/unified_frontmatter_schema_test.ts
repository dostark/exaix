/**
 * @module UnifiedFrontmatterSchemaTest
 * @path tests/blueprints/unified_frontmatter_schema_test.ts
 * @description Phase 131 Step 2 — verifies the unified blueprint frontmatter
 *   schema and the finished TOML→YAML migration. Asserts: (1) all existing
 *   identities + examples parse under the unified schema; (2) GAP-1 field
 *   optionality (identity_id required; created/created_by optional-with-default
 *   at load); (3) session_delegate survives a load round-trip (was dropped by the
 *   runtime fork); (4) GAP-2 unknown fields WARN (not reject) and legacy runtime
 *   fields stay accepted; (5) the loader no longer throws on / writes TOML.
 * @architectural-layer Schema (test)
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [packages/schemas/src/blueprint.ts, packages/core/src/blueprint/blueprint_loader.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join, resolve } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { ensureDir } from "@std/fs";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";
import {
  BlueprintLoader,
  type IUnknownFieldWarning,
  RuntimeBlueprintFrontmatterSchema,
  validateRuntimeFrontmatter,
} from "@exaix/core/blueprint/blueprint_loader.ts";

const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
const IDENTITIES_DIR = join(REPO_ROOT, "Blueprints", "Identities");

/** YAML-parsed frontmatter — validated by the schema, so structurally permissive. */
interface IParsedFrontmatter {
  [key: string]: string | number | boolean | null | IParsedFrontmatter | Array<string | IParsedFrontmatter>;
}

/** Extracts the YAML frontmatter object from a `--- ... ---` blueprint file. */
function parseFrontmatter(content: string): IParsedFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYaml(match[1]) as IParsedFrontmatter;
}

Deno.test("[step2] unified schema accepts every active identity (pre-strict)", async () => {
  const files: string[] = [];
  for await (const e of Deno.readDir(IDENTITIES_DIR)) {
    if (e.isFile && e.name.endsWith(".md") && e.name !== "README.md") files.push(join(IDENTITIES_DIR, e.name));
  }
  assert(files.length >= 14, `expected the full identity catalog, found ${files.length}`);

  for (const file of files) {
    const content = await Deno.readTextFile(file);
    const fm = parseFrontmatter(content);
    assertExists(fm, `${file} must have YAML frontmatter`);
    const parsed = RuntimeBlueprintFrontmatterSchema.safeParse(fm);
    assert(
      parsed.success,
      `${file} must parse under the unified runtime schema: ${
        parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      }`,
    );
  }
});

Deno.test("[step2][GAP-1] identity_id required; created/created_by optional-with-default at load", () => {
  // Missing created/created_by must still load (loader tolerates legacy/minimal).
  const minimal = RuntimeBlueprintFrontmatterSchema.safeParse({
    identity_id: "x",
    name: "X",
    model: "mock:test-model",
  });
  assert(minimal.success, "blueprint without created/created_by must load");

  // identity_id is the one required identity field on the authoring (CLI) schema.
  const noId = BlueprintFrontmatterSchema.safeParse({
    name: "X",
    model: "mock:test-model",
    created: "2026-01-01T00:00:00.000Z",
    created_by: "tester",
  });
  assertEquals(noId.success, false, "CLI schema must require identity_id");
});

Deno.test("[step2] session_delegate survives a runtime load round-trip (was dropped by the fork)", () => {
  const fm = {
    identity_id: "dogfood-developer",
    name: "Dogfooding Engineer",
    model: "openrouter:deepseek/deepseek-chat",
    session_delegate: { enabled: true, tool: "opencode", gates: ["code_changes"], launch_mode: "headless" },
  };
  const parsed = RuntimeBlueprintFrontmatterSchema.safeParse(fm);
  assert(parsed.success, `must parse: ${parsed.success ? "" : parsed.error.message}`);
  assertExists(parsed.data!.session_delegate, "session_delegate must survive the runtime schema (W4)");
  assertEquals(parsed.data!.session_delegate.enabled, true);
});

Deno.test("[step2][integration] a CLI-format YAML blueprint round-trips through BlueprintLoader (no TOML)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "step2_roundtrip_" });
  try {
    const identitiesDir = join(dir, "Identities");
    await ensureDir(identitiesDir);
    // Mirror the CLI writer format: `---\n<yaml>---\n\n<body>` (Phase 131 Step 2).
    const fm = {
      identity_id: "round-trip-agent",
      name: "Round Trip Agent",
      model: "mock:test-model",
      capabilities: ["testing"],
      created: "2026-01-01T00:00:00.000Z",
      created_by: "tester",
      version: "1.0.0",
      session_delegate: { enabled: true, tool: "opencode", gates: ["code_changes"], launch_mode: "headless" },
    };
    const content = `---\n${stringifyYaml(fm)}---\n\n# Round Trip Agent\n\nBody.\n`;
    await Deno.writeTextFile(join(identitiesDir, "round-trip-agent.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath: identitiesDir });
    const loaded = await loader.load("round-trip-agent");
    assertExists(loaded, "CLI-format YAML blueprint must load");
    assertEquals(loaded!.identityId, "round-trip-agent");
    assertEquals(loaded!.model, "mock:test-model");
    assertExists(loaded!.frontmatter.session_delegate, "session_delegate must survive the round-trip (W4)");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[step2] the loader rejects retired TOML (+++) frontmatter with an actionable error", async () => {
  const dir = await Deno.makeTempDir({ prefix: "step2_toml_" });
  try {
    const identitiesDir = join(dir, "Identities");
    await ensureDir(identitiesDir);
    await Deno.writeTextFile(
      join(identitiesDir, "legacy-toml.md"),
      `+++\nidentity_id = "legacy-toml"\nname = "Legacy"\nmodel = "mock:test-model"\n+++\n\nBody.\n`,
    );
    const loader = new BlueprintLoader({ blueprintsPath: identitiesDir });
    let threw = false;
    try {
      await loader.load("legacy-toml");
    } catch (e) {
      threw = true;
      assert(
        (e instanceof Error ? e.message : String(e)).includes("TOML"),
        "error must name the retired TOML format",
      );
    }
    assert(threw, "loader must reject +++ TOML frontmatter (migration finished)");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[step2][GAP-2] unknown fields WARN (not reject); legacy runtime fields stay accepted", () => {
  // A genuinely unknown field is reported as a warning, not a hard rejection.
  const withUnknown = validateRuntimeFrontmatter({
    identity_id: "x",
    name: "X",
    model: "mock:test-model",
    totally_unknown_field: 42,
  });
  assert(withUnknown.ok, "unknown field must not reject in Step 2 (warn path)");
  const warnings: IUnknownFieldWarning[] = withUnknown.warnings;
  assert(
    warnings.some((w) => w.field === "totally_unknown_field"),
    "unknown field must be surfaced as a warning",
  );

  // Legacy runtime-only fields (provider/reflexive/memory_enabled) remain known.
  const legacy = validateRuntimeFrontmatter({
    identity_id: "x",
    name: "X",
    model: "mock:test-model",
    provider: "anthropic",
    reflexive: true,
    memory_enabled: true,
  });
  assert(legacy.ok, "legacy runtime fields must remain accepted");
  assertEquals(legacy.warnings.length, 0, "legacy fields must NOT be flagged as unknown");
});
