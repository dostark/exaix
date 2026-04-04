/**
 * @module MemoryTuiScope
 * @path src/tui/memory_view/memory_scope.ts
 * @description Canonical, type-safe Memory View scope identifiers and utility functions for scope coercion.
 * @architectural-layer TUI
 * * @related-files [src/tui/memory_view/key_handlers.ts]
 */

import { TUI_ACTION_SEARCH } from "../helpers/constants.ts";

export const MemoryTuiScope = {
  GLOBAL: "global",
  PROJECTS: "projects",
  EXECUTIONS: "executions",
  PENDING: "pending",
  SEARCH: TUI_ACTION_SEARCH,
} as const;

export type IMemoryTuiScopeType = typeof MemoryTuiScope[keyof typeof MemoryTuiScope];

export const MEMORY_TUI_SCOPE_VALUES: readonly IMemoryTuiScopeType[] = [
  MemoryTuiScope.GLOBAL,
  MemoryTuiScope.PROJECTS,
  MemoryTuiScope.EXECUTIONS,
  MemoryTuiScope.PENDING,
  MemoryTuiScope.SEARCH,
];

export function isMemoryTuiScope(value: unknown): value is IMemoryTuiScopeType {
  return typeof value === "string" && (MEMORY_TUI_SCOPE_VALUES as readonly string[]).includes(value);
}

export function coerceMemoryTuiScope(
  value: unknown,
  fallback: IMemoryTuiScopeType = MemoryTuiScope.PROJECTS,
): IMemoryTuiScopeType {
  return isMemoryTuiScope(value) ? value : fallback;
}
