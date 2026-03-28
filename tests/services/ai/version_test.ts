/**
 * @module VersionTest
 * @path tests/services/version_test.ts
 * @description Unit tests verifying that BINARY_VERSION and WORKSPACE_SCHEMA_VERSION
 * are non-empty valid SemVer strings.
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "../../../src/shared/version.ts";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

describe("Exaix version constants", () => {
  it("BINARY_VERSION is a non-empty string", () => {
    assert(typeof BINARY_VERSION === "string");
    assert(BINARY_VERSION.length > 0);
  });

  it("BINARY_VERSION matches SemVer pattern MAJOR.MINOR.PATCH", () => {
    assert(SEMVER_RE.test(BINARY_VERSION), `BINARY_VERSION "${BINARY_VERSION}" is not valid SemVer`);
  });

  it("WORKSPACE_SCHEMA_VERSION is a non-empty string", () => {
    assert(typeof WORKSPACE_SCHEMA_VERSION === "string");
    assert(WORKSPACE_SCHEMA_VERSION.length > 0);
  });

  it("WORKSPACE_SCHEMA_VERSION matches SemVer pattern MAJOR.MINOR.PATCH", () => {
    assert(
      SEMVER_RE.test(WORKSPACE_SCHEMA_VERSION),
      `WORKSPACE_SCHEMA_VERSION "${WORKSPACE_SCHEMA_VERSION}" is not valid SemVer`,
    );
  });

  it("both constants have three numeric segments", () => {
    for (
      const [name, v] of [
        ["BINARY_VERSION", BINARY_VERSION],
        ["WORKSPACE_SCHEMA_VERSION", WORKSPACE_SCHEMA_VERSION],
      ]
    ) {
      const parts = v.split(".").map(Number);
      assertEquals(parts.length, 3, `${name} must have exactly 3 segments`);
      for (const p of parts) {
        assert(!isNaN(p) && p >= 0, `${name} segment "${p}" is not a non-negative integer`);
      }
    }
  });
});
