---
trace_id: "timeout-test-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "low"
source: "cli"
created_by: "scenario-framework"
flow: "timeout-test"
---

# Dynamic Step Timeout Test

This request tests that dynamic steps respect the configured timeout.

**Test Configuration:**

- Flow step timeout: 5 seconds
- Expected behavior: Step terminates gracefully after max iterations or timeout

**Expected Outcome:**

1. Dynamic step starts execution
2. ReAct loop runs until max iterations (10) or timeout (5 seconds)
3. Step terminates with appropriate error message
4. Partial results are logged to Activity Journal
5. No crash or hang occurs

This is a negative test to verify timeout handling works correctly.
