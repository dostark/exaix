/**
 * @module PolicyConfigTest
 * @path packages/lint-policy/tests/policy_config_test.ts
 * @description The acyclic consumer descriptor, its fourteen script specs, and the six real host commands.
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
  type JsonValue,
} from "@dostark/unslop-ts";
import catalog from "./fixtures/catalog_v1.json" with { type: "json" };
import { descriptor } from "../unslop.project.ts";
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
  assertEquals(Object.keys(descriptor.scriptRules).length, 14);
  assertEquals(Object.keys(descriptor.wholeTreeHosts).length, 6);
  const model = compiled();
  for (const id of SCRIPT_IDS) assertEquals(model.rules[id].engine, "script", id);
  assertEquals(model.rules["duplicate-type"].command, ["deno", "task", "check:style"]);
  assertThrows(
    () => compileConfig({ version: 1, plugin: descriptor.pluginName } as JsonValue, descriptor),
    ConfigError,
  );

  for (const path of ["../unslop.project.ts", "../src/script_rules.ts", "../src/script_rule_schemas.ts"]) {
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
