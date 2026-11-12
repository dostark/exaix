---
name: code-review
description: "Comprehensive checklist for thorough code reviews"
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

```typescript
// Check for edge cases like:
// - Empty arrays/strings
// - Null/undefined values
// - Maximum/minimum values
// - Concurrent access
```

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
- [ ] **Assertion meaning** - Check equality, identity, negative checks, messages, and call order and count.
- [ ] **Failure output** - Check that useful values appear without changing semantics.
- [ ] **State and constants** - Preserve stateful calls and test constants through consumers or independent contracts.
- [ ] **Fixtures** - Check the project's fixture and ownership policy for structured data.
- [ ] **Edge cases** - Are edge cases tested?
- [ ] **Test independence** - Do tests run independently?
- [ ] **No count pins** - Do tests avoid literal sizes of registries, corpora, and ceilings?

## 8. Documentation

- [ ] **Code comments** - Complex logic explained?
- [ ] **API documentation** - Public interfaces documented?
- [ ] **README updates** - Setup/usage docs current?
- [ ] **Changelog** - Notable changes documented?

## Review Scope and Findings

### Scope

- Name the base and target revisions.
- State which working changes are included, and which are excluded.
- Note out-of-scope findings; do not fix them.

### Two axes

Report these separately. Never merge them.

- **Specification compliance** — does the code meet the stated requirement?
- **Standards compliance** — does the code follow documented repository rules and general quality standards?

If no specification exists, report specification compliance as **unverified**. Do not infer a pass from a clean standards review.

### Finding record

Every finding carries:

- a stable id (`SPEC-01`, `STD-01`);
- the axis: specification or standards;
- the class: violation or heuristic;
- the severity: critical, major, minor, or suggestion;
- the cited requirement or documented rule;
- the observed revision and hunk evidence;
- proposed resolution, response, and recheck result.

Class and severity are independent. A minor violation is still a violation; a major preference is still a heuristic.

A documented repository rule overrides a generic smell. Without a violated rule, a preference is a suggestion, not a mandatory fix.

### Recheck and closure

- A finding stays open until recheck evidence shows the fix on a named revision.
- An implementer's claim alone does not close a finding.
- A new target revision requires a recheck of every affected finding.
- Stay read-only unless fixes are authorized. Do not spawn agents.

## Feedback Guidelines

**Be Specific:**

```text
// ❌ Vague
"This could be better"

// ✅ Specific
"Consider using a Map instead of Array.find() here for O(1) lookup"
```

**Be Constructive:**

```text
// ❌ Critical without solution
"This is wrong"

// ✅ Constructive
"This might throw if users is empty. Consider adding a guard clause"
```

**Prioritize Issues:**

Severity does not replace the finding class; record the axis and class from Review Scope and Findings.

- 🔴 **Critical** - Must fix (security, data loss, crashes)
- 🟠 **Major** - Should fix (bugs, significant issues)
- 🟡 **Minor** - Nice to fix (style, minor improvements)
- 💭 **Suggestion** - Optional (alternative approaches)
