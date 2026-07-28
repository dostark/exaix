---
id: "550e8400-e29b-41d4-a716-446655440013"
created_at: "2026-07-16T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "response-contract-code-analysis"
name: "Response Contract — Code Analysis"
version: "1.0.0"
description: "The <content> JSON template for a codebase-analysis deliverable (structure, modules, patterns, metrics). Applies alongside response-contract, only for analysis requests."
critical: true

triggers:
  keywords:
    - "analyze"
    - "analysis"
    - "codebase structure"
  task_types:
    - "analysis"
  tags:
    - response-contract
    - code-analysis

constraints:
  - "A codebase-analysis <content> must match this schema, not the executable-plan schema"

output_requirements:
  - "A <content> block containing valid JSON matching the Code Analysis Report schema"

quality_criteria:
  - name: "Schema Compliance"
    description: "The content JSON matches the Code Analysis Report schema, not the executable-plan schema"
    weight: 60
  - name: "Analysis Substance"
    description: "modules, patterns, and recommendations reflect the actual codebase, not placeholders"
    weight: 40

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Response Contract — Code Analysis

When the deliverable is a codebase analysis (not an executable plan), the
`<content>` block must match this schema:

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
      {
        "name": "auth.ts",
        "purpose": "Authentication service",
        "exports": ["login", "logout"],
        "dependencies": ["jwt", "users"]
      }
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
