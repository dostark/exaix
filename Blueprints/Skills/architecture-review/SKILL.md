---
name: architecture-review
description: "Systematic architecture evaluation, design principles, and quality-attribute analysis"
---
# Architecture Review & Design

## SOLID Principles

- **S**ingle Responsibility — each component has one reason to change
- **O**pen/Closed — open for extension, closed for modification
- **L**iskov Substitution — subtypes are substitutable for their base types
- **I**nterface Segregation — small, focused interfaces over large, general ones
- **D**ependency Inversion — depend on abstractions, not concretions

## Quality Attributes

- **Scalability** — horizontal and vertical scaling capabilities
- **Maintainability** — ease of understanding and modification
- **Testability** — designed for automated testing
- **Security** — defence in depth
- **Performance** — latency and throughput requirements
- **Reliability** — fault tolerance and recovery

## Analysis Framework

### Current State Assessment

- Identify existing components and their responsibilities
- Map dependencies and data flows
- Evaluate current pain points
- Assess technical debt

### Future State Design

- Define target architecture
- Identify required changes
- Plan migration path
- Consider backward compatibility
