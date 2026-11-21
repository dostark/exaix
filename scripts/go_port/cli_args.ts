#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCliArgs
 * @path scripts/go_port/cli_args.ts
 * @description Reads `--name=value` arguments for the Go-port tooling.
 * Usage: imported by the Go-port scripts.
 */

/** Returns the value of a `--name=value` argument, or undefined. */
export function argValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}
