/**
 * @module PlanSchemaTest
 * @path tests/schemas/plan_schema_test.ts
 * @description Verifies the Zod schemas for execution plans, ensuring robust
 * validation of step definitions, tool arguments, and human-review state.
 */

import { McpToolName } from "@exaix/mcp";
import { describe, it } from "@std/testing/bdd";

import { assertEquals, assertExists } from "@std/assert";
import type { ZodError } from "zod";
import type { IPlanStep, Plan } from "@exaix/schemas";

import { PlanSchema, PlanStepSchema } from "@exaix/schemas";

describe("PlanStepSchema", () => {
  describe("Valid Steps", () => {
    it("should validate step with all optional fields", () => {
      const stepData = {
        step: 1,
        title: "Create User Database Schema",
        description: "Create migration file for users table with columns: id, email, password_hash, created_at",
        tools: [McpToolName.WRITE_FILE, McpToolName.RUN_COMMAND],
        successCriteria: [
          "Migration file created in db/migrations/",
          "Schema includes unique constraint on email",
          "Password stored as hash, not plaintext",
        ],
        dependencies: [2, 3],
        rollback: "Drop users table",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, true);
      if (result.success) {
        const step: IPlanStep = result.data;
        assertEquals(step.step, 1);
        assertEquals(step.title, "Create User Database Schema");
        assertEquals(step.description.includes("migration file"), true);
        assertEquals(step.tools?.length, 2);
        assertEquals(step.successCriteria?.length, 3);
        assertEquals(step.dependencies?.length, 2);
        assertEquals(step.rollback, "Drop users table");
      }
    });

    it("should validate step with string dependencies", () => {
      const stepData = {
        step: 1,
        title: "Define Interfaces",
        description: "Identify public interfaces for the feature",
        dependencies: ["Step 0", "requirements"],
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.dependencies?.length, 2);
        assertEquals(result.data.dependencies?.[0], "Step 0");
      }
    });

    it("should validate minimal step (required fields only)", () => {
      const stepData = {
        step: 1,
        title: "Simple Step",
        description: "This is a simple step with no optional fields",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.step, 1);
        assertEquals(result.data.title, "Simple Step");
        assertEquals(result.data.tools, undefined);
        assertEquals(result.data.successCriteria, undefined);
      }
    });
  });

  describe("Invalid Steps", () => {
    it("should reject step with invalid step number (zero)", () => {
      const stepData = {
        step: 0,
        title: "Invalid Step",
        description: "Step number cannot be zero",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, false);
      if (!result.success) {
        assertExists(result.error);
      }
    });

    it("should reject step with negative step number", () => {
      const stepData = {
        step: -1,
        title: "Invalid Step",
        description: "Step number cannot be negative",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, false);
    });

    it("should reject step with non-integer step number", () => {
      const stepData = {
        step: 1.5,
        title: "Invalid Step",
        description: "Step number must be integer",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, false);
    });

    it("should reject step with invalid tool enum value", () => {
      const stepData = {
        step: 1,
        title: "Invalid Tools",
        description: "Tools must be from valid enum",
        tools: ["invalid_tool", McpToolName.WRITE_FILE],
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, false);
    });

    it("should reject step with empty title", () => {
      const stepData = {
        step: 1,
        title: "",
        description: "Title cannot be empty",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, false);
    });

    it("should reject step with empty description", () => {
      const stepData = {
        step: 1,
        title: "Valid Title",
        description: "",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, false);
    });

    it("should reject step with title exceeding 200 characters", () => {
      const stepData = {
        step: 1,
        title: "A".repeat(201),
        description: "Title too long",
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, false);
    });
  });

  describe("Tools Enum Validation", () => {
    it("should accept all valid tool values", () => {
      const validTools = [
        McpToolName.READ_FILE,
        McpToolName.WRITE_FILE,
        McpToolName.RUN_COMMAND,
        McpToolName.LIST_DIRECTORY,
        McpToolName.SEARCH_FILES,
      ];

      const stepData = {
        step: 1,
        title: "Tool Test",
        description: "Testing all valid tools",
        tools: validTools,
      };

      const result = PlanStepSchema.safeParse(stepData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.tools?.length, 5);
      }
    });
  });
});

describe("PlanSchema", () => {
  describe("Valid Plans", () => {
    it("should validate plan with all optional fields", () => {
      const planData = {
        subject: "Implement Authentication System",
        description: "Add user authentication with JWT tokens, password hashing, and protected routes",
        steps: [
          {
            step: 1,
            title: "Create User Database Schema",
            description: "Create migration file for users table",
            tools: [McpToolName.WRITE_FILE, McpToolName.RUN_COMMAND],
            successCriteria: ["Migration file created"],
          },
          {
            step: 2,
            title: "Implement Password Hashing",
            description: "Create utility functions for password hashing",
            tools: [McpToolName.WRITE_FILE],
            dependencies: [1],
          },
        ],
        estimatedDuration: "2-3 hours",
        risks: [
          "JWT secret must be kept secure",
          "Database migration may fail if users table exists",
        ],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        const plan: Plan = result.data;
        assertEquals(plan.subject, "Implement Authentication System");
        assertEquals(plan.steps?.length, 2);
        assertEquals(plan.estimatedDuration, "2-3 hours");
        assertEquals(plan.risks?.length, 2);
      }
    });

    it("should validate minimal plan (required fields only)", () => {
      const planData = {
        subject: "Simple Plan",
        description: "A simple plan with minimal fields",
        steps: [
          {
            step: 1,
            title: "Single Step",
            description: "Do the thing",
          },
        ],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.subject, "Simple Plan");
        assertEquals(result.data.steps?.length, 1);
        assertEquals(result.data.estimatedDuration, undefined);
        assertEquals(result.data.risks, undefined);
      }
    });
  });

  describe("Invalid Plans", () => {
    it("should reject plan with missing subject", () => {
      const planData = {
        description: "Missing subject",
        steps: [
          {
            step: 1,
            title: "Step",
            description: "Description",
          },
        ],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
      if (!result.success) {
        const errors = result.error as ZodError;
        const subjectError = errors.errors.find((e) => e.path.includes("subject"));
        assertExists(subjectError);
      }
    });

    it("should reject plan with missing description", () => {
      const planData = {
        subject: "Has Subject",
        steps: [
          {
            step: 1,
            title: "Step",
            description: "Description",
          },
        ],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
      if (!result.success) {
        const errors = result.error as ZodError;
        const descError = errors.errors.find((e) => e.path.includes("description"));
        assertExists(descError);
      }
    });

    it("should reject plan with neither steps nor specialized fields", () => {
      const planData = {
        subject: "Has Subject",
        description: "Has description but no steps or specialized fields",
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
      if (!result.success) {
        const errors = result.error as ZodError;
        // Should have validation errors since neither steps nor specialized fields are present
        assertExists(errors.errors.length > 0);
      }
    });

    it("should reject plan with empty steps array", () => {
      const planData = {
        subject: "Empty Steps",
        description: "Steps array is empty",
        steps: [],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
    });

    it("should reject plan with empty subject", () => {
      const planData = {
        subject: "",
        description: "Valid description",
        steps: [
          {
            step: 1,
            title: "Step",
            description: "Description",
          },
        ],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
    });

    it("should reject plan with subject exceeding 80 characters", () => {
      const planData = {
        subject: "A".repeat(81),
        description: "Valid description",
        steps: [
          {
            step: 1,
            title: "Step",
            description: "Description",
          },
        ],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
    });

    it("should reject plan with more than 50 steps", () => {
      const steps = Array.from({ length: 51 }, (_, i) => ({
        step: i + 1,
        title: `Step ${i + 1}`,
        description: `Description ${i + 1}`,
      }));

      const planData = {
        subject: "Too Many Steps",
        description: "This plan has too many steps",
        steps,
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
    });
  });
});

describe("PlanSchema - Specialized Agent Fields", () => {
  describe("Code Analysis Plans", () => {
    it("should validate plan with analysis field", () => {
      const planData = {
        subject: "Codebase Analysis Report",
        description: "Comprehensive analysis of project structure",
        analysis: {
          totalFiles: 42,
          linesOfCode: 1250,
          mainLanguage: "TypeScript",
          framework: "Deno",
          directoryStructure: "src/\n├── services/\n└── utils/",
          modules: [
            {
              name: "auth.ts",
              purpose: "Authentication service",
              exports: ["login", "logout"],
              dependencies: ["jwt"],
            },
          ],
          patterns: [
            {
              pattern: "Repository",
              location: "src/repos/",
              usage: "Data access abstraction",
            },
          ],
          metrics: [
            {
              metric: "Cyclomatic Complexity (avg)",
              value: 3.2,
              assessment: "Good",
            },
          ],
          recommendations: [
            "Add more unit tests",
            "Refactor large functions",
          ],
        },
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.analysis?.totalFiles, 42);
        assertEquals(result.data.analysis?.mainLanguage, "TypeScript");
        assertEquals(result.data.analysis?.modules?.length, 1);
        assertEquals(result.data.analysis?.recommendations?.length, 2);
      }
    });

    it("should validate minimal analysis plan", () => {
      const planData = {
        subject: "Basic Analysis",
        description: "Simple code analysis",
        analysis: {},
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
    });
  });

  describe("Security Analysis Plans", () => {
    it("should validate plan with security field", () => {
      const planData = {
        subject: "Security Analysis Report",
        description: "Security assessment and vulnerability analysis",
        security: {
          executiveSummary: "Overall security posture is good",
          findings: [
            {
              title: "SQL Injection Vulnerability",
              severity: "HIGH" as const,
              location: "src/database.ts:45",
              description: "User input not properly sanitized",
              impact: "Potential data breach",
              remediation: "Use parameterized queries",
              codeExample: "// Before: unsafe\n// After: safe",
            },
          ],
          recommendations: [
            "Implement input validation",
            "Add security headers",
          ],
          compliance: [
            "OWASP Top 10: 8/10",
            "GDPR compliant",
          ],
        },
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.security?.findings?.[0].severity, "HIGH");
        assertEquals(result.data.security?.recommendations?.length, 2);
      }
    });

    it("should reject invalid severity level", () => {
      const planData = {
        subject: "Security Report",
        description: "Invalid security analysis",
        security: {
          findings: [
            {
              title: "Test IFinding",
              severity: "INVALID", // Invalid severity
              location: "test.ts",
              description: "Test",
              impact: "Test",
              remediation: "Test",
            },
          ],
        },
      } as PlanData;

      interface PlanData {
        subject: string;
        description: string;
        security?: {
          findings?: Array<{
            title: string;
            severity: string;
            location: string;
            description: string;
            impact: string;
            remediation: string;
          }>;
          recommendations?: string[];
        };
      }

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, false);
    });
  });

  describe("QA/Testing Plans", () => {
    it("should validate plan with QA field", () => {
      const planData = {
        subject: "QA Assessment Report",
        description: "Quality assurance and testing analysis",
        qa: {
          testSummary: [
            {
              category: "Integration",
              planned: 15,
              executed: 15,
              passed: 13,
              failed: 2,
            },
          ],
          coverage: {
            integration: [
              {
                scenario: "User registration",
                setup: "Clean database",
                steps: ["Navigate", "Fill form", "Submit"],
                expectedResult: "User created",
                status: "PASS" as const,
                notes: "All validations work",
              },
            ],
          },
          issues: [
            {
              title: "Form validation bypass",
              severity: "High" as const,
              component: "RegistrationForm",
              stepsToReproduce: ["Submit empty form"],
              description: "Client-side validation bypassable",
            },
          ],
        },
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.qa?.testSummary?.[0].passed, 13);
        assertEquals(result.data.qa?.issues?.[0].severity, "High");
      }
    });

    it("should accept unit coverage and alternative e2e shape", () => {
      const planData = {
        subject: "QA Coverage Report",
        description: "QA coverage with unit and e2e cases",
        qa: {
          coverage: {
            unit: [
              {
                scenario: "Unit scenario",
                setup: "Unit setup",
                steps: ["Step 1"],
                expectedResult: "Unit expected",
                status: "PASS" as const,
              },
            ],
            e2e: [
              {
                scenario: "E2E scenario",
                setup: "E2E setup",
                steps: ["Step A"],
                expectedResult: "E2E expected",
                status: "PASS" as const,
              },
            ],
          },
        },
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
    });
  });

  describe("Performance Analysis Plans", () => {
    it("should validate plan with performance field", () => {
      const planData = {
        subject: "Performance Analysis Report",
        description: "Performance optimization assessment",
        performance: {
          executiveSummary: "Performance adequate with opportunities",
          findings: [
            {
              title: "N+1 Query Problem",
              impact: "HIGH" as const,
              category: "Database" as const,
              location: "src/userService.ts:78",
              currentBehavior: "Multiple queries in loop",
              expectedImprovement: "50% query time reduction",
              recommendation: "Use batch queries",
              codeExample: "// Optimize queries",
            },
          ],
          priorities: [
            "Fix N+1 queries",
            "Implement caching",
            "Optimize indexes",
          ],
          scalability: {
            currentCapacity: "100 concurrent users",
            bottleneckPoints: ["Database connections", "Memory"],
            scalingStrategy: "Horizontal scaling with load balancer",
          },
        },
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.performance?.findings?.[0].impact, "HIGH");
        assertEquals(result.data.performance?.priorities?.length, 3);
        assertEquals(result.data.performance?.scalability?.currentCapacity, "100 concurrent users");
      }
    });
  });

  describe("Mixed Agent Types", () => {
    it("should validate plan with both steps and analysis", () => {
      const planData = {
        subject: "Implementation with Analysis",
        description: "Plan that includes both execution steps and analysis",
        steps: [
          {
            step: 1,
            title: "Analyze Codebase",
            description: "Perform code analysis",
          },
        ],
        analysis: {
          totalFiles: 25,
          mainLanguage: "TypeScript",
        },
        estimatedDuration: "2 hours",
        risks: ["Analysis may reveal issues"],
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.steps?.length, 1);
        assertEquals(result.data.analysis?.totalFiles, 25);
        assertEquals(result.data.estimatedDuration, "2 hours");
      }
    });

    it("should validate plan with only specialized fields (no steps)", () => {
      const planData = {
        subject: "Analysis Only Report",
        description: "Report that contains only analysis data",
        security: {
          executiveSummary: "Security assessment complete",
          findings: [],
        },
        performance: {
          executiveSummary: "Performance assessment complete",
        },
      };

      const result = PlanSchema.safeParse(planData);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.steps, undefined);
        assertExists(result.data.security);
        assertExists(result.data.performance);
      }
    });
  });
});
