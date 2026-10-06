---
name: response-contract-performance
description: "The <content> JSON template for a performance/scalability deliverable (findings, priorities, scalability). Applies alongside response-contract, only for performance-analysis requests."
---
# Response Contract — Performance Analysis

When the deliverable is a performance/scalability assessment (not an executable plan), the `<content>` block must match this schema:

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
