---
name: requirements-analysis
description: "Framework for translating business needs into clear, actionable technical specifications with user stories, acceptance criteria, and success metrics"
---

# Requirements Analysis & Specification

## Requirements Gathering

- Identify the core problem being solved
- Determine who benefits (user personas)
- Define success metrics
- Uncover implicit requirements
- Identify constraints and limitations

## Resolve material uncertainty

Read the request, project terminology, relevant configuration, and accepted
decisions before asking questions. Use complete acceptance criteria directly. Do
not interview the user for facts already available.

Use this loop for material uncertainty:

1. List the unresolved decisions and their dependencies. Distinguish facts,
   agreed decisions, and assumptions.
1. Resolve facts from available project evidence. Identify the remaining
   decision with the greatest effect on dependent requirements.
1. For an overloaded term, use a concrete scenario to distinguish its meanings.
   Record the agreed meaning before specifying its behavior.
1. Ask one concise question for a choice only the user can make. Give a
   recommendation and meaningful tradeoffs when evidence supports them.
   Combine dependent aspects of one product decision into a single question.
   Do not ask the user for an implementation detail that can be resolved during design.
1. Record the answer and update dependent assumptions and acceptance criteria.
   Mark any invalidated assumption or criterion as stale until revised.
1. Stop discovery when the remaining uncertainty cannot change the required
   behavior. Do not reopen settled choices without new conflicting evidence.

If a material question remains unanswered, write `PENDING USER DECISION` in the
reviewable requirements artifact. Include the question, affected assumptions,
and unresolved acceptance criteria. Continue only work that does not depend on
that answer. Do not invent a decision or mark its dependent criteria resolved.

After a later answer, create an updated requirements artifact that identifies
the earlier pending record and revises the affected criteria. This skill does
not provide automatic flow pause or resumption.

## Record decisions and terminology

Keep ordinary decisions in the current requirements artifact. Include:

- The problem, scope, exclusions, and measurable success criteria.
- Agreed terms and a concrete scenario that determines their acceptance
  criteria.
- Decisions, their rationale and dependencies, and open or invalidated
  assumptions.
- Testable acceptance criteria, with unresolved criteria clearly identified.

Propose an Architecture Decision Record (ADR) only for a consequential tradeoff.
It must be hard to reverse and surprising without its rationale. Include the
alternatives, recommendation or accepted choice, and rationale. Follow the
project's existing artifact approval rules. A reversible label choice stays in
the requirements record. Do not create an ADR or glossary hierarchy
automatically.

## User Story Format

```text
As a [user type],
I want [capability/feature],
So that [benefit/value].
```

## Acceptance Criteria (Given-When-Then)

```text
Given [precondition],
When [action],
Then [expected result].
```

## Quality Checklist

- [ ] All user stories follow standard format
- [ ] Acceptance criteria are testable
- [ ] Scope is clearly defined
- [ ] Priorities are assigned
- [ ] Dependencies are identified
- [ ] Success metrics are measurable
- [ ] Edge cases are considered
