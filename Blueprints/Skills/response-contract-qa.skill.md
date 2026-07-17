---
id: "550e8400-e29b-41d4-a716-446655440015"
created_at: "2026-07-16T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "response-contract-qa"
name: "Response Contract — QA/Testing"
version: "1.0.0"
description: "The <content> JSON template for a QA/testing-strategy deliverable (test summary, coverage, issues). Applies alongside response-contract, only for QA/testing requests."

triggers:
  keywords:
    - "qa"
    - "test plan"
    - "testing strategy"
  task_types:
    - "qa"
    - "testing"
  tags:
    - response-contract
    - qa

constraints:
  - "A QA <content> must match this schema, not the executable-plan schema"

output_requirements:
  - "A <content> block containing valid JSON matching the QA Assessment Report schema"

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Response Contract — QA/Testing

When the deliverable is a QA/testing assessment (not an executable plan), the
`<content>` block must match this schema:

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
          "scenario": "User registration flow",
          "setup": "Clean database",
          "steps": ["Navigate to register", "Fill form", "Submit"],
          "expectedResult": "User created successfully",
          "status": "PASS"
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
