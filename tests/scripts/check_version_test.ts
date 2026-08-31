/**
 * @module CheckVersionTest
 * @path tests/scripts/check_version_test.ts
 * @description Unit and integration tests for the check_version.ts gatekeeper script.
 * Tests all exported pure helpers (parseSemVer, bumpPatch, bumpMinor, classifyChanges,
 * readVersionFile, writeVersionFile) and integration scenarios using temp files.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import {
  bumpMinor,
  bumpPatch,
  classifyChanges,
  formatSemVer,
  parseSemVer,
  readVersionFile,
  writeVersionFile,
} from "../../scripts/check_version.ts";

// parseSemVer

describe("parseSemVer", () => {
  it("parses a standard version string correctly", () => {
    const result = parseSemVer("1.2.3");
    assertEquals(result, { major: 1, minor: 2, patch: 3 });
  });

  it("parses 0.0.0", () => {
    assertEquals(parseSemVer("0.0.0"), { major: 0, minor: 0, patch: 0 });
  });

  it("parses large version numbers", () => {
    assertEquals(parseSemVer("100.200.300"), { major: 100, minor: 200, patch: 300 });
  });

  it("throws on non-SemVer input (missing segment)", () => {
    assertThrows(() => parseSemVer("1.2"), Error);
  });

  it("throws on non-numeric segment", () => {
    assertThrows(() => parseSemVer("1.x.3"), Error);
  });

  it("throws on negative segment", () => {
    assertThrows(() => parseSemVer("1.-1.3"), Error);
  });
});

// formatSemVer

describe("formatSemVer", () => {
  it("formats { 1, 2, 3 } as '1.2.3'", () => {
    assertEquals(formatSemVer({ major: 1, minor: 2, patch: 3 }), "1.2.3");
  });
});

// bumpPatch

describe("bumpPatch", () => {
  it("increments patch from 1.0.5 to 1.0.6", () => {
    assertEquals(bumpPatch("1.0.5"), "1.0.6");
  });

  it("increments patch from 0.0.0 to 0.0.1", () => {
    assertEquals(bumpPatch("0.0.0"), "0.0.1");
  });

  it("does not touch major or minor", () => {
    const result = parseSemVer(bumpPatch("3.7.9"));
    assertEquals(result.major, 3);
    assertEquals(result.minor, 7);
    assertEquals(result.patch, 10);
  });
});

// bumpMinor

describe("bumpMinor", () => {
  it("increments minor from 1.2.5 to 1.3.0 and resets patch", () => {
    assertEquals(bumpMinor("1.2.5"), "1.3.0");
  });

  it("increments minor from 1.0.0 to 1.1.0", () => {
    assertEquals(bumpMinor("1.0.0"), "1.1.0");
  });

  it("resets patch to 0 after minor bump", () => {
    const result = parseSemVer(bumpMinor("2.3.99"));
    assertEquals(result.patch, 0);
  });

  it("does not touch major", () => {
    const result = parseSemVer(bumpMinor("5.1.0"));
    assertEquals(result.major, 5);
    assertEquals(result.minor, 2);
  });
});

// classifyChanges

describe("classifyChanges", () => {
  it("triggers minor on migrations/*.sql", () => {
    const { requiresMinor } = classifyChanges(["migrations/001_init.sql"]);
    assert(requiresMinor, "Expected requiresMinor to be true for migrations file");
  });

  it("triggers minor on src/services/db.ts", () => {
    const { requiresMinor } = classifyChanges(["src/services/db.ts"]);
    assert(requiresMinor);
  });

  it("triggers minor on src/shared/schemas/config.ts", () => {
    const { requiresMinor } = classifyChanges(["@exaix/schemas/config.ts"]);
    assert(requiresMinor);
  });

  it("triggers minor on src/shared/constants.ts", () => {
    const { requiresMinor } = classifyChanges(["src/shared/constants.ts"]);
    assert(requiresMinor);
  });

  it("triggers minor on scripts/setup_db.ts", () => {
    const { requiresMinor } = classifyChanges(["scripts/setup_db.ts"]);
    assert(requiresMinor);
  });

  it("does NOT trigger minor on apps/exactl/src/exactl.ts", () => {
    const { requiresMinor } = classifyChanges(["apps/exactl/src/exactl.ts"]);
    assertEquals(requiresMinor, false);
  });

  it("does NOT trigger minor on an empty file list", () => {
    assertEquals(classifyChanges([]).requiresMinor, false);
  });

  it("triggers minor if at least one file matches the trigger list", () => {
    const { requiresMinor } = classifyChanges([
      "apps/exactl/src/exactl.ts",
      "migrations/002_add_table.sql",
    ]);
    assert(requiresMinor);
  });

  it("triggers on a new migration file with a different number", () => {
    const { requiresMinor } = classifyChanges(["migrations/002_add_reviews.sql"]);
    assert(requiresMinor);
  });
});

// readVersionFile / writeVersionFile — integration using temp files

describe("readVersionFile and writeVersionFile", () => {
  let tmpDir: string;
  let tmpFile: string;

  const FIXTURE = `/**
 * @module ExaixVersion
 */
export const BINARY_VERSION = "1.0.0";
export const WORKSPACE_SCHEMA_VERSION = "1.0.0";
`;

  beforeEach(async () => {
    tmpDir = await Deno.makeTempDir();
    tmpFile = join(tmpDir, "version.ts");
    await Deno.writeTextFile(tmpFile, FIXTURE);
  });

  afterEach(async () => {
    await Deno.remove(tmpDir, { recursive: true });
  });

  it("reads both constants correctly", () => {
    const { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } = readVersionFile(tmpFile);
    assertEquals(BINARY_VERSION, "1.0.0");
    assertEquals(WORKSPACE_SCHEMA_VERSION, "1.0.0");
  });

  it("writes updated BINARY_VERSION and reads it back", () => {
    writeVersionFile("1.0.1", "1.0.0", tmpFile);
    const { BINARY_VERSION } = readVersionFile(tmpFile);
    assertEquals(BINARY_VERSION, "1.0.1");
  });

  it("writes updated WORKSPACE_SCHEMA_VERSION and reads it back", () => {
    writeVersionFile("1.0.0", "1.1.0", tmpFile);
    const { WORKSPACE_SCHEMA_VERSION } = readVersionFile(tmpFile);
    assertEquals(WORKSPACE_SCHEMA_VERSION, "1.1.0");
  });

  it("round-trips: write then read preserves both versions", () => {
    writeVersionFile("2.3.4", "5.6.7", tmpFile);
    const result = readVersionFile(tmpFile);
    assertEquals(result.BINARY_VERSION, "2.3.4");
    assertEquals(result.WORKSPACE_SCHEMA_VERSION, "5.6.7");
  });

  it("preserves surrounding file content after write", () => {
    writeVersionFile("1.0.1", "1.1.0", tmpFile);
    const text = Deno.readTextFileSync(tmpFile);
    assert(text.includes("@module ExaixVersion"), "Module comment should be preserved");
  });
});
