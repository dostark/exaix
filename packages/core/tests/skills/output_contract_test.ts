/**
 * @module OutputContractTest
 * @path packages/core/tests/skills/output_contract_test.ts
 * @description Verifies that an output contract names exactly one contract skill and that the default skill list adds it once.
 * @architectural-layer Core
 * @related-files [packages/core/src/skills/output_contract.ts]
 */

import { assertEquals, assertMatch } from "@std/assert";
import { OutputContract } from "@exaix/core";
import { OUTPUT_CONTRACT_SKILL, resolveDefaultSkillIds } from "@exaix/core/skills";

Deno.test("fix(skills): every output contract names one distinct contract skill", () => {
  const skills = Object.values(OutputContract).map((contract) => OUTPUT_CONTRACT_SKILL[contract]);
  assertEquals(new Set(skills).size, skills.length);
  for (const skill of skills) assertMatch(skill, /^response-contract/);
});

Deno.test("fix(skills): the plan contract is the generic response contract", () => {
  assertEquals(OUTPUT_CONTRACT_SKILL[OutputContract.PLAN], "response-contract");
  assertEquals(OUTPUT_CONTRACT_SKILL[OutputContract.VERDICT], "response-contract-judge");
});

Deno.test("fix(skills): the contract skill leads the default skills and appears once", () => {
  assertEquals(
    resolveDefaultSkillIds(OutputContract.QA, ["tdd-methodology", "response-contract-qa"]),
    ["response-contract-qa", "tdd-methodology"],
  );
});

Deno.test("fix(skills): a role without a declared contract keeps its default skills unchanged", () => {
  assertEquals(resolveDefaultSkillIds(undefined, ["error-handling"]), ["error-handling"]);
  assertEquals(resolveDefaultSkillIds(undefined, undefined), []);
});
