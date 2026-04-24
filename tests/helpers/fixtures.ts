/**
 * @module TestFixtures
 * @path tests/helpers/fixtures.ts
 * @description Provides shared fixture path helpers for tests, keeping fixture loading consistent across the suite.
 */

import { basename, dirname, join } from "@std/path";

export function getFixtureRoot(importMetaUrl: string): string {
  let currentDir = dirname(new URL(importMetaUrl).pathname);

  while (basename(currentDir) !== "tests") {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(
        `Unable to resolve fixture root from importMetaUrl: ${importMetaUrl}`,
      );
    }
    currentDir = parentDir;
  }

  return join(currentDir, "fixtures");
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
