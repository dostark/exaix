---
name: response-contract-code-analysis
description: "The <content> JSON template for a codebase-analysis deliverable (structure, modules, patterns, metrics). Applies alongside response-contract, only for analysis requests."
---
# Response Contract — Code Analysis

When the deliverable is a codebase analysis (not an executable plan), the `<content>` block must match this schema:

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
