---
name: performance-analysis
description: "Framework for identifying performance bottlenecks and recommending optimizations across algorithm, database, memory, I/O, and concurrency domains"
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

| Impact | Description            | Performance Gain   |
| ------ | ---------------------- | ------------------ |
| HIGH   | Critical path opt.     | >50% improvement   |
| MEDIUM | Noticeable improvement | 10-50% improvement |
| LOW    | Minor optimisation     | <10% improvement   |
