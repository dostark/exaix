---
id: "550e8400-e29b-41d4-a716-446655440022"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "performance-analysis"
name: "Performance Analysis & Optimization"
version: "1.0.0"
description: "Framework for identifying performance bottlenecks and recommending optimizations across algorithm, database, memory, I/O, and concurrency domains"

triggers:
  tags:
    - performance
    - optimization
    - profiling
    - bottleneck
    - scalability

constraints:
  - "Always profile before optimizing — never guess at bottlenecks"
  - "Recommend regression benchmarks alongside every optimisation"
  - "Prefer algorithmic improvements over micro-optimisations"

output_requirements:
  - "Bottleneck identification with impact severity (HIGH/MEDIUM/LOW)"
  - "Current-behaviour vs expected-improvement for each finding"
  - "Prioritised recommendation list with estimated effort"

quality_criteria:
  - name: "Evidence-Based"
    description: "Every bottleneck claim is supported by profiler data, benchmarks, or code analysis"
    weight: 40
  - name: "Actionability"
    description: "Each recommendation includes a concrete code- or config-level change"
    weight: 30
  - name: "Regression Safety"
    description: "Optimisations are paired with regression benchmarks to prevent silent regressions"
    weight: 30

compatible_with:
  agents:
    - performance-engineer
    - "*"
---
# Performance Analysis & Optimization

## 1. Algorithmic Efficiency
- Identify O(n²) or worse loops
- Check for unnecessary iterations
- Review data structure choices
- Assess recursion-depth risks

## 2. Database Performance
- Identify N+1 query patterns
- Review index usage
- Check for missing pagination
- Assess query complexity

## 3. Memory Management
- Detect memory leaks
- Review object lifecycle
- Check for excessive allocations
- Assess buffer sizing

## 4. I/O Efficiency
- Identify blocking operations
- Review async/await usage
- Check for unnecessary network calls
- Assess file handling

## 5. Concurrency
- Review thread safety
- Check for race conditions
- Assess parallelisation opportunities
- Evaluate connection pooling

## Impact Definitions

| Impact | Description            | Performance Gain |
|--------|------------------------|------------------|
| HIGH   | Critical path opt.     | >50% improvement   |
| MEDIUM | Noticeable improvement | 10-50% improvement |
| LOW    | Minor optimisation     | <10% improvement   |
