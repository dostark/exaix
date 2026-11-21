#!/usr/bin/env -S deno run -A
/**
 * @module GoPortValueGuards
 * @path scripts/go_port/value_guards.ts
 * @description Type guards that narrow untrusted JSON values for the Go-port tooling.
 * Usage: imported by the Go-port scripts.
 */

/** True when the value is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** True when the value is a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** True when the value is an array or a record, and not null. */
export function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
