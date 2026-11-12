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

## Interface Depth and Locality

- **Depth** — a module hides necessary complexity behind a small interface. Deep is good; a pass-through is shallow. A deep module is not a large module.
- **Locality** — related decisions sit in one place, so a caller learns one concept, not many.
- **Caller complexity** — count what a caller must know: parameters, call ordering, error handling, and required setup. A design that moves work into callers is worse even when its own methods get smaller.
- **Deletion question** — if the module vanished, would its necessary complexity spread across its callers? If yes, keep it and deepen it.
- **Size is not a verdict.** Fewer methods, parameters, or classes do not by themselves prove a better interface.

## Comparing Interface Designs

For a material interface choice, compare the current design and two feasible alternatives. For each option show:

- one representative caller;
- one failure or denied path;
- invariants the caller must preserve;
- error behavior and call ordering;
- hidden complexity and what the caller must still know;
- dependency strategy (constructor injection, adapters);
- the boundary a test observes.

Recommend one option and state which evidence supports it.

## Boundaries

- Depth and locality are heuristics. Security contracts, required dependency injection, and existing test evidence take precedence.
- A thin permission or governance adapter is not a middle-man defect. Keep it when it enforces a boundary, even when every method delegates.
- Do not invoke parallel agents or delete tests because a deeper interface is proposed.

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
