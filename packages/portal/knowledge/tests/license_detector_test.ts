/**
 * @module LicenseDetectorTest
 * @path packages/portal/knowledge/tests/license_detector_test.ts
 * @description Tests for LicenseDetector — Strategy 9 of PortalKnowledgeService.
 * Tests license file reading, SPDX header detection, and confidence scoring.
 */

import { assertEquals } from "@std/assert";
import { ConfidenceLevel, LicenseSource } from "@exaix/core";
import { LicenseDetector } from "../license_detector.ts";

Deno.test("LicenseDetector: detectLicenseFromContent returns MIT for MIT content", () => {
  const detector = new LicenseDetector();

  const result = detector.detectLicenseFromContent(
    "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy",
    "/tmp/LICENSE",
  );

  assertEquals(result?.type, "MIT");
  assertEquals(result?.source, LicenseSource.FILE);
  assertEquals(result?.confidence, ConfidenceLevel.HIGH);
});

Deno.test("LicenseDetector: detectLicenseFromContent returns Apache-2.0 for Apache content", () => {
  const detector = new LicenseDetector();

  const result = detector.detectLicenseFromContent(
    "Apache License, Version 2.0\n\nLicensed under the Apache License",
    "/tmp/LICENSE",
  );

  assertEquals(result?.type, "Apache-2.0");
  assertEquals(result?.source, LicenseSource.FILE);
  assertEquals(result?.confidence, ConfidenceLevel.HIGH);
});

Deno.test("LicenseDetector: detectLicenseFromContent returns null for no match", () => {
  const detector = new LicenseDetector();

  const result = detector.detectLicenseFromContent(
    "Custom license text that doesn't match any known pattern",
    "/tmp/LICENSE",
  );

  assertEquals(result, null);
});

Deno.test("LicenseDetector: reads LICENSE file from temp directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/LICENSE`, "MIT License\n\nPermission is hereby granted");
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    assertEquals(licenses.length, 1);
    assertEquals(licenses[0].type, "MIT");
    assertEquals(licenses[0].source, LicenseSource.FILE);
    assertEquals(licenses[0].confidence, ConfidenceLevel.HIGH);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("LicenseDetector: reads LICENSE.md file", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/LICENSE.md`, "Apache License, Version 2.0");
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    assertEquals(licenses.length, 1);
    assertEquals(licenses[0].type, "Apache-2.0");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("LicenseDetector: returns empty array when no LICENSE file", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    assertEquals(licenses, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("LicenseDetector: detects SPDX headers in source files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sourceContent =
      "// SPDX-License-Identifier: MIT\n// SPDX-License-Identifier: Apache-2.0\n\nexport const x = 1;";
    await Deno.writeTextFile(`${tempDir}/LICENSE`, "MIT License");
    await Deno.writeTextFile(`${tempDir}/main.ts`, sourceContent);
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    const spdxLicenses = licenses.filter((l) => l.source === LicenseSource.SPDX);
    assertEquals(spdxLicenses.length, 1);
    assertEquals(spdxLicenses[0].type, "MIT");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("LicenseDetector: detectLicenseFromContent returns Apache-2.0 for Apache content", () => {
  const detector = new LicenseDetector();

  const result = detector.detectLicenseFromContent(
    "Apache License, Version 2.0\n\nLicensed under the Apache License",
    "/tmp/LICENSE",
  );

  assertEquals(result?.type, "Apache-2.0");
  assertEquals(result?.source, "file");
  assertEquals(result?.confidence, "high");
});

Deno.test("LicenseDetector: detectLicenseFromContent returns null for no match", () => {
  const detector = new LicenseDetector();

  const result = detector.detectLicenseFromContent(
    "Custom license text that doesn't match any known pattern",
    "/tmp/LICENSE",
  );

  assertEquals(result, null);
});

Deno.test("LicenseDetector: reads LICENSE file from temp directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/LICENSE`, "MIT License\n\nPermission is hereby granted");
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    assertEquals(licenses.length, 1);
    assertEquals(licenses[0].type, "MIT");
    assertEquals(licenses[0].source, "file");
    assertEquals(licenses[0].confidence, "high");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("LicenseDetector: reads LICENSE.md file", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/LICENSE.md`, "Apache License, Version 2.0");
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    assertEquals(licenses.length, 1);
    assertEquals(licenses[0].type, "Apache-2.0");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("LicenseDetector: returns empty array when no LICENSE file", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    assertEquals(licenses, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("LicenseDetector: detects SPDX headers in source files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sourceContent =
      "// SPDX-License-Identifier: MIT\n// SPDX-License-Identifier: Apache-2.0\n\nexport const x = 1;";
    await Deno.writeTextFile(`${tempDir}/LICENSE`, "MIT License");
    await Deno.writeTextFile(`${tempDir}/main.ts`, sourceContent);
    const detector = new LicenseDetector();

    const licenses = await detector.analyze(tempDir, ["main.ts"]);

    const spdxLicenses = licenses.filter((l) => l.source === "spdx");
    assertEquals(spdxLicenses.length, 1);
    assertEquals(spdxLicenses[0].type, "MIT");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
