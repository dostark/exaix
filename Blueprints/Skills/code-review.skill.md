---
id: "550e8400-e29b-41d4-a716-446655440003"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "code-review"
name: "Code Review Checklist"
version: "1.0.0"
description: "Comprehensive checklist for thorough code reviews"

triggers:
  keywords:
    - review
    - code-review
    - pr
    - pull-request
    - merge
    - feedback
    - critique
    - evaluate
  task_types:
    - review
    - code-review
    - pull-request
  file_patterns:
    - "*"
  tags:
    - review
    - quality

constraints:
  - "Be constructive and specific in feedback"
  - "Suggest improvements, not just identify problems"
  - "Consider the context and constraints"
  - "Focus on important issues, not style nitpicks"

output_requirements:
  - "Clear summary of findings"
  - "Categorized issues (critical, major, minor)"
  - "Specific suggestions for improvement"

quality_criteria:
  - name: "Thoroughness"
    description: "All aspects of the code are reviewed"
    weight: 30
  - name: "Actionability"
    description: "Feedback is specific and actionable"
    weight: 40
  - name: "Constructiveness"
    description: "Feedback is helpful and respectful"
    weight: 30

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Code Review Checklist

Review code with this systematic approach.

## 1. Understand the Context

Before reviewing code:

- [ ] Read the PR description and linked issues
- [ ] Understand the requirements being addressed
- [ ] Consider the broader system context

## 2. Functionality Review

- [ ] **Does it work?** - Logic correctly implements requirements
- [ ] **Edge cases** - Are boundary conditions handled?
- [ ] **Error handling** - Are errors caught and handled appropriately?
- [ ] **Input validation** - Are inputs validated before use?

````typescript
// Check for edge cases like:
// - Empty arrays/strings
// - Null/undefined values
// - Maximum/minimum values
// - Concurrent access
```text

## 3. Code Quality

- [ ] **Readability** - Is the code easy to understand?
- [ ] **Naming** - Are variables, functions, classes well-named?
- [ ] **Complexity** - Is the code unnecessarily complex?
- [ ] **DRY** - Is there code duplication that should be extracted?
- [ ] **SOLID** - Does it follow SOLID principles where applicable?

## 4. Architecture & Design

- [ ] **Design patterns** - Are appropriate patterns used?
- [ ] **Separation of concerns** - Is responsibility properly distributed?
- [ ] **Dependencies** - Are dependencies appropriate and minimal?
- [ ] **Coupling** - Is coupling appropriately loose?

## 5. Performance

- [ ] **Efficiency** - Any obvious performance issues?
- [ ] **Database queries** - N+1 queries? Missing indexes?
- [ ] **Memory usage** - Any memory leaks or excessive allocations?
- [ ] **Caching** - Should results be cached?

## 6. Security

- [ ] **Input validation** - All user inputs validated?
- [ ] **Authentication/Authorization** - Proper access controls?
- [ ] **Data protection** - Sensitive data handled correctly?
- [ ] **Injection risks** - SQL, XSS, command injection protected?

## 7. Testing

- [ ] **Test coverage** - Are new features tested?
- [ ] **Test quality** - Do tests verify behavior, not implementation?
- [ ] **Edge cases** - Are edge cases tested?
- [ ] **Test independence** - Do tests run independently?

## 8. Documentation

- [ ] **Code comments** - Complex logic explained?
- [ ] **API documentation** - Public interfaces documented?
- [ ] **README updates** - Setup/usage docs current?
- [ ] **Changelog** - Notable changes documented?

## Feedback Guidelines

**Be Specific:**

```text
// ❌ Vague
"This could be better"

// ✅ Specific
"Consider using a Map instead of Array.find() here for O(1) lookup"
```text

**Be Constructive:**

```text
// ❌ Critical without solution
"This is wrong"

// ✅ Constructive
"This might throw if users is empty. Consider adding a guard clause"
```text

**Prioritize Issues:**

- 🔴 **Critical** - Must fix (security, data loss, crashes)
- 🟠 **Major** - Should fix (bugs, significant issues)
- 🟡 **Minor** - Nice to fix (style, minor improvements)
- 💭 **Suggestion** - Optional (alternative approaches)
````
