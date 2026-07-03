---
id: "550e8400-e29b-41d4-a716-446655440012"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "response-contract"
name: "Response Output Contract"
version: "1.0.0"
description: "The mandatory <thought>/<content> response format and executable-plan JSON contract every agent must emit."
critical: true

triggers:
  tags:
    - response-contract
    - output-format

constraints:
  - "Respond with exactly a <thought> block and a <content> block; ignore everything outside them"
  - "<content> must be a single valid, self-contained JSON object with no surrounding commentary"
  - "A plan's content must match the executable-plan JSON schema (title, description, steps[])"

output_requirements:
  - "A <thought> block with reasoning and tool-selection logic"
  - "A <content> block containing valid JSON for the requested deliverable"

quality_criteria:
  - name: "Contract Compliance"
    description: "Output has both tags and a valid JSON content block"
    weight: 60
  - name: "Self-Containment"
    description: "The content JSON parses standalone with no extra prose"
    weight: 40

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Response Output Contract

You MUST respond with exactly two sections, each wrapped in XML-like tags. Any
text outside these tags is ignored.

1. `<thought>` — Your internal analysis: reasoning, plan breakdown, architectural
   decisions, and tool-selection logic. Not parsed as structured data.

2. `<content>` — Your deliverable. For a plan this MUST be a single valid JSON
   object matching the executable-plan schema; for an analysis or evaluation, the
   structured object the task asks for. The `<content>` block is extracted and
parsed by the runtime, so it must be valid, self-contained, and free of
commentary.

## Agent Thought Standardization

The `<thought>` block must follow this structured format — not free-form prose:

```xml
<thought>
## Problem Analysis
[Brief summary of the user's request and core problem to solve]

## Context Assessment
[Relevant context from codebase, requirements, constraints]

## Solution Approach
[High-level strategy and methodology to address the problem]

## Key Considerations
[Important factors: technical constraints, edge cases, dependencies]

## Implementation Strategy
[Step-by-step reasoning for how to execute the solution]

## Risk Assessment
[Potential issues, failure modes, mitigation strategies]
</thought>
```

### Section details

| Section | Purpose | Content |
|---|---|---|
| Problem Analysis | Confirm understanding | 1-3 sentences summarizing the core problem |
| Context Assessment | Identify relevant context | Reference existing code, patterns, constraints |
| Solution Approach | Outline strategy | Methodology, frameworks, patterns |
| Key Considerations | Highlight factors | Security, performance, compatibility |
| Implementation Strategy | Detail execution | Specific steps, tools, order |
| Risk Assessment | Identify issues | Failure scenarios, mitigation |

## Executable-plan JSON schema

```json
{
  "title": "Short descriptive title (required)",
  "description": "What this plan accomplishes (required)",
  "steps": [
    {
      "step": 1,
      "title": "Step name (required)",
      "description": "What this step performs (required)",
      "tools": ["read_file", "write_file"],
      "actions": [
        { "tool": "write_file", "params": { "path": "src/...", "content": "..." } }
      ],
      "successCriteria": ["A verifiable check"],
      "dependencies": [],
      "rollback": "How to undo this step"
    }
  ],
  "estimatedDuration": "e.g. 2-3 hours",
  "risks": ["Potential issue"]
}
```

## Additional response-type templates

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
    "directoryStructure": "src/\\n├── services/\\n├── routes/\\n└── utils/",
    "modules": [
      { "name": "auth.ts", "purpose": "Authentication service", "exports": ["login", "logout"], "dependencies": ["jwt", "users"] }
    ],
    "patterns": [
      { "pattern": "Repository", "location": "src/repos/", "usage": "Data access abstraction" }
    ],
    "metrics": [
      { "metric": "Cyclomatic Complexity (avg)", "value": 3.2, "assessment": "Good" }
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
        "codeExample": "// Before: query('SELECT * FROM users WHERE id = ' + userId)\\n// After: query('SELECT * FROM users WHERE id = ?', [userId])"
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
      { "category": "Integration", "planned": 15, "executed": 15, "passed": 13, "failed": 2 }
    ],
    "coverage": {
      "integration": [
        {
          "scenario": "User registration flow", "setup": "Clean database",
          "steps": ["Navigate to register", "Fill form", "Submit"],
          "expectedResult": "User created successfully", "status": "PASS"
        }
      ]
    },
    "issues": [
      {
        "title": "Form validation bypass", "severity": "High",
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
        "title": "N+1 Query Problem", "impact": "HIGH", "category": "Database",
        "location": "src/userService.ts:78",
        "currentBehavior": "Multiple individual queries in loop",
        "expectedImprovement": "50% reduction in query time",
        "recommendation": "Use batch queries or eager loading"
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

## Minimal example

```xml
<thought>
The request asks to add input validation. I will add a boundary schema check and
a rejection test.
</thought>

<content>
{
  "title": "Add input validation to the request handler",
  "description": "Validate the request body with a schema at the entry point.",
  "steps": [
    {
      "step": 1,
      "title": "Add boundary validation",
      "description": "Parse and reject malformed input before business logic.",
      "tools": ["read_file", "write_file"],
      "successCriteria": ["Invalid input is rejected", "A rejection test passes"]
    }
  ]
}
</content>
```
