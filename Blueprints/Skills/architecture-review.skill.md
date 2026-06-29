---
id: "550e8400-e29b-41d4-a716-446655440021"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "architecture-review"
name: "Architecture Review & Design"
version: "1.0.0"
description: "Systematic architecture evaluation, design principles, and quality-attribute analysis"

triggers:
  tags:
    - architecture
    - design
    - system-design
    - review
    - architecture-review

constraints:
  - "Evaluate against SOLID principles and quality attributes"
  - "Map current state and target state with a migration plan"
  - "Consider backward compatibility in every design change"

output_requirements:
  - "Current-state assessment with pain points and technical debt"
  - "Target architecture with required changes"
  - "Migration path with backward compatibility considerations"
  - "Quality-attribute trade-off analysis (scalability, maintainability, testability, security, performance, reliability)"

quality_criteria:
  - name: "SOLID Compliance"
    description: "Design follows Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion"
    weight: 30
  - name: "Quality Attribute Coverage"
    description: "All relevant quality attributes (scalability, maintainability, testability, security, performance, reliability) are addressed"
    weight: 30
  - name: "Migration Realism"
    description: "The migration path is practical, incremental, and considers backward compatibility"
    weight: 40

compatible_with:
  agents:
    - software-architect
    - "*"
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
