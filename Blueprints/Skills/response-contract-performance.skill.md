---
id: "550e8400-e29b-41d4-a716-446655440016"
created_at: "2026-07-16T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "response-contract-performance"
name: "Response Contract — Performance Analysis"
version: "1.0.0"
description: "The <content> JSON template for a performance/scalability deliverable (findings, priorities, scalability). Applies alongside response-contract, only for performance-analysis requests."

triggers:
  keywords:
    - "performance"
    - "optimization"
    - "scalability"
  task_types:
    - "performance"
  tags:
    - response-contract
    - performance-analysis

constraints:
  - "A performance-analysis <content> must match this schema, not the executable-plan schema"

output_requirements:
  - "A <content> block containing valid JSON matching the Performance Analysis Report schema"

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Response Contract — Performance Analysis

When the deliverable is a performance/scalability assessment (not an
executable plan), the `<content>` block must match this schema:

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
