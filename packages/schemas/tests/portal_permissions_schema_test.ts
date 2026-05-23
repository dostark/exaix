/**
 * @module PortalPermissionsSchemaTest
 * @path packages/schemas/tests/portal_permissions_schema_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies that the portal permissions schema uses production defaults and does not depend on test helpers.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { DEFAULT_PORTAL_DEFAULT_BRANCH } from "@exaix/core";
import { PortalPermissionsSchema } from "@exaix/schemas/portal_permissions.ts";

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const PORTAL_PERMISSIONS_SCHEMA_PATH = join(
  TEST_DIR,
  "..",
  "src",
  "portal_permissions.ts",
);

Deno.test("PortalPermissionsSchema defaults default_branch from production constants", () => {
  const parsed = PortalPermissionsSchema.parse({
    alias: "workspace",
    target_path: "/tmp/workspace",
  });

  assertEquals(parsed.default_branch, DEFAULT_PORTAL_DEFAULT_BRANCH);
});

Deno.test("PortalPermissionsSchema source does not import test helpers", async () => {
  const source = await Deno.readTextFile(PORTAL_PERMISSIONS_SCHEMA_PATH);

  assert(!source.includes("tests/helpers/constants.ts"));
});
