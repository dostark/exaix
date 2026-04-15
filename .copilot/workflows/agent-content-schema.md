---
agent: general
scope: dev
title: "Agent Content Schema Reference"
short_summary: "Standardized JSON schema for agent <content> responses with Zod validation requirements."
version: "1.0"
topics: ["agents", "schema", "json", "validation", "blueprints"]
---

This document defines the standardized JSON schema that all agent blueprints must use in their `<content>` sections. This schema is validated using Zod and ensures consistent, machine-readable output across all agents.

## Overview

All agents must respond with two XML-like tags:

1. `<thought>` - Agent's internal analysis and reasoning (see [agent-thought-standardization.md](agent-thought-standardization.md) for standardized structure)
1. `<content>` - Valid JSON object matching the PlanSchema (see below)

## Required JSON Schema

The `<content>` section must contain **valid JSON** that conforms to this exact structure:

```json
{
  "title": "Plan title (1-300 characters)",
  "description": "Detailed description of what this plan accomplishes",
  "steps": [
    {
      "step": 1,
      "title": "Step title (1-200 characters)",
      "description": "What this step does",
      "actions": [
        {
          "tool": "read_file",
          "params": {
            "path": "path/to/file.ts"
          },
          "description": "Optional description of this specific action"
        }
      ],
      "tools": ["read_file", "write_file", "run_command"],
      "successCriteria": ["Success criterion 1", "Success criterion 2"],
      "dependencies": ["Step 2", "requirements"],
      "rollback": "How to undo this step if needed"
    }
  ],
  "estimatedDuration": "Estimated time (e.g., '2-3 hours', '1 day')",
  "risks": ["Risk 1", "Risk 2", "Risk 3"]
}
```

## Field Requirements

### Required Fields

**title** (string, 1-300 chars)

- Plan summary/goal or report title
- Should be concise but descriptive
- Example: "Implement User Authentication System" or "Security Analysis Report"

**description** (string, min 1 char)

- What the plan/report accomplishes
- Should provide context and scope
- Example: "Add JWT-based authentication with login, registration, and session management"

### Optional Fields (Choose Based on Agent Type)

#### For Execution Plans (steps)

**steps** (array, 1-50 steps)

- Ordered list of execution steps
- Each step must have sequential step numbers (1, 2, 3...)
- Use for agents that create implementation plans

#### For Code Analysis (analysis)

**analysis** (object)

- Use for code analysis and structure examination
- Includes file counts, module analysis, patterns, metrics
- Example fields: totalFiles, modules, patterns, metrics, recommendations

#### For Security Analysis (security)

**security** (object)

- Use for security assessments and vulnerability analysis
- Includes findings with severity levels, remediation steps
- Example fields: findings, recommendations, compliance

#### For QA/Testing (qa)

**qa** (object)

- Use for test planning and quality assurance reports
- Includes test summaries, coverage analysis, issues found
- Example fields: testSummary, coverage, issues

#### For Performance Analysis (performance)

**performance** (object)

- Use for performance optimization and scalability analysis
- Includes performance findings, optimization priorities
- Example fields: findings, priorities, scalability

#### Common Optional Fields

**estimatedDuration** (string)

- Time estimate for completion
- Example: "2-3 hours", "1 week"

**risks** (array of strings)

- Potential issues or challenges
- Example: ["Database performance impact", "Security vulnerabilities"]

- High-level list of tools needed for this step
- Valid values: `"read_file"`, `"write_file"`, `"run_command"`, `"list_directory"`, `"search_files"`, `"create_directory"`

**successCriteria** (array of strings)

- How to verify step completion
- Should be measurable/verifiable
- Example: `["Migration file created with proper indexes", "Schema includes unique constraint on email"]`

**dependencies** (array of strings or integers)

- Step numbers or labels that must complete first
- Enables parallel execution where possible
- Example: `["Step 1", "requirements"]` means those steps must complete before this step

**rollback** (string)

- How to undo this step if needed
- Should be specific and actionable
- Example: "Drop users table and remove migration file"

### Plan-Level Optional Fields

**estimatedDuration** (string)

- Time estimate for plan completion
- Should be realistic and include units
- Example: `"2-3 hours"`, `"1-2 days"`, `"1 week"`

**risks** (array of strings)

- Potential issues or concerns
- Should include mitigation strategies where possible
- Example: `["Database migration conflicts", "Third-party API rate limits"]`

## Action Schema

Actions define specific tool invocations within a step:

```json
{
  "tool": "read_file",
  "params": {
    "path": "src/user.ts",
    "startLine": 1,
    "endLine": 50
  },
  "description": "Read the user model to understand current structure"
}
```

### Supported Tools

- **read_file**: `{"path": "string", "startLine?": "number", "endLine?": "number"}`
- **write_file**: `{"path": "string", "content": "string", "encoding?": "string"}`
- **run_command**: `{"command": "string", "args?": "string[]", "cwd?": "string"}`
- **list_directory**: `{"path": "string"}`
- **search_files**: `{"query": "string", "includePattern?": "string"}`
- **create_directory**: `{"path": "string", "recursive?": "boolean"}`

## Response Format Templates

Choose the appropriate template based on your agent type:

### Execution Plan Template (Default)

```json
{
  "title": "Brief plan title",
  "description": "What this plan accomplishes",
  "steps": [
    {
      "step": 1,
      "title": "First step title",
      "description": "What this step does",
      "actions": [
        {
          "tool": "read_file",
          "params": { "path": "file.ts" },
          "description": "Why this action is needed"
        }
      ],
      "successCriteria": ["How to verify success"],
      "dependencies": ["Step 0"],
      "rollback": "How to undo if needed"
    }
  ],
  "estimatedDuration": "Time estimate",
  "risks": ["Potential issues"]
}
```

### Code Analysis Template

```json
{
  "title": "Codebase Analysis Report",
  "description": "Comprehensive analysis of project structure and patterns",
  "analysis": {
    "totalFiles": 42,
    "linesOfCode": 1250,
    "mainLanguage": "TypeScript",
    "framework": "Deno",
    "directoryStructure": "src/\n├── services/\n├── routes/\n└── utils/",
    "modules": [
      {
        "name": "auth.ts",
        "purpose": "Authentication service",
        "exports": ["login", "logout"],
        "dependencies": ["jwt", "users"]
      }
    ],
    "patterns": [
      {
        "pattern": "Repository",
        "location": "src/repos/",
        "usage": "Data access abstraction"
      }
    ],
    "metrics": [
      {
        "metric": "Cyclomatic Complexity (avg)",
        "value": 3.2,
        "assessment": "Good"
      }
    ],
    "recommendations": [
      "Consider adding more unit tests",
      "Refactor large functions into smaller ones"
    ]
  }
}
```

### Security Analysis Template

```json
{
  "title": "Security Analysis Report",
  "description": "Security assessment and vulnerability analysis",
  "security": {
    "executiveSummary": "Overall security posture is good with minor issues",
    "findings": [
      {
        "title": "SQL Injection Vulnerability",
        "severity": "HIGH",
        "location": "src/database.ts:45",
        "description": "User input not properly sanitized",
        "impact": "Potential data breach",
        "remediation": "Use parameterized queries",
        "codeExample": "// Before: query('SELECT * FROM users WHERE id = ' + userId)\n// After: query('SELECT * FROM users WHERE id = ?', [userId])"
      }
    ],
    "recommendations": [
      "Implement input validation middleware",
      "Add security headers",
      "Regular security audits"
    ],
    "compliance": [
      "OWASP Top 10 compliance: 8/10",
      "GDPR considerations addressed"
    ]
  }
}
```

### QA/Testing Template

```json
{
  "title": "QA Assessment Report",
  "description": "Quality assurance and testing strategy analysis",
  "qa": {
    "testSummary": [
      {
        "category": "Integration",
        "planned": 15,
        "executed": 15,
        "passed": 13,
        "failed": 2
      }
    ],
    "coverage": {
      "integration": [
        {
          "scenario": "User registration flow",
          "setup": "Clean database",
          "steps": ["Navigate to register", "Fill form", "Submit"],
          "expectedResult": "User created successfully",
          "status": "PASS",
          "notes": "All fields validated correctly"
        }
      ]
    },
    "issues": [
      {
        "title": "Form validation bypass",
        "severity": "High",
        "component": "RegistrationForm",
        "stepsToReproduce": ["Submit empty form", "Check if error shown"],
        "description": "Client-side validation can be bypassed"
      }
    ]
  }
}
```

### Performance Analysis Template

```json
{
  "title": "Performance Analysis Report",
  "description": "Performance optimization and scalability assessment",
  "performance": {
    "executiveSummary": "Application performance is adequate with optimization opportunities",
    "findings": [
      {
        "title": "N+1 Query Problem",
        "impact": "HIGH",
        "category": "Database",
        "location": "src/userService.ts:78",
        "currentBehavior": "Multiple individual queries in loop",
        "expectedImprovement": "50% reduction in query time",
        "recommendation": "Use batch queries or eager loading",
        "codeExample": "// Before: for(user of users) { getUserDetails(user.id) }\n// After: getAllUserDetails(userIds)"
      }
    ],
    "priorities": [
      "Fix N+1 query issues",
      "Implement caching for frequently accessed data",
      "Optimize database indexes"
    ],
    "scalability": {
      "currentCapacity": "100 concurrent users",
      "bottleneckPoints": ["Database connection pool", "Memory usage"],
      "scalingStrategy": "Horizontal scaling with load balancer"
    }
  }
}
```

## Zod Validation

All JSON responses are validated against `PlanSchema` from `src/schemas/plan_schema.ts`:

```typescript
import { PlanSchema } from "../schemas/plan_schema.ts";

// Validation
const result = PlanSchema.parse(jsonContent);
```

## Examples

### Simple Plan (Minimal Fields)

```json
{
  "title": "Add Error Logging",
  "description": "Implement basic error logging functionality",
  "steps": [
    {
      "step": 1,
      "title": "Create Logger Module",
      "description": "Create a new logger.ts file with error logging functions"
    }
  ]
}
```

### Complex Plan (All Fields)

```json
{
  "title": "Implement Real-Time Notification System",
  "description": "Add WebSocket-based real-time notifications with persistent storage, UI components, and comprehensive error handling",
  "steps": [
    {
      "step": 1,
      "title": "Database Schema Migration",
      "description": "Create notifications table with user_id, type, message, read status, and timestamps. Add indexes for efficient querying.",
      "tools": ["write_file"],
      "actions": [
        {
          "tool": "write_file",
          "params": {
            "path": "migrations/001_notifications.sql",
            "content": "CREATE TABLE notifications (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_id UUID NOT NULL,\n  type TEXT NOT NULL,\n  message TEXT NOT NULL,\n  is_read BOOLEAN DEFAULT false,\n  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()\n);\nCREATE INDEX idx_notifications_user_id ON notifications(user_id);"
          }
        }
      ],
      "successCriteria": [
        "Migration file created with proper indexes",
        "Supports notification types: info, warning, error, success",
        "Includes created_at and read_at timestamps"
      ],
      "dependencies": [],
      "rollback": "DROP TABLE notifications; DELETE migration file"
    },
    {
      "step": 2,
      "title": "WebSocket Server Implementation",
      "description": "Implement WebSocket server with authentication, connection management, and message broadcasting",
      "tools": ["write_file", "run_command"],
      "successCriteria": [
        "WebSocket server accepts authenticated connections",
        "Messages are broadcast to relevant users",
        "Connection cleanup on disconnect"
      ],
      "dependencies": [1],
      "rollback": "Remove WebSocket server files and dependencies"
    }
  ],
  "estimatedDuration": "3-4 days",
  "risks": [
    "WebSocket connection scaling issues",
    "Database performance with high notification volume",
    "Browser compatibility with older WebSocket implementations"
  ]
}
```

## Migration Notes

When migrating from markdown to JSON format:

1. **Preserve `<thought>` section** - Keep agent reasoning unchanged
1. **Convert markdown structure** - Transform sections into JSON fields
1. **Map content appropriately** - Use `title`, `description`, and `steps` to represent the same information
1. **Add actions for automation** - Include specific tool invocations where possible
1. **Validate thoroughly** - Ensure JSON passes Zod validation

## Reference

- **Schema Implementation**: `src/schemas/plan_schema.ts`
- **Zod Validation**: `PlanSchema.parse(jsonContent)`
- **Tool Definitions**: `src/enums.ts` (McpToolName)
- **Migration Guide**: `.copilot/planning/phase-31-agent-blueprint-json-migration.md`
