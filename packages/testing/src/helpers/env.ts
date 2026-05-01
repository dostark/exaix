/**
 * @module EnvTestHelpers
 * @path tests/helpers/env.ts
 * @description Provides common utilities for manipulating environment variables
 * during tests, ensuring clean restoration of system state.
 */

// Helper to temporarily set environment variables for a test and restore them after
export async function withEnv(env: Record<string, string | null>, fn: () => Promise<void> | void): Promise<void> {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    old[k] = Deno.env.get(k);
    const val = env[k];
    if (val === null) {
      Deno.env.delete(k);
    } else {
      Deno.env.set(k, val);
    }
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (old[k] === undefined) {
        Deno.env.delete(k);
      } else {
        Deno.env.set(k, old[k] as string);
      }
    }
  }
}

export function isTruthyEnv(name: string): boolean {
  const value = Deno.env.get(name);
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

export function isCi(): boolean {
  return isTruthyEnv("CI");
}
