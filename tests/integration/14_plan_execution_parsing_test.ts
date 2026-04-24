// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanExecutionParsingIntegrationTest
 * @path tests/integration/14_plan_execution_parsing_test.ts
 * @description Verifies the logic for parsing and validating agent task plans, ensuring
 * correct extraction of tool sequences and step parameters before execution.
 */

import { assertEquals, assertExists } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import { MemoryStatus } from "../../src/shared/status/memory_status.ts";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { getWorkspaceActiveDir } from "../helpers/paths_helper.ts";

interface Frontmatter {
  trace_id?: string;
  request_id?: string;
  agent?: string;
  status?: string;
  created_at?: string;
  [key: string]: any;
}

Deno.test("Integration: Plan Execution Parsing", async (t) => {
  await t.step("parses complete multi-step plan", async () => {
    const env = await TestEnvironment.create();

    try {
      // Create a realistic approved plan
      const planContent = `---
trace_id: ${crypto.randomUUID()}
request_id: ${crypto.randomUUID()}
identity: mock-agent
status: approved
created_at: ${new Date().toISOString()}
---

# Implementation Plan: Add User Authentication

## Background
This plan implements user authentication with JWT tokens.

## Step 1: Create User Model
Create the database schema and TypeScript types for users.

**Files to modify:**
- src/models/user.ts (create new)
- src/database/schema.sql (update)

**Tasks:**
- Define User interface with id, email, passwordHash
- Create users table migration
- Add email validation
- Add password hashing utilities

## Step 2: Implement Authentication Service
Build the core authentication logic.

**Files to modify:**
- src/services/auth.ts (create new)
- src/utils/jwt.ts (create new)

**Tasks:**
- Implement signup(email, password)
- Implement login(email, password)
- Add JWT token generation
- Add token verification
- Handle password hashing with bcrypt

## Step 3: Add API Endpoints
Create REST API endpoints for authentication.

**Files to modify:**
- src/routes/auth.ts (create new)
- src/main.ts (update)

**Tasks:**
- POST /api/auth/signup endpoint
- POST /api/auth/login endpoint
- Add request validation middleware
- Add error handling
- Return JWT tokens in response

## Step 4: Create Authentication Middleware
Protect routes with authentication checks.

**Files to modify:**
- src/middleware/auth.ts (create new)
- src/routes/protected.ts (update)

**Tasks:**
- Extract JWT from Authorization header
- Verify token signature
- Attach user to request context
- Handle expired tokens
- Add unauthorized error responses

## Success Criteria
- Users can signup with email/password
- Users can login and receive JWT token
- Protected routes require valid JWT
- Tokens expire after 24 hours
- All tests pass
`;

      const planPath = join(getWorkspaceActiveDir(env.tempDir), "auth_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Wait for file to be written
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Parse the plan (simulating what daemon would do)
      const content = await Deno.readTextFile(planPath);

      // Extract frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(frontmatterMatch, "Should have frontmatter");

      const frontmatter = parseYaml(frontmatterMatch[1]) as Frontmatter;

      assertEquals(typeof frontmatter.trace_id, "string");
      assertEquals(typeof frontmatter.request_id, "string");
      assertEquals(frontmatter.identity, "mock-agent");
      assertEquals(frontmatter.status, MemoryStatus.APPROVED);

      // Extract body
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      assertExists(bodyMatch, "Should have body");

      const body = bodyMatch[1];

      // Extract all steps
      const stepMatches = [
        ...body.matchAll(/## Step (\d+): ([^\n]+)\n([\s\S]*?)(?=## Step \d+:|## Success Criteria|$)/g),
      ];

      assertEquals(stepMatches.length, 4, "Should have 4 steps");

      // Validate step structure
      assertEquals(stepMatches[0][1], "1");
      assertEquals(stepMatches[0][2], "Create User Model");
      assertEquals(stepMatches[0][3].includes("src/models/user.ts"), true);

      assertEquals(stepMatches[1][1], "2");
      assertEquals(stepMatches[1][2], "Implement Authentication Service");
      assertEquals(stepMatches[1][3].includes("src/services/auth.ts"), true);

      assertEquals(stepMatches[2][1], "3");
      assertEquals(stepMatches[2][2], "Add API Endpoints");
      assertEquals(stepMatches[2][3].includes("POST /api/auth/signup"), true);

      assertEquals(stepMatches[3][1], "4");
      assertEquals(stepMatches[3][2], "Create Authentication Middleware");
      assertEquals(stepMatches[3][3].includes("Verify token signature"), true);

      console.log("✅ Integration test passed: Complete plan parsed successfully");
    } finally {
      await env.cleanup();
    }
  });

  await t.step("handles plan with minimal structure", async () => {
    const env = await TestEnvironment.create();

    try {
      const planContent = `---
trace_id: ${crypto.randomUUID()}
---

# Quick Fix

## Step 1: Update Version
Bump version number in package.json
`;

      const planPath = join(getWorkspaceActiveDir(env.tempDir), "version_bump_plan.md");
      await Deno.writeTextFile(planPath, planContent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await Deno.readTextFile(planPath);

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(frontmatterMatch);

      const frontmatter = parseYaml(frontmatterMatch[1]) as Frontmatter;

      assertExists(frontmatter.trace_id, "trace_id is required");

      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      assertExists(bodyMatch);

      const body = bodyMatch[1];
      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]+)/g)];

      assertEquals(stepMatches.length, 1);
      assertEquals(stepMatches[0][2], "Update Version");

      console.log("✅ Integration test passed: Minimal plan parsed successfully");
    } finally {
      await env.cleanup();
    }
  });

  await t.step("detects invalid plan structure", async () => {
    const env = await TestEnvironment.create();

    try {
      const planContent = `---
trace_id: ${crypto.randomUUID()}
---

# Plan Without Steps

This plan has no step headers, which should be detected as invalid.
`;

      const planPath = join(getWorkspaceActiveDir(env.tempDir), "invalid_structure_plan.md");
      await Deno.writeTextFile(planPath, planContent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await Deno.readTextFile(planPath);

      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      assertExists(bodyMatch);

      const body = bodyMatch[1];
      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]+)/g)];

      assertEquals(stepMatches.length, 0, "Should have no valid steps");

      // This should be caught and logged as error: "plan.parsing_failed"
      console.log("✅ Integration test passed: Invalid structure detected");
    } finally {
      await env.cleanup();
    }
  });

  await t.step("extracts context from full plan", async () => {
    const env = await TestEnvironment.create();

    try {
      const traceId = crypto.randomUUID();
      const requestId = crypto.randomUUID();

      const planContent = `---
trace_id: ${traceId}
request_id: ${requestId}
identity: mock-agent
status: approved
priority: high
created_at: 2024-01-01T10:00:00Z
---

# Feature Implementation

## Step 1: Setup
Initial setup
`;

      const planPath = join(getWorkspaceActiveDir(env.tempDir), "context_test_plan.md");
      await Deno.writeTextFile(planPath, planContent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await Deno.readTextFile(planPath);

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(frontmatterMatch);

      const frontmatter = parseYaml(frontmatterMatch[1]) as Frontmatter;

      // Validate all context fields
      assertEquals(frontmatter.trace_id, traceId);
      assertEquals(frontmatter.request_id, requestId);
      assertEquals(frontmatter.identity, "mock-agent");
      assertEquals(frontmatter.status, MemoryStatus.APPROVED);
      assertEquals(frontmatter.priority, "high");
      // YAML parser converts ISO strings to Date objects
      const createdAt = frontmatter.created_at;
      const createdAtDate = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
      assertEquals(createdAtDate instanceof Date && !isNaN(createdAtDate.getTime()), true);
      if (!createdAtDate) throw new Error("createdAtDate is undefined");
      assertEquals(createdAtDate.toISOString(), "2024-01-01T10:00:00.000Z");

      console.log("✅ Integration test passed: Context extracted successfully");
    } finally {
      await env.cleanup();
    }
  });

  await t.step("handles non-sequential step numbering", async () => {
    const env = await TestEnvironment.create();

    try {
      const planContent = `---
trace_id: ${crypto.randomUUID()}
---

# Plan with Gaps

## Step 1: First
Do something

## Step 3: Third (gap!)
Skip step 2

## Step 5: Fifth
Another gap
`;

      const planPath = join(getWorkspaceActiveDir(env.tempDir), "gap_plan.md");
      await Deno.writeTextFile(planPath, planContent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      assertExists(bodyMatch);

      const body = bodyMatch[1];
      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]+)/g)];

      assertEquals(stepMatches.length, 3);

      // Extract step numbers
      const stepNumbers = stepMatches.map((m) => parseInt(m[1]));
      assertEquals(stepNumbers, [1, 3, 5]);

      // Check if sequential
      const isSequential = stepNumbers.every((num, idx) => num === idx + 1);
      assertEquals(isSequential, false, "Should detect non-sequential numbering");

      // This should be logged as warning: "plan.non_sequential_steps"
      console.log("✅ Integration test passed: Non-sequential steps detected");
    } finally {
      await env.cleanup();
    }
  });
});
