/**
 * @module PolicyConfigTest
 * @path packages/lint-policy/tests/policy_config_test.ts
 * @description The acyclic consumer descriptor, its script specs, and the real host commands.
 * @architectural-layer Test
 * @dependencies [@std/assert, @dostark/unslop-ts]
 * @related-files [packages/lint-policy/unslop.project.ts, packages/lint-policy/src/script_rules.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  compileConfig,
  ConfigError,
  DESCRIPTION_MAX_LENGTH,
  type ICompiledConfig,
  type IEditContext,
  type JsonValue,
  migrateCatalog,
  semanticCatalogProjection,
  semanticCompiledProjection,
  setOption,
  WHOLE_TREE_CHECKS,
} from "@dostark/unslop-ts";
import catalog from "./fixtures/catalog_v1.json" with { type: "json" };
import { descriptor } from "../unslop.project.ts";
import { POLICY_CATALOG, POLICY_COMPILED, POLICY_CONFIG } from "../src/policy_config.ts";
import { SCRIPT_RULES } from "../src/script_rules.ts";

const SCRIPT_IDS = [
  "module-header-tag",
  "edition-conditional-outside-composer",
  "edition-leak",
  "script-placement",
  "package-boundary",
  "package-related-files-boundary",
  "package-subpath-promotion",
  "package-testing-import",
  "package-canonical-import",
  "package-instantiates-event-logger",
  "package-concrete-logger-type",
  "package-uses-config-reader",
  "concrete-cross-domain",
  "layer-constant-leak",
] as const;

const HOST_TASKS: Readonly<Record<string, string>> = {
  "duplicate-type": "check:style",
  "duplicate-constant": "check:magic",
  "magic-literals": "check:magic",
  "constant-restatement": "check:constant-restatement",
  "unused-exports": "check:unused-exports",
  "optional-params": "check:optional-params",
};

function compiled(): ICompiledConfig {
  return compileConfig({ version: 2, plugin: descriptor.pluginName } as JsonValue, descriptor);
}

Deno.test("every_script_rule_has_metadata", () => {
  assertEquals(Object.keys(SCRIPT_RULES).sort(), [...SCRIPT_IDS].sort());
  const v1 = catalog.rules as Record<string, {
    engine?: string;
    severity?: string;
    tags?: string[];
    codeStyle?: string;
    limits?: string;
    options?: unknown;
  }>;
  for (const id of SCRIPT_IDS) {
    const spec = SCRIPT_RULES[id];
    const entry = v1[id];
    assert(entry, id);
    assertEquals(entry.engine, "script", id);
    assertEquals(spec.meta.preset, "recommended", id);
    assert(spec.meta.description.length <= DESCRIPTION_MAX_LENGTH, id);
    assertEquals(spec.meta.docs, entry.codeStyle, id);
    assertEquals(spec.meta.limits, entry.limits ?? null, id);
    assertEquals(spec.controls.hostModes.default, entry.severity, id);
    assertEquals(spec.command, ["deno", "task", "check:style"], id);
    if (id === "edition-leak") assert(spec.optionSchema);
    else assertEquals(spec.optionSchema, null, id);
  }
});

Deno.test("consumer_descriptor_loads_without_compiled_policy", async () => {
  assertEquals(Object.keys(descriptor.scriptRules).sort(), Object.keys(SCRIPT_RULES).sort());
  assertEquals(Object.keys(descriptor.wholeTreeHosts).sort(), Object.keys(WHOLE_TREE_CHECKS).sort());
  const model = compiled();
  for (const id of SCRIPT_IDS) assertEquals(model.rules[id].engine, "script", id);
  assertEquals(model.rules["duplicate-type"].command, ["deno", "task", "check:style"]);
  assertThrows(
    () => compileConfig({ version: 1, plugin: descriptor.pluginName } as JsonValue, descriptor),
    ConfigError,
  );

  for (
    const path of [
      "../unslop.project.ts",
      "../src/policy_config.ts",
      "../src/script_rules.ts",
      "../src/script_rule_schemas.ts",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(path, import.meta.url));
    assert(!text.includes("createLintPlugin"), path);
    assert(!/from\s+["'][^"']*check_code_style/.test(text), path);
    assert(!/from\s+["'][^"']*catalog\.json/.test(text), path);
    assert(!text.includes("Deno.env"), path);
  }
});

Deno.test("consumer_host_commands_match_all_six_task_definitions", async () => {
  const root = JSON.parse(await Deno.readTextFile(new URL("../../../deno.json", import.meta.url))) as {
    tasks: Record<string, string>;
  };
  for (const [id, task] of Object.entries(HOST_TASKS)) {
    const host = descriptor.wholeTreeHosts[id];
    assert(host, id);
    assertEquals(host.command, ["deno", "task", task], id);
    assertEquals(
      host.controls.hostModes.default,
      "default" in host.controls.hostModes ? host.controls.hostModes.default : undefined,
    );
    assert(typeof root.tasks[task] === "string", task);
  }
  const model = compiled();
  assertEquals(model.rules["duplicate-type"].command, ["deno", "task", "check:style"]);
  assertEquals(model.rules["duplicate-constant"].command, ["deno", "task", "check:magic"]);
  assertEquals(model.rules["magic-literals"].command, ["deno", "task", "check:magic"]);
});

function originalIds(v1: typeof catalog): string[] {
  const ids = Object.keys(v1.rules);
  const sections: ReadonlyArray<readonly [string, string]> = [
    ["constantRestatement", "constant-restatement"],
    ["unusedExports", "unused-exports"],
    ["optionalParams", "optional-params"],
  ];
  const wholeTree = v1.wholeTree as Record<string, unknown> | undefined;
  for (const [section, id] of sections) {
    if (wholeTree?.[section] !== undefined) ids.push(id);
  }
  return ids;
}

Deno.test("the_compiled_exaix_model_preserves_the_version_1_projection", async () => {
  const ids = originalIds(catalog);
  // The version 1 fixture predates wholeTree.unusedFiles and wholeTree.duplicateCode, so compare only its sections.
  const actual = semanticCompiledProjection(POLICY_COMPILED, descriptor, ids);
  delete (actual.wholeTree as Record<string, unknown>).unusedFiles;
  delete (actual.wholeTree as Record<string, unknown>).duplicateCode;
  assertEquals(actual, semanticCatalogProjection(catalog as JsonValue, descriptor, ids));
  const layout = JSON.parse(await Deno.readTextFile(new URL("../../../layout.json", import.meta.url)));
  assertEquals(layout, (catalog as { layout?: unknown }).layout);
  const configured = (POLICY_CONFIG as { rules: Record<string, { limits?: string }> }).rules;
  for (const [id, rule] of Object.entries(configured)) {
    if (typeof rule === "object" && rule.limits !== undefined) {
      assertEquals(POLICY_CATALOG.rules[id].limits, rule.limits, id);
    }
  }
  assertEquals(POLICY_CATALOG.rules["duplicate-type"].limits, configured["duplicate-type"].limits);
  assertEquals(POLICY_COMPILED.rules["exaix/barrel-only-reexports"].configuredLevel, "error");
});

Deno.test("pure_policy_import_has_no_plugin_side_effects", async () => {
  const policyUrl = new URL("../src/policy_config.ts", import.meta.url).href;
  const script =
    `import { POLICY_COMPILED } from "${policyUrl}"; console.log(POLICY_COMPILED.catalog.rules["duplicate-type"].engine);`;
  const command = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--allow-read", script],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  assertEquals(new TextDecoder().decode(result.stdout).trim(), "script");
});

Deno.test("consumer_limits_survive_migration_and_edit", () => {
  const ids = originalIds(catalog);
  const migrated = migrateCatalog(catalog as JsonValue, descriptor);
  const compiled = compileConfig(migrated.config, descriptor);
  assertEquals(
    semanticCompiledProjection(compiled, descriptor, ids),
    semanticCatalogProjection(catalog as JsonValue, descriptor, ids),
  );
  const configured = migrated.config as { rules: Record<string, { limits?: string }> };
  const limits = Object.values(configured.rules).filter((rule) =>
    typeof rule === "object" && rule.limits !== undefined
  );
  assert(limits.length > 0, "the migrated config keeps the rule limits");
  const context: IEditContext = { descriptor, compiled };
  const edited = setOption(migrated.config, context, "duplicate-constant", "namePattern", "^[A-Z][A-Z0-9_]*$");
  const editedRule = (edited as { rules: Record<string, { limits?: string }> }).rules["duplicate-constant"];
  assertEquals(
    editedRule.limits,
    "Compares top-level named constants with a static value; values from a call, identifier, or interpolation are out of scope.",
  );
});
