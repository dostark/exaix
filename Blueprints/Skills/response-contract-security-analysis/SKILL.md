---
name: response-contract-security-analysis
description: "The <content> JSON template for a security-assessment deliverable (findings, compliance, remediation). Applies alongside response-contract, only for security-review requests."
---
# Response Contract — Security Analysis

When the deliverable is a security assessment (not an executable plan), the `<content>` block must match this schema:

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
