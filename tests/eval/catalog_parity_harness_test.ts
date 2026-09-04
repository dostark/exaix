/**
 * @module CatalogParityHarnessTest
 * @path tests/eval/catalog_parity_harness_test.ts
 * @description Tests for the generic parity harness assertCatalogCovered.
 *   Covers covered/uncovered/excluded cases on synthetic catalogs.
 */
import { assertEquals } from "@std/assert";
import { assertCatalogCovered } from "./catalog_parity.ts";

const SYNTHETIC_SCENARIOS = [
  { id: "read_file_test", tags: ["subsystem:tools", "entity:read_file"] },
  { id: "write_test", tags: ["subsystem:tools", "entity:write_file"] },
  { id: "agent_role_test", tags: ["subsystem:agent_roles", "entity:senior-coder"] },
  { id: "untagged", tags: ["smoke"] },
];

Deno.test("assertCatalogCovered returns empty when all catalog IDs are covered", () => {
  const missing = assertCatalogCovered({
    catalogIds: ["read_file", "write_file"],
    scenarioCatalog: SYNTHETIC_SCENARIOS,
    subsystemTag: "subsystem:tools",
    exclusions: [],
  });
  assertEquals(missing, []);
});

Deno.test("assertCatalogCovered returns missing IDs for uncovered catalog entries", () => {
  const missing = assertCatalogCovered({
    catalogIds: ["read_file", "write_file", "search_files"],
    scenarioCatalog: SYNTHETIC_SCENARIOS,
    subsystemTag: "subsystem:tools",
    exclusions: [],
  });
  assertEquals(missing, ["search_files"]);
});

Deno.test("assertCatalogCovered excludes IDs in the exclusion list", () => {
  const missing = assertCatalogCovered({
    catalogIds: ["read_file", "write_file", "search_files"],
    scenarioCatalog: SYNTHETIC_SCENARIOS,
    subsystemTag: "subsystem:tools",
    exclusions: ["search_files"],
  });
  assertEquals(missing, []);
});

Deno.test("assertCatalogCovered ignores scenarios from other subsystems", () => {
  const missing = assertCatalogCovered({
    catalogIds: ["senior-coder", "mock-agent"],
    scenarioCatalog: SYNTHETIC_SCENARIOS,
    subsystemTag: "subsystem:agent_roles",
    exclusions: [],
  });
  assertEquals(missing, ["mock-agent"]);
});

Deno.test("assertCatalogCovered returns all IDs when no scenarios match the subsystem", () => {
  const missing = assertCatalogCovered({
    catalogIds: ["a", "b"],
    scenarioCatalog: SYNTHETIC_SCENARIOS,
    subsystemTag: "subsystem:flows",
    exclusions: [],
  });
  assertEquals(missing, ["a", "b"]);
});
