---
agent: general
scope: dev
title: "Implement Feature Step Template (#step)"
description: Implement one step from a phase planning document using TDD red-green-refactor cycle
short_summary: "Template for implementing individual steps from a feature plan with TDD and validation."
version: "0.1"
topics: ["implementation", "tdd", "steps", "validation"]
---

```text
Key points
- Restate step context from feature plan
- Write/update tests first (TDD approach)
- Implement minimal code to pass tests
- Ensure linting clean and success criteria met
- Document decisions and validate before returning

Canonical prompt (short):
"Implement this specific step from the feature plan. Write tests first, implement minimally, validate all criteria, then document."

Examples
- Example prompt: "Implement Step 3.2: Add user authentication validation."
- Example prompt: "Complete the database schema migration step with tests."

Do / Don't
- ✅ Do write tests before implementation
- ✅ Do verify all planned tests pass
- ✅ Do ensure linting and formatting clean
- ✅ Do meet all success criteria
- ❌ Don't implement without tests
- ❌ Don't return until validation complete
- ❌ Don't skip documentation

Related templates:
- #plan — Create the feature plan with steps
- #fix — Fix bugs discovered during implementation
- #test — Add additional tests if needed
- ...
```

**Implementation:**

- ...

**Validation:**

- All tests pass
- Linting clean
- Success criteria met

**Notes:**

- Add regression test if fixing a bug.
- Document any edge cases handled.
