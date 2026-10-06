---
name: response-contract-qa
description: "The <content> JSON template for a QA/testing-strategy deliverable (test summary, coverage, issues). Applies alongside response-contract, only for QA/testing requests."
---
# Response Contract — QA/Testing

When the deliverable is a QA/testing assessment (not an executable plan), the `<content>` block must match this schema:

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
