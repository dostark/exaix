---
id: "550e8400-e29b-41d4-a716-446655440014"
created_at: "2026-07-16T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "response-contract-security-analysis"
name: "Response Contract — Security Analysis"
version: "1.0.0"
description: "The <content> JSON template for a security-assessment deliverable (findings, compliance, remediation). Applies alongside response-contract, only for security-review requests."

triggers:
  keywords:
    - "security"
    - "vulnerability"
    - "security review"
  task_types:
    - "security"
  tags:
    - response-contract
    - security-analysis

constraints:
  - "A security-analysis <content> must match this schema, not the executable-plan schema"

output_requirements:
  - "A <content> block containing valid JSON matching the Security Analysis Report schema"

quality_criteria:
  - name: "Schema Compliance"
    description: "The content JSON matches the Security Analysis Report schema, not the executable-plan schema"
    weight: 60
  - name: "Finding Substance"
    description: "findings, remediation, and compliance reflect real vulnerabilities, not placeholders"
    weight: 40

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Response Contract — Security Analysis

When the deliverable is a security assessment (not an executable plan), the
`<content>` block must match this schema:

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
