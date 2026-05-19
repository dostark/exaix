/**
 * @module PortalKnowledgeConstantsTest
 * @path tests/services/portal_knowledge/portal_knowledge_constants_test.ts
 * @description Validates that all portal knowledge constants are exported from
 * src/shared/constants.ts with correct types and sensible default values.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  ARCHITECTURE_INFERRER_MAX_FILE_TOKENS,
  ARCHITECTURE_INFERRER_TOKEN_BUDGET,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_KNOWLEDGE_STALENESS_HOURS,
  DEFAULT_MAX_FILES_TO_READ,
  DEFAULT_PORTAL_KNOWLEDGE_MODE,
  DEFAULT_QUICK_SCAN_LIMIT,
  DEFAULT_SYMBOL_MAP_LIMIT,
  DENO_DOC_TIMEOUT_MS,
  PORTAL_ENTRYPOINT_NAMES,
  PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS,
  PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS,
  PORTAL_KNOWLEDGE_PRIORITY_PATTERNS,
  PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
} from "@exaix/core";

// ---------------------------------------------------------------------------
// Numeric constants — correct types and sensible values
// ---------------------------------------------------------------------------

Deno.test("[PortalKnowledgeConstants] DEFAULT_QUICK_SCAN_LIMIT is 200", () => {
  assertEquals(DEFAULT_QUICK_SCAN_LIMIT, 200);
});

Deno.test("[PortalKnowledgeConstants] DEFAULT_MAX_FILES_TO_READ is 50", () => {
  assertEquals(DEFAULT_MAX_FILES_TO_READ, 50);
});

Deno.test("[PortalKnowledgeConstants] DEFAULT_KNOWLEDGE_STALENESS_HOURS is 168", () => {
  assertEquals(DEFAULT_KNOWLEDGE_STALENESS_HOURS, 168);
});

Deno.test("[PortalKnowledgeConstants] DEFAULT_PORTAL_KNOWLEDGE_MODE is 'quick'", () => {
  assertEquals(DEFAULT_PORTAL_KNOWLEDGE_MODE, "quick");
});

Deno.test("[PortalKnowledgeConstants] ARCHITECTURE_INFERRER_TOKEN_BUDGET is 8000", () => {
  assertEquals(ARCHITECTURE_INFERRER_TOKEN_BUDGET, 8_000);
});

Deno.test("[PortalKnowledgeConstants] ARCHITECTURE_INFERRER_MAX_FILE_TOKENS is 200", () => {
  assertEquals(ARCHITECTURE_INFERRER_MAX_FILE_TOKENS, 200);
});

Deno.test("[PortalKnowledgeConstants] PORTAL_KNOWLEDGE_PROMPT_MAX_LINES is 60", () => {
  assertEquals(PORTAL_KNOWLEDGE_PROMPT_MAX_LINES, 60);
});

Deno.test("[PortalKnowledgeConstants] DEFAULT_SYMBOL_MAP_LIMIT is 100", () => {
  assertEquals(DEFAULT_SYMBOL_MAP_LIMIT, 100);
});

Deno.test("[PortalKnowledgeConstants] DENO_DOC_TIMEOUT_MS is 15000", () => {
  assertEquals(DENO_DOC_TIMEOUT_MS, 15_000);
});

// ---------------------------------------------------------------------------
// Array constants — non-empty arrays with expected entries
// ---------------------------------------------------------------------------

Deno.test("[PortalKnowledgeConstants] DEFAULT_IGNORE_PATTERNS contains node_modules", () => {
  assertExists(DEFAULT_IGNORE_PATTERNS);
  assertEquals(Array.isArray(DEFAULT_IGNORE_PATTERNS), true);
  assertEquals(DEFAULT_IGNORE_PATTERNS.includes("node_modules"), true);
  assertEquals(DEFAULT_IGNORE_PATTERNS.includes(".git"), true);
});

Deno.test("[PortalKnowledgeConstants] PORTAL_ENTRYPOINT_NAMES contains main.ts", () => {
  assertExists(PORTAL_ENTRYPOINT_NAMES);
  assertEquals(Array.isArray(PORTAL_ENTRYPOINT_NAMES), true);
  assertEquals(PORTAL_ENTRYPOINT_NAMES.includes("main.ts"), true);
  assertEquals(PORTAL_ENTRYPOINT_NAMES.includes("mod.ts"), true);
  assertEquals(PORTAL_ENTRYPOINT_NAMES.includes("index.ts"), true);
});

Deno.test("[PortalKnowledgeConstants] PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS is non-empty array", () => {
  assertExists(PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS);
  assertEquals(Array.isArray(PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS), true);
  assertEquals(PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS.length > 0, true);
});

Deno.test("[PortalKnowledgeConstants] PORTAL_KNOWLEDGE_PRIORITY_PATTERNS is non-empty array", () => {
  assertExists(PORTAL_KNOWLEDGE_PRIORITY_PATTERNS);
  assertEquals(Array.isArray(PORTAL_KNOWLEDGE_PRIORITY_PATTERNS), true);
  assertEquals(PORTAL_KNOWLEDGE_PRIORITY_PATTERNS.length > 0, true);
});

// ---------------------------------------------------------------------------
// Record constants — architecture layer dir mappings
// ---------------------------------------------------------------------------

Deno.test("[PortalKnowledgeConstants] PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS maps services dir", () => {
  assertExists(PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS);
  assertEquals(typeof PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS, "object");
  assertExists(PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS["services"]);
  assertExists(PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS["tests"]);
});
