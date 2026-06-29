---
id: "550e8400-e29b-41d4-a716-446655440023"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "requirements-analysis"
name: "Requirements Analysis & Specification"
version: "1.0.0"
description: "Framework for translating business needs into clear, actionable technical specifications with user stories, acceptance criteria, and success metrics"

triggers:
  tags:
    - requirements
    - analysis
    - specification
    - user-stories
    - acceptance-criteria

constraints:
  - "Every requirement must be testable — if you cannot write a pass/fail check for it, it is not a requirement"
  - "Separate functional requirements from non-functional constraints explicitly"
  - "Identify assumptions and risks alongside every requirement"

output_requirements:
  - "User stories in standard As a / I want / So that format"
  - "Acceptance criteria in Given / When / Then format"
  - "Success metrics with measurable targets"
  - "Technical requirements with rationale"
  - "Constraints and assumptions"

quality_criteria:
  - name: "Testability"
    description: "Every acceptance criterion is a pass/fail check"
    weight: 40
  - name: "Completeness"
    description: "Functional, non-functional, edge cases, and constraints are all covered"
    weight: 30
  - name: "Traceability"
    description: "Every requirement maps back to a business need or user story"
    weight: 30

compatible_with:
  agents:
    - product-manager
    - "*"
---

# Requirements Analysis & Specification

## Requirements Gathering

- Identify the core problem being solved
- Determine who benefits (user personas)
- Define success metrics
- Uncover implicit requirements
- Identify constraints and limitations

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
