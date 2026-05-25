/**
 * @module TestFixtures
 * @path packages/testing/src/helpers/fixtures.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides shared fixture path helpers for tests, keeping fixture loading consistent across the suite.
 */

import { dirname, join } from "@std/path";

export function getFixtureRoot(importMetaUrl: string): string {
  let currentDir = dirname(new URL(importMetaUrl).pathname);

  while (true) {
    const candidate = join(currentDir, "tests", "fixtures");
    try {
      const info = Deno.statSync(candidate);
      if (info.isDirectory) {
        return candidate;
      }
    } catch {
      // not found at this level
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(
        `Unable to resolve fixture root from importMetaUrl: ${importMetaUrl}`,
      );
    }
    currentDir = parentDir;
  }
}

export function getFixturePath(importMetaUrl: string, ...segments: string[]): string {
  return join(getFixtureRoot(importMetaUrl), ...segments);
}

export function readFixtureTextSync(importMetaUrl: string, ...segments: string[]): string {
  return Deno.readTextFileSync(getFixturePath(importMetaUrl, ...segments));
}

export async function readFixtureText(importMetaUrl: string, ...segments: string[]): Promise<string> {
  return await Deno.readTextFile(getFixturePath(importMetaUrl, ...segments));
}
