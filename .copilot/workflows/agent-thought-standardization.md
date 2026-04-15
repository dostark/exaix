---
agent: general
scope: dev
title: Agent Thought Section Standardization
short_summary: "Standardized structure for agent <thought> sections to ensure consistent reasoning patterns across all blueprints."
version: "0.1"
topics: ["agents", "reasoning", "standardization", "thought-structure"]
---

## Agent Thought Section Standardization

### Purpose

Standardize the `<thought>` section across all agent blueprints to ensure consistent reasoning patterns, improve readability, and facilitate automated processing of agent outputs.

### Current State

Currently, `<thought>` sections vary in structure and content across different agents. While all describe "internal analysis and reasoning," the format and depth of reasoning differ significantly between agents.

### Standardized Structure

All agent `<thought>` sections MUST follow this structured format:

```xml
<thought>
## Problem Analysis
[Brief summary of the user's request and core problem to solve]

## Context Assessment
[Relevant context from codebase, requirements, constraints]

## Solution Approach
[High-level strategy and methodology to address the problem]

## Key Considerations
[Important factors: technical constraints, edge cases, dependencies]

## Implementation Strategy
[Step-by-step reasoning for how to execute the solution]

## Risk Assessment
[Potential issues, failure modes, mitigation strategies]
</thought>
```

### Section Details

#### Problem Analysis

- **Purpose**: Clearly restate and confirm understanding of the user's request
- **Content**: 1-3 sentences summarizing the core problem
- **Example**: "The user wants to implement user authentication with JWT tokens and role-based access control."

#### Context Assessment

- **Purpose**: Identify relevant codebase context, existing patterns, and constraints
- **Content**: Reference existing code, configurations, or architectural decisions
- **Example**: "The project uses Deno with Oak framework. Existing auth patterns in src/auth/ should be followed."

#### Solution Approach

- **Purpose**: Outline the high-level strategy
- **Content**: Methodology, frameworks, or patterns to use
- **Example**: "Implement JWT authentication using deno-jwt library with middleware pattern."

#### Key Considerations

- **Purpose**: Highlight important technical or business factors
- **Content**: Security requirements, performance needs, compatibility issues
- **Example**: "Must handle token expiration, refresh tokens, and secure storage of secrets."

#### Implementation Strategy

- **Purpose**: Detail the execution plan
- **Content**: Specific steps, tools, and order of operations
- **Example**: "1. Create JWT service, 2. Add auth middleware, 3. Update routes, 4. Add tests."

#### Risk Assessment

- **Purpose**: Identify potential issues and mitigation
- **Content**: Failure scenarios and prevention strategies
- **Example**: "Risk: Token leakage. Mitigation: Use HTTPS only, implement token blacklisting."

### Benefits

1. **Consistency**: All agents follow the same reasoning structure

1.
1.
1.

### Migration Plan

#### Phase 31.5: Thought Section Standardization

1. **Update all agent blueprints** to use the standardized `<thought>` structure

1.
1.

#### Implementation Steps

1. Review current `<thought>` sections across all 18+ agent files

1.
1.

### Examples

#### Before (Unstructured)

```xml
<thought>
The user wants to add logging. I need to check what logging library is used. Probably need to add log statements in key places. Make sure not to log sensitive data.
</thought>
```

#### After (Structured)

```xml
<thought>
## Problem Analysis
User wants to implement comprehensive logging for error tracking and debugging.

## Context Assessment
Project uses Deno with std/log. Existing logging patterns in src/utils/logger.ts should be extended.

## Solution Approach
Add structured logging with different levels (info, warn, error) throughout the application.

## Key Considerations

- Don't log sensitive data (passwords, tokens)
- Use appropriate log levels
- Include contextual information (user ID, request ID)

## Implementation Strategy

1. Review existing logger utility

1.
1.

## Risk Assessment
Risk: Performance impact from excessive logging. Mitigation: Use async logging and configurable levels.
</thought>
```

### Validation

- **Automated**: Regex patterns can validate section presence
- **Manual**: Code review ensures reasoning quality
- **Testing**: Agent outputs should demonstrate structured thinking

### Do / Don't

- ✅ **Do** use all required sections in order
- ✅ **Do** provide specific, actionable content in each section
- ✅ **Do** keep reasoning clear and logical
- ❌ **Don't** skip sections unless truly not applicable
- ❌ **Don't** use generic placeholders
- ❌ **Don't** make sections too verbose (>500 words total)
