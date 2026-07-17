/**
 * @module SkillToolsDerivationTest
 * @path packages/execution/tests/skill_tools_derivation_test.ts
 * @description Verifies resolveEffectiveSkillTools: union of matched skills' tools,
 *   deduplicated, then intersected with the identity's permitted_tools — a skill can
 *   only narrow within what the identity already permits, never grant a tool the
 *   identity does not already allow.
 * @architectural-layer Execution
 */
import { assertEquals } from "@std/assert";
import { resolveEffectiveSkillTools } from "../src/skill_tools_derivation.ts";

Deno.test("[skill-tools] unions tools from two skills without duplication", () => {
  const result = resolveEffectiveSkillTools(
    [["read_file", "write_file"], ["write_file", "patch_file"]],
    undefined,
  );
  assertEquals(result.sort(), ["patch_file", "read_file", "write_file"]);
});

Deno.test("[skill-tools] unions tools from three or more skills without duplication", () => {
  const result = resolveEffectiveSkillTools(
    [["read_file"], ["read_file", "write_file"], ["grep_search"]],
    undefined,
  );
  assertEquals(result.sort(), ["grep_search", "read_file", "write_file"]);
});

Deno.test("[skill-tools] intersects the union with the identity's permitted_tools", () => {
  const result = resolveEffectiveSkillTools(
    [["read_file", "write_file"], ["delete_file"]],
    ["read_file", "grep_search"],
  );
  assertEquals(result, ["read_file"]);
});

Deno.test("[skill-tools] a skill cannot grant a tool the identity does not permit", () => {
  const result = resolveEffectiveSkillTools(
    [["delete_file", "run_command"]],
    ["read_file"],
  );
  assertEquals(result, []);
});

Deno.test("[skill-tools] empty permitted_tools array permits nothing, regardless of skill tools", () => {
  const result = resolveEffectiveSkillTools(
    [["read_file", "write_file"]],
    [],
  );
  assertEquals(result, []);
});

Deno.test("[skill-tools] undefined permitted_tools means no identity-level restriction — full union passes through", () => {
  const result = resolveEffectiveSkillTools(
    [["read_file"], ["write_file"]],
    undefined,
  );
  assertEquals(result.sort(), ["read_file", "write_file"]);
});

Deno.test("[skill-tools] skills with no tools declared contribute nothing to the union", () => {
  const result = resolveEffectiveSkillTools(
    [undefined, ["read_file"], []],
    undefined,
  );
  assertEquals(result, ["read_file"]);
});

Deno.test("[skill-tools] no matched skills at all returns an empty array", () => {
  const result = resolveEffectiveSkillTools([], ["read_file", "write_file"]);
  assertEquals(result, []);
});

Deno.test("[skill-tools] duplicate tool within a single skill's own list is not repeated", () => {
  const result = resolveEffectiveSkillTools(
    [["read_file", "read_file", "write_file"]],
    undefined,
  );
  assertEquals(result.sort(), ["read_file", "write_file"]);
});
