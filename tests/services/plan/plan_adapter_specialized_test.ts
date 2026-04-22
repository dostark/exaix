/**
 * @module PlanAdapterSpecializedTest
 * @path tests/services/plan/plan_adapter_specialized_test.ts
 * @description Targeted tests for PlanAdapter's Markdown rendering engine, verifying the correct generation
 * of security audit sections, tool analysis blocks, and QA verification criteria.
 */

import { assertStringIncludes } from "@std/assert";
import { PlanAdapter } from "../../../src/services/plan/plan_adapter.ts";
import type { Plan } from "@exaix/schemas/plan_schema.ts";

Deno.test("PlanAdapter.toMarkdown - renders security section", () => {
  const adapter = new PlanAdapter();
  const plan: Plan = {
    subject: "Security Audit",
    description: "Audit of authentication system",
    steps: [{ step: 1, title: "Initial Scan", description: "Scan all entry points" }],
    security: {
      executiveSummary: "Found several critical vulnerabilities.",
      findings: [
        {
          title: "Hardcoded Credentials",
          severity: "CRITICAL",
          location: "src/auth.ts:45",
          description: "Admin password is hardcoded.",
          impact: "Full system compromise.",
          remediation: "Use environment variables.",
          codeExample: "const pass = 'admin123';",
        },
      ],
      recommendations: ["Rotate all passwords", "Implement MFA"],
      compliance: ["SOC2 Section 4.5"],
    },
  };

  const markdown = adapter.toMarkdown(plan);

  assertStringIncludes(markdown, "# Security Audit");
  assertStringIncludes(markdown, "## Security Analysis");
  assertStringIncludes(markdown, "### Executive Summary");
  assertStringIncludes(markdown, "Found several critical vulnerabilities.");
  assertStringIncludes(markdown, "### Critical Findings");
  assertStringIncludes(markdown, "#### Hardcoded Credentials [CRITICAL]");
  assertStringIncludes(markdown, "- **Location:** src/auth.ts:45");
  assertStringIncludes(markdown, "```typescript");
  assertStringIncludes(markdown, "const pass = 'admin123';");
  assertStringIncludes(markdown, "### Security Recommendations");
  assertStringIncludes(markdown, "- Rotate all passwords");
  assertStringIncludes(markdown, "### Compliance Notes");
  assertStringIncludes(markdown, "SOC2 Section 4.5");
});

Deno.test("PlanAdapter.toMarkdown - renders analysis section", () => {
  const adapter = new PlanAdapter();
  const plan: Plan = {
    subject: "Code Analysis",
    description: "Deep dive into project structure",
    steps: [{ step: 1, title: "Analyze Files", description: "Read all source files" }],
    analysis: {
      totalFiles: 42,
      linesOfCode: 5000,
      mainLanguage: "TypeScript",
      framework: "Deno",
      modules: [
        { name: "Auth", purpose: "User authentication", exports: ["login", "logout"], dependencies: ["DB"] },
      ],
      components: [
        { name: "LoginController", location: "src/auth.ts", purpose: "Handles login requests", api: "POST /login" },
      ],
      patterns: [
        { pattern: "Singleton", location: "src/db.ts", usage: "Database connection manager" },
      ],
      metrics: [
        { metric: "Cyclomatic Complexity", value: 12, assessment: "Moderate" },
      ],
      recommendations: ["Refactor long functions"],
    },
  };

  const markdown = adapter.toMarkdown(plan);

  assertStringIncludes(markdown, "## Analysis Results");
  assertStringIncludes(markdown, "**Total Files:** 42");
  assertStringIncludes(markdown, "**Main Language:** TypeScript");
  assertStringIncludes(markdown, "### Modules");
  assertStringIncludes(markdown, "- **Auth**: User authentication");
  assertStringIncludes(markdown, "### Key Components");
  assertStringIncludes(markdown, "- **LoginController** (src/auth.ts): Handles login requests");
  assertStringIncludes(markdown, "### Patterns Identified");
  assertStringIncludes(markdown, "- **Singleton** in `src/db.ts`: Database connection manager");
  assertStringIncludes(markdown, "### Metrics");
  assertStringIncludes(markdown, "- **Cyclomatic Complexity**: 12 - *Moderate*");
});

Deno.test("PlanAdapter.toMarkdown - renders qa section", () => {
  const adapter = new PlanAdapter();
  const plan: Plan = {
    subject: "QA Test Plan",
    description: "Verification of new features",
    steps: [{ step: 1, title: "Execute Tests", description: "Run automated test suite" }],
    qa: {
      testSummary: [
        { category: "Unit", planned: 100, executed: 100, passed: 98, failed: 2 },
      ],
      coverage: {
        unit: [
          {
            scenario: "Unit coverage",
            setup: "Unit setup",
            steps: ["Run unit tests"],
            expectedResult: "All unit tests pass",
            status: "PASS",
          },
        ],
      },
      issues: [
        {
          title: "UI Glitch",
          severity: "Medium",
          component: "Dashboard",
          stepsToReproduce: ["Login", "Click on profile", "Resize window"],
          description: "Profile icon overflows on small screens",
        },
      ],
    },
  };

  const markdown = adapter.toMarkdown(plan);

  assertStringIncludes(markdown, "## QA & Testing Results");
  assertStringIncludes(markdown, "| Category | Planned | Executed | Passed | Failed |");
  assertStringIncludes(markdown, "| Unit | 100 | 100 | 98 | 2 |");
  assertStringIncludes(markdown, "### Unit Coverage");
  assertStringIncludes(markdown, "#### Unit coverage");
  assertStringIncludes(markdown, "### Issues Found");
  assertStringIncludes(markdown, "#### UI Glitch [Medium]");
  assertStringIncludes(markdown, "1. Click on profile");
});

Deno.test("PlanAdapter.toMarkdown - renders performance section", () => {
  const adapter = new PlanAdapter();
  const plan: Plan = {
    subject: "Performance Review",
    description: "Optimizing database queries",
    steps: [{ step: 1, title: "Profile Queries", description: "Identify slow queries" }],
    performance: {
      executiveSummary: "Database is the main bottleneck.",
      findings: [
        {
          title: "Missing Index on Users.email",
          impact: "HIGH",
          category: "Database",
          location: "src/db/queries.ts",
          currentBehavior: "Sequential scan on login",
          expectedImprovement: "O(log n) lookup instead of O(n)",
          recommendation: "Add index to email column",
        },
      ],
      priorities: ["Fix index issues", "Optimize join queries"],
    },
  };

  const markdown = adapter.toMarkdown(plan);

  assertStringIncludes(markdown, "## Performance Analysis");
  assertStringIncludes(markdown, "### Executive Summary");
  assertStringIncludes(markdown, "Database is the main bottleneck.");
  assertStringIncludes(markdown, "### Performance Findings");
  assertStringIncludes(markdown, "#### Missing Index on Users.email [Impact: HIGH]");
  assertStringIncludes(markdown, "- **Category:** Database");
  assertStringIncludes(markdown, "- **Current Behavior:** Sequential scan on login");
  assertStringIncludes(markdown, "### Optimization Priorities");
  assertStringIncludes(markdown, "- Fix index issues");
});
